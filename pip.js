/* 浮窗置顶：主窗缩小置顶；计时中可进一步缩为透明胶囊，退出时恢复主窗。
 * 本版修掉的问题：
 *  - 置顶只在“进入浮窗”时设置一次，窗口隐藏/显示后失效 → 统一用 applyTop() 收敛
 *  - 胶囊与主窗的显示/隐藏顺序颠倒、capShown 与主进程不同步，导致“窗口消失”
 *  - 多屏下用“鼠标所在屏”而非“窗口所在屏”，浮窗会弹到另一块屏
 *  - 胶囊可被拖出屏幕外且位置不记忆 → 钳制到工作区并持久化
 *  - 退出浮窗未还原最小尺寸/最大化状态
 */
const { BrowserWindow, app, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./window-state');

/** 胶囊/浮窗诊断日志：打包后看不到 stderr，但这份文件用户可以随时发出来定位 */
const CAP_LOG = () => path.join(app.getPath('userData'), 'guangyin-pip.log');
function capLog(msg) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(CAP_LOG(), line, 'utf-8');
  } catch (e) { /* 日志失败不影响主流程 */ }
}

const PIP_SIZE = { width: 380, height: 620 };
const NORMAL_MIN = { width: 1040, height: 700 };
const PIP_MIN = { width: 320, height: 480 };
const CAP_SIZE = { width: 210, height: 52 };

let getMain = () => null;
let registered = false;
let capWin = null;
let capReady = null;
let capPos = null;
let capWant = false;      // renderer 期望胶囊可见
let topWant = false;      // renderer 期望置顶
let savedBounds = null;   // 进入浮窗前的窗口 bounds
let savedMaximized = false;

const alive = w => !!w && !w.isDestroyed();

/** setVisibleOnAllWorkspaces 在部分 Electron 版本返回 undefined 而非 Promise，
 *  直接链 .catch() 会抛 TypeError 并把胶囊创建打断——这里统一安全调用。 */
function makeVisibleOnAllWorkspaces(win) {
  if (!alive(win) || typeof win.setVisibleOnAllWorkspaces !== 'function') return;
  try {
    const r = win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch (e) { /* 平台不支持则忽略 */ }
}

/** 统一的置顶开关（Windows 上 'floating' 有时会被全屏程序压制，回落到 'screen-saver'） */
function applyTop(win) {
  if (!alive(win)) return;
  const on = topWant;
  try {
    win.setAlwaysOnTop(on, on ? 'screen-saver' : 'normal');
  } catch (e) {
    try { win.setAlwaysOnTop(on); } catch (e2) { /* 平台不支持则忽略 */ }
  }
}

/** 主窗重新可见后立刻补一次置顶，避免隐藏/显示过程丢失 Z 序 */
function showMain() {
  const win = getMain();
  if (!alive(win)) return null;
  win.show();
  applyTop(win);
  return win;
}

function workAreaOf(win) {
  if (alive(win)) return screen.getDisplayMatching(win.getBounds()).workArea;
  return screen.getPrimaryDisplay().workArea;
}

function closeCap() {
  if (alive(capWin)) capWin.destroy();
  capWin = null;
  capReady = null;
  capWant = false;
}

/** 胶囊位置落盘（防抖）：拖动结束约 400ms 后才写一次 */
let capSaveTimer = null;
function persistCapPosSoon() {
  clearTimeout(capSaveTimer);
  capSaveTimer = setTimeout(() => { if (capPos) store.save({ capsule: capPos }); }, 400);
}
/** 退出前把胶囊位置落盘 */
function flushCapPos() {
  clearTimeout(capSaveTimer);
  if (alive(capWin)) capPos = capWin.getBounds();
  if (capPos) store.save({ capsule: capPos });
}

function createCapWindow() {
  capWin = new BrowserWindow({
    width: CAP_SIZE.width, height: CAP_SIZE.height,
    frame: false, transparent: true, resizable: false,
    minimizable: false, maximizable: false, closable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'capsule-preload.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
    }
  });
  makeVisibleOnAllWorkspaces(capWin);
  capReady = capWin.loadFile(path.join(__dirname, 'src', 'capsule.html'))
    .then(() => new Promise(r => setTimeout(r, 150)))
    .catch(e => {
      // 加载失败也要留痕并强行显示，否则主窗被藏起来后用户会以为“窗口不见了”
      console.error('[胶囊] 页面加载失败:', e && e.message);
    });
  capWin.on('closed', () => { capWin = null; capReady = null; });
  // 系统拖动会持续触发 move：只在内存里跟住位置，落盘防抖，避免拖动时狂写文件
  capWin.on('move', () => {
    if (capWin && !capWin.isDestroyed()) {
      capPos = capWin.getBounds();
      persistCapPosSoon();
    }
  });
  capWin.on('blur', () => { if (capWant) applyTop(capWin); });
  return capWin;
}

/** 显示胶囊（主窗之外的那个小条） */
async function showCapInternal() {
  const win = getMain();
  if (!alive(win)) { capLog('cap:show 失败：主窗不存在'); return false; }
  try {
    if (!alive(capWin)) { createCapWindow(); capLog('已创建胶囊窗口'); }
    else capLog('复用已有胶囊窗口');
    try { await capReady; } catch (e) { capLog('胶囊页面加载异常（继续显示）: ' + (e && e.message)); }

    const wa = workAreaOf(win);
    const base = capPos || { x: wa.x + wa.width - CAP_SIZE.width - 20, y: wa.y + 20, width: CAP_SIZE.width, height: CAP_SIZE.height };
    capPos = store.clampToDisplay(base, screen.getDisplayMatching(base));
    capWin.setBounds(capPos);
    capWin.setAlwaysOnTop(true, 'screen-saver');
    capWant = true;
    capWin.showInactive();       // 先让胶囊可见，再藏主窗：顺序反了会出现“两边都不见”
    if (typeof capWin.moveTop === 'function') capWin.moveTop();
    makeVisibleOnAllWorkspaces(capWin);
    win.hide();
    store.save({ capsule: capPos });
    capLog(`胶囊已显示 bounds=${JSON.stringify(capPos)} visible=${capWin.isVisible()} destroyed=${capWin.isDestroyed()} 主窗visible=${win.isVisible()}`);
    return true;
  } catch (e) {
    capLog('cap:show 异常: ' + (e && e.stack ? e.stack : e));
    return false;
  }
}

/** 隐藏胶囊并恢复主窗（主窗保持浮窗形态与置顶） */
function hideCapInternal(focusMain) {
  capWant = false;
  if (alive(capWin)) {
    capPos = capWin.getBounds();
    capWin.hide();
    store.save({ capsule: capPos });
  }
  if (focusMain !== false) {
    const win = showMain();
    if (win) win.focus();
  }
  return true;
}

function restoreMainBounds(win) {
  if (!alive(win)) return;
  if (savedMaximized) {
    win.maximize();
  } else if (savedBounds) {
    win.setBounds(store.clampToDisplay(savedBounds, screen.getDisplayMatching(savedBounds)));
  } else {
    const w = store.state.main;
    if (w && store.isOnScreen(w)) win.setBounds(w);
    else win.center();
  }
}

/** 退出浮窗：还原尺寸、取消置顶、恢复主窗 */
function exitPipInternal(notifyRenderer) {
  topWant = false;
  store.save({ pinned: false });
  closeCap();
  const win = getMain();
  if (!alive(win)) return false;
  win.webContents.setBackgroundThrottling(true);
  win.setAlwaysOnTop(false);
  try { win.setVisibleOnAllWorkspaces(false); } catch (e) {}
  win.setMinimumSize(NORMAL_MIN.width, NORMAL_MIN.height);
  restoreMainBounds(win);
  savedBounds = null;
  savedMaximized = false;
  win.show();
  win.focus();
  if (notifyRenderer) win.webContents.send('pip:exited');
  return true;
}

/** 进入浮窗：记录原状态 → 降最小尺寸 → 贴当前屏右上角 → 置顶 */
function enterPipInternal() {
  const win = getMain();
  if (!alive(win)) return false;
  savedMaximized = win.isMaximized();
  if (savedMaximized) win.unmaximize();
  savedBounds = win.getBounds();
  win.setMinimumSize(PIP_MIN.width, PIP_MIN.height);
  const wa = screen.getDisplayMatching(savedBounds).workArea;
  const target = store.clampToDisplay({
    x: wa.x + wa.width - PIP_SIZE.width - 20,
    y: wa.y + 20,
    width: PIP_SIZE.width,
    height: PIP_SIZE.height
  }, screen.getDisplayMatching(savedBounds));
  win.setBounds(target);
  topWant = true;
  applyTop(win);
  store.save({ pinned: true, main: savedBounds });
  return true;
}

function registerPip(getWindow) {
  getMain = getWindow || getMain;
  if (registered) return;
  registered = true;

  ipcMain.handle('win:enter-pip', () => enterPipInternal());
  ipcMain.handle('win:exit-pip', () => exitPipInternal(true));
  ipcMain.handle('win:set-pinned', (_evt, want) => {
    const win = getMain();
    if (!alive(win)) return false;
    topWant = !!want;
    store.save({ pinned: topWant });
    applyTop(win);
    return true;
  });
  ipcMain.handle('win:hide-self', () => {
    const win = getMain();
    if (alive(win)) win.hide();
    if (alive(capWin) && capWant) applyTop(capWin);
    return true;
  });

  /* ---- 胶囊 ---- */
  ipcMain.handle('cap:show', () => showCapInternal());
  ipcMain.handle('cap:hide', () => hideCapInternal(true));
  ipcMain.handle('cap:close', () => { closeCap(); return true; });
  ipcMain.handle('cap:diag', (_evt, msg) => {
    capLog('[renderer] ' + msg);
    return true;
  });

  ipcMain.on('cap:state', (_evt, s) => {
    if (alive(capWin) && capWin.webContents) capWin.webContents.send('cap:state', s);
  });

  /* 兜底拖动：正常路径由系统拖动接管，这里只在 app-region 失效时被调用。
     关键是把"窗口实际移动了多少"回给调用方，让它修正自己的坐标基准 ——
     否则窗口位移会被当成鼠标位移再推一次，形成来回振荡。 */
  ipcMain.handle('cap:drag', (_evt, dx, dy, scale) => {
    if (!alive(capWin)) return { dx: 0, dy: 0, clamped: true };
    const b = capWin.getBounds();
    const s = (typeof scale === 'number' && scale > 0) ? scale : 1;
    const from = { x: b.x, y: b.y, width: b.width, height: b.height };
    const want = { x: b.x + (Number(dx) || 0), y: b.y + (Number(dy) || 0), width: b.width, height: b.height };
    const disp = screen.getDisplayMatching(want);
    const next = store.clampToDisplay(want, disp);
    capPos = next;
    capWin.setBounds(next);
    persistCapPosSoon();
    const appliedX = next.x - from.x;          // DIP
    const appliedY = next.y - from.y;
    const hitX = next.x !== want.x;
    const hitY = next.y !== want.y;
    return { dx: appliedX, dy: appliedY, px: appliedX * s, py: appliedY * s, clamped: hitX || hitY };
  });

  ipcMain.on('cap:expand', () => {
    // 点胶囊 = 回到主窗（保持浮窗置顶状态，不退出置顶）
    hideCapInternal(true);
    const win = getMain();
    if (alive(win)) win.webContents.send('cap:expanded');
  });

  ipcMain.on('cap:exit', () => {
    // 点胶囊 ✕ = 彻底退出置顶，必须把主窗还原，否则会留下一个 380×620 的置顶小窗
    closeCap();
    const win = getMain();
    if (!alive(win)) return;
    win.webContents.setBackgroundThrottling(true);
    win.webContents.send('cap:request-exit', { restored: false });
    exitPipInternal(false);
  });

  /* 全局快捷键：主窗被藏起来时也能召回；Ctrl+Alt+C 专门收起/唤出胶囊 */
  try {
    globalShortcut.register('Control+Alt+G', () => {
      const win = getMain();
      if (!alive(win)) return;
      if (!win.isVisible()) showMain();
      win.focus();
    });
    globalShortcut.register('Control+Alt+C', () => {
      const win = getMain();
      if (!alive(win)) return;
      if (capWant || !win.isVisible()) hideCapInternal(true);
      else showCapInternal();
    });
  } catch (e) { /* 快捷键被占用则忽略 */ }
}

/** 第二实例唤起：强制退出置顶/胶囊并恢复主窗 */
function forceRestore(win) {
  topWant = false;
  store.save({ pinned: false });
  closeCap();
  if (!alive(win)) return;
  win.webContents.setBackgroundThrottling(true);
  win.setAlwaysOnTop(false);
  try { win.setVisibleOnAllWorkspaces(false); } catch (e) {}
  win.setMinimumSize(NORMAL_MIN.width, NORMAL_MIN.height);
  restoreMainBounds(win);
  savedBounds = null;
  savedMaximized = false;
  win.show();
  win.focus();
  win.webContents.send('cap:request-exit', { restored: true });
}

module.exports = { registerPip, forceRestore, exitPipInternal, flushCapPos, PIP_SIZE, CAP_SIZE };
