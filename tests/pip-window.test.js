/* 浮窗置顶状态机单测：把假 electron 模块注入 require 缓存后加载真实 pip.js / window-state.js。
 * 覆盖：进入/退出浮窗的尺寸与置顶收敛、胶囊显隐顺序、多屏坐标、拖拽钳制、状态持久化。
 * 用法：node tests/pip-window.test.js
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');

/* ---------- 假 electron ---------- */
const handlers = new Map();
const listeners = new Map();
const screens = {
  displays: [{ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],   // 主屏
  primary: { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  secondary: { id: 2, workArea: { x: 1920, y: 0, width: 1600, height: 860 } }  // 右侧副屏
};

function makeWin(opts = {}) {
  const w = {
    _id: makeWin.n = (makeWin.n || 0) + 1,
    _bounds: { x: opts.x || 100, y: opts.y || 100, width: opts.width || 1200, height: opts.height || 820 },
    _min: { width: opts.minWidth || 0, height: opts.minHeight || 0 },
    _visible: true, _destroyed: false, _maximized: false, _alwaysOnTop: false, _topLevel: null,
    _blurCb: null, _moveCb: null,
    webContents: {
      _sent: [],
      send(ch, payload) { this._sent.push({ ch, payload }); },
      setBackgroundThrottling() {}
    },
    isDestroyed() { return this._destroyed; },
    getBounds() { return { ...this._bounds }; },
    setBounds(b) { this._bounds = { x: b.x, y: b.y, width: b.width, height: b.height }; if (w._moveCb) w._moveCb(); },
    setMinimumSize(a, b) { w._min = { width: a, height: b }; },
    getMinimumSize() { return { ...w._min }; },
    setAlwaysOnTop(on, level) { w._alwaysOnTop = !!on; w._topLevel = level || null; },
    isAlwaysOnTop() { return !!w._alwaysOnTop; },
    // 忠实还原 Electron 31 的行为：返回 undefined，而不是 Promise。
    // 之前这里被写成返回 Promise，于是把“链 .catch() 会炸”的真 bug 放过去了。
    setVisibleOnAllWorkspaces() { return undefined; },
    isVisible() { return w._visible; },
    show() { w._visible = true; },
    hide() { w._visible = false; },
    focus() {},
    showInactive() { w._visible = true; },
    moveTop() {},
    isMaximized() { return w._maximized; },
    maximize() { w._maximized = true; },
    unmaximize() { w._maximized = false; },
    isMinimized() { return false; },
    center() { w._bounds = { x: 360, y: 110, width: w._bounds.width, height: w._bounds.height }; },
    destroy() { w._destroyed = true; w._visible = false; },
    loadFile() { return Promise.resolve(); },
    on(ev, cb) { if (ev === 'blur') w._blurCb = cb; if (ev === 'move') w._moveCb = cb; },
    setMenuBarVisibility() {}
  };
  makeWin.created.push(w);
  return w;
}
makeWin.created = [];

let displayForBounds = () => screens.primary;
const fakeElectron = {
  app: { getPath: () => tmpUserData, requestSingleInstanceLock: () => true, on() {}, whenReady: () => Promise.resolve(), quit() {} },
  BrowserWindow: makeWin,
  ipcMain: {
    handle(ch, fn) { handlers.set(ch, fn); },
    on(ch, fn) { listeners.set(ch, fn); }
  },
  screen: {
    getDisplayMatching: b => displayForBounds(b),
    getPrimaryDisplay: () => screens.primary,
    getAllDisplays: () => [screens.primary, screens.secondary],
    getDisplayNearestPoint: () => screens.primary
  },
  globalShortcut: { register() {}, unregisterAll() {} },
  Menu: { buildFromTemplate: () => ({}) },
  Tray: class { setToolTip() {} setContextMenu() {} on() {} destroy() {} },
  nativeImage: { createFromPath: () => ({ isEmpty: () => false }), createEmpty: () => ({ isEmpty: () => true }) },
  shell: { openExternal() {} },
  Notification: class { static isSupported() { return false; } on() {} show() {} }
};

/* 把假模块塞进 require 缓存：pip.js 里 require('electron') 会命中它 */
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'electron') return 'fake-electron';
  return origResolve.call(this, request, ...rest);
};
require.cache['fake-electron'] = { id: 'fake-electron', filename: 'fake-electron', loaded: true, exports: fakeElectron };

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'gyg-test-'));
const store = require(path.join(__dirname, '..', 'window-state.js'));
const pip = require(path.join(__dirname, '..', 'pip.js'));

/* ---------- 断言 ---------- */
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};

(async () => {
  const main = makeWin({ x: 100, y: 100, width: 1200, height: 820 });
  pip.registerPip(() => main);
  check('注册了 win:enter-pip', handlers.has('win:enter-pip'));
  check('注册了 cap:show', handlers.has('cap:show'));
  check('注册了 cap:exit', listeners.has('cap:exit'));
  check('注册了 cap:diag（胶囊诊断）', handlers.has('cap:diag'));
  check('注册了 win:set-pinned（置顶开关）', handlers.has('win:set-pinned'));

  /* --- 0. 置顶开关 --- */
  console.log('\n[0] 置顶开关');
  await handlers.get('win:set-pinned')({}, true);
  check('set-pinned(true) 后立即置顶', main.isAlwaysOnTop() === true);
  await handlers.get('win:set-pinned')({}, false);
  check('set-pinned(false) 后取消置顶', main.isAlwaysOnTop() === false);

  /* --- 1. 进入浮窗 --- */
  console.log('\n[1] 进入浮窗');
  await handlers.get('win:enter-pip')();
  check('窗口缩到 380×620', main.getBounds().width === 380 && main.getBounds().height === 620, JSON.stringify(main.getBounds()));
  check('已置顶', main.isAlwaysOnTop() === true);
  check('最小尺寸已下调', main.getMinimumSize().width < 1040, JSON.stringify(main.getMinimumSize()));
  const wa = screens.primary.workArea;
  check('贴主屏右上角', main.getBounds().x + 380 <= wa.x + wa.width && main.getBounds().y >= wa.y, JSON.stringify(main.getBounds()));

  /* --- 2. 缩成胶囊：先显胶囊再藏主窗 --- */
  console.log('\n[2] 缩为胶囊');
  await handlers.get('cap:show')();
  const caps = makeWin.created.filter(w => w._id !== main._id && w.getBounds().width === 210);
  check('创建了胶囊窗口', caps.length === 1, 'caps=' + caps.length);
  const cap = caps[0];
  check('主窗被隐藏', main.isVisible() === false);
  check('胶囊可见', cap.isVisible() === true);
  check('胶囊置顶', cap.isAlwaysOnTop() === true);

  /* --- 3. 拖拽：契约与钳制 --- */
  console.log('\n[3] 拖拽（走 ipcMain.handle，必须回传真实位移）');
  check('cap:drag 已注册为 handle（可回传结果）', handlers.has('cap:drag'));
  // 先挪到屏幕中间，避免"右上角起步"导致向右拖直接触边
  cap.setBounds({ x: 600, y: 400, width: 210, height: 52 });
  const before = { ...cap.getBounds() };

  // 正常小幅拖动：应返回"实际移动量"，供渲染层修正坐标基准。
  // 早期版本不回传结果，渲染层只能拿被窗口位移污染的 screenX 当鼠标位移，越推越往回。
  const r1 = await handlers.get('cap:drag')({}, 30, 12, 1);
  check('小幅拖动按请求量移动', cap.getBounds().x === before.x + 30 && cap.getBounds().y === before.y + 12,
    JSON.stringify(cap.getBounds()));
  check('回传实际位移 dx/dy', r1 && r1.dx === 30 && r1.dy === 12, JSON.stringify(r1));
  check('未触边时 clamped 为假', r1.clamped === false);
  check('按缩放比回传物理像素位移', r1.px === 30 && r1.py === 12, JSON.stringify(r1));

  const rScale = await handlers.get('cap:drag')({}, 10, 0, 1.5);
  check('缩放 1.5 时物理位移同步放大', rScale.px === 15, JSON.stringify(rScale));
  await handlers.get('cap:drag')({}, -10, 0, 1.5);   // 拖回去，避免影响后续用例

  // 越界拖动：实际位移必须小于请求量，并标记 clamped
  const r2 = await handlers.get('cap:drag')({}, -99999, -99999, 1);
  const after = cap.getBounds();
  check('向左上拖出屏幕后被夹回工作区', after.x >= wa.x && after.y >= wa.y, JSON.stringify(after));
  check('越界时实际位移 < 请求量', Math.abs(r2.dx) < 99999 && Math.abs(r2.dy) < 99999, JSON.stringify(r2));
  check('越界时 clamped 为真', r2.clamped === true, JSON.stringify(r2));

  const r3 = await handlers.get('cap:drag')({}, 99999, 99999, 1);
  const after2 = cap.getBounds();
  check('向右下拖出屏幕后被夹回工作区',
    after2.x + after2.width <= wa.x + wa.width && after2.y + after2.height <= wa.y + wa.height, JSON.stringify(after2));
  check('右下越界同样标记 clamped', r3.clamped === true, JSON.stringify(r3));

  // 贴边后继续朝同一方向拖：实际位移必须是 0（不能反向弹回）
  const edgeX = cap.getBounds().x;
  const r4 = await handlers.get('cap:drag')({}, 40, 0, 1);
  check('已贴右边缘时继续右拖：实际位移为 0（不会反向左移）', r4.dx === 0, JSON.stringify(r4));
  check('贴边拖动时窗口位置不变', cap.getBounds().x === edgeX, cap.getBounds().x + ' vs ' + edgeX);
  check('贴边拖动标记 clamped', r4.clamped === true, JSON.stringify(r4));

  /* --- 4. 多屏：窗口在副屏时浮窗应落副屏 --- */
  console.log('\n[4] 多屏定位');
  displayForBounds = b => (b && b.x >= 1920) ? screens.secondary : screens.primary;
  await handlers.get('win:exit-pip')(true);
  main.setBounds({ x: 2000, y: 100, width: 1200, height: 820 });   // 把主窗放到副屏
  await handlers.get('win:enter-pip')();
  const sb = main.getBounds(), swa = screens.secondary.workArea;
  check('浮窗落在副屏（不再跳到主屏）',
    sb.x >= swa.x && sb.x + sb.width <= swa.x + swa.width, JSON.stringify(sb) + ' 副屏=' + JSON.stringify(swa));

  /* --- 5. 胶囊 ✕ 必须彻底退出浮窗 --- */
  console.log('\n[5] 胶囊 ✕ 退出置顶');
  await handlers.get('cap:show')();
  const cap2 = makeWin.created.filter(w => w.getBounds().width === 210).pop();
  listeners.get('cap:exit')({});
  check('胶囊已销毁', cap2.isDestroyed() === true);
  check('主窗重新可见', main.isVisible() === true);
  check('已取消置顶', main.isAlwaysOnTop() === false);
  check('最小尺寸已还原', main.getMinimumSize().width === 1040, JSON.stringify(main.getMinimumSize()));
  check('窗口已还原为原尺寸', main.getBounds().width === 1200 && main.getBounds().height === 820, JSON.stringify(main.getBounds()));
  check('通知 renderer 退出浮窗', main.webContents._sent.some(s => s.ch === 'cap:request-exit'));

  /* --- 6. 最大化状态往返 --- */
  console.log('\n[6] 最大化状态往返');
  main._maximized = true;
  await handlers.get('win:enter-pip')();
  check('进入浮窗前先取消最大化', main.isMaximized() === false);
  await handlers.get('win:exit-pip')(true);
  check('退出浮窗后恢复最大化', main.isMaximized() === true);

  /* --- 7. 位置持久化 --- */
  console.log('\n[7] 位置持久化');
  store.save({ main: { x: 12, y: 34, width: 1200, height: 800 }, capsule: { x: 5, y: 6, width: 210, height: 52 } });
  const reloaded = store.load();
  check('写盘后可读回', reloaded.main && reloaded.main.x === 12, JSON.stringify(reloaded));

  /* --- 8. 屏幕外校验 --- */
  console.log('\n[8] 屏幕可见性校验');
  check('屏内位置判定为可见', store.isOnScreen({ x: 100, y: 100, width: 1200, height: 800 }) === true);
  check('完全屏外判定为不可见', store.isOnScreen({ x: 9000, y: 9000, width: 1200, height: 800 }) === false);
  check('跨屏边界仍判为可见（副屏接住）',
    store.isOnScreen({ x: 1880, y: 100, width: 1200, height: 800 }) === true);
  check('只剩一条缝也判为不可见（防拔掉副屏后找不回）',
    store.isOnScreen({ x: 3520, y: 200, width: 1200, height: 800 }) === false);

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
})();
