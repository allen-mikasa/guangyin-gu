/* 光阴蛊 · 光圈随进度变色 + Electron API 兼容守卫
 * 覆盖三件真事故：
 *   1) 光圈语义是「走到 1/5 转赤红、2/5 转银白、3/5 转金黄、4/5 转亮紫」
 *      —— 不是整圈铺五个色块，也不是全程渐变插值
 *   2) 配色必须压低饱和度、并在档内平滑过渡，保持墨金古风不突兀
 *   3) setVisibleOnAllWorkspaces() 在 Electron 31 返回 undefined，
 *      链 .catch() 会抛 TypeError 把胶囊创建打断（胶囊因此完全不显示）
 * 用法：node tests/ring-segments.test.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const pipSrc = fs.readFileSync(path.join(__dirname, '..', 'pip.js'), 'utf8');

/* ================= 一、光圈取色（进程内执行真实代码） ================= */
const ringFg = { style: {} };
const stopEls = [0, 1, 2].map(() => ({ _a: {}, setAttribute(k, v) { this._a[k] = v; } }));
const fakeDocument = {
  querySelector: sel => (sel === '#ring-fg' ? ringFg : null),
  querySelectorAll: sel => (sel === '#ringGrad stop' ? stopEls : []),
  addEventListener() {}
};

function loadRingApi() {
  const from = src.indexOf('/* ---------------- 光圈随进度变色 ---------------- */');
  const to = src.indexOf('/* ---------------- 浮窗置顶 ---------------- */');
  if (from < 0 || to < 0) throw new Error('切片失败：光圈区块找不到');
  const block = src.slice(from, to);
  const code = [
    'function $(s) { return document.querySelector(s); }',
    'function on(k) { return globalThis.__flowOn; }',
    'const timer = { mode: "countdown", status: "running", phase: "focus", plannedMs: 60000 };',
    'function currentElapsed() { return 0; }',
    'let settings = {};',
    block,
    'return { ringFlowColor, ringProgress, updateRing, setRingStops, lerpColor, hexToRgb,' +
    ' RING_FLOW_COLORS, timer };'
  ].join('\n');
  return new Function('document', 'console', code)(fakeDocument, console);
}

/* ================= 二、pip.js 兼容守卫（注入假 electron，进程内跑真实模块） ================= */
function probePip() {
  const handlers = new Map();
  let visCalls = 0;
  function makeWin() {
    const w = {
      _b: { x: 0, y: 0, width: 1200, height: 800 }, _vis: true, _top: false, _destroyed: false,
      webContents: { send() {}, setBackgroundThrottling() {} },
      isDestroyed: () => w._destroyed,
      getBounds: () => ({ ...w._b }),
      setBounds(b) { w._b = { ...w._b, ...b }; },
      setMinimumSize() {}, getMinimumSize: () => ({}),
      setAlwaysOnTop(v) { w._top = !!v; }, isAlwaysOnTop: () => w._top,
      setVisibleOnAllWorkspaces() { visCalls++; return undefined; },   // Electron 31 的真实返回
      isVisible: () => w._vis, show() { w._vis = true; }, hide() { w._vis = false; },
      focus() {}, showInactive() { w._vis = true; }, moveTop() {},
      isMaximized: () => false, maximize() {}, unmaximize() {}, isMinimized: () => false,
      center() {}, destroy() { w._destroyed = true; }, loadFile: () => Promise.resolve(),
      on() {}, setMenuBarVisibility() {}
    };
    return w;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gyg-ring-'));
  const fake = {
    app: { getPath: () => tmp, requestSingleInstanceLock: () => true, on() {}, whenReady: () => Promise.resolve(), quit() {} },
    BrowserWindow: makeWin,
    ipcMain: { handle(c, f) { handlers.set(c, f); }, on() {} },
    screen: {
      getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
      getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }]
    },
    globalShortcut: { register() {}, unregisterAll() {} },
    Menu: { buildFromTemplate: () => ({}) },
    Tray: class { setToolTip() {} setContextMenu() {} on() {} destroy() {} },
    nativeImage: { createFromPath: () => ({ isEmpty: () => false }), createEmpty: () => ({ isEmpty: () => true }) }
  };
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    return request === 'electron' ? 'fake-electron-ring' : origResolve.call(this, request, ...rest);
  };
  require.cache['fake-electron-ring'] = { id: 'fake-electron-ring', filename: 'fake-electron-ring', loaded: true, exports: fake };

  const pipPath = path.join(__dirname, '..', 'pip.js');
  delete require.cache[pipPath];
  delete require.cache[path.join(__dirname, '..', 'window-state.js')];
  const pip = require(pipPath);
  const mainWin = makeWin();
  pip.registerPip(() => mainWin);

  return handlers.get('cap:show')().then(
    result => {
      check('setVisibleOnAllWorkspaces 返回 undefined 时 cap:show 不抛错', true);
      check('cap:show 返回 true（胶囊真正显示）', result === true, 'got=' + JSON.stringify(result));
      check('守卫确实调用了 setVisibleOnAllWorkspaces', visCalls > 0, 'calls=' + visCalls);
      check('主窗已被隐藏（胶囊显示流程走完）', mainWin.isVisible() === false);
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    },
    err => {
      check('setVisibleOnAllWorkspaces 返回 undefined 时 cap:show 不抛错', false,
        err && err.constructor.name + ': ' + err.message);
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    }
  );
}

/* ---------- 颜色工具 ---------- */
function rgbOf(c) {
  const m = String(c).match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = String(c).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const maxCh = c => Math.max(...rgbOf(c));
const minCh = c => Math.min(...rgbOf(c));

(async () => {
  globalThis.__flowOn = true;
  const api = loadRingApi();
  const COLORS = api.RING_FLOW_COLORS;

  console.log('\n[1] 五档配色的位置');
  check('调色板 5 色', COLORS.length === 5, JSON.stringify(COLORS));

  const at = t => api.ringFlowColor(t);
  check('0%（起点）= 翠绿', at(0) === COLORS[0], at(0));
  check('刚好 1/5 = 赤红', at(0.2) === COLORS[1], at(0.2));
  check('刚好 2/5 = 银白', at(0.4) === COLORS[2], at(0.4));
  check('刚好 3/5 = 金黄', at(0.6) === COLORS[3], at(0.6));
  check('刚好 4/5 = 亮紫', at(0.8) === COLORS[4], at(0.8));
  check('100% 仍是亮紫（不回头）', at(1) === COLORS[4], at(1));
  check('超出 1 也被夹住', at(1.7) === COLORS[4], at(1.7));
  check('负数被夹到翠绿', at(-0.5) === COLORS[0], at(-0.5));
  check('五档各不相同', new Set(COLORS).size === 5);

  console.log('\n[2] 档内平滑过渡（不突兀）');
  check('档首保持本色（1/5 刚过一点仍是赤红）', at(0.21) === COLORS[1], at(0.21));
  check('档中保持本色（0.3 仍是赤红）', at(0.3) === COLORS[1], at(0.3));
  check('档末开始向下一档过渡（0.39 已不是纯赤红）', at(0.39) !== COLORS[1], at(0.39));
  check('0.39 落在赤红与银白之间', (() => {
    const mid = rgbOf(at(0.39)), a = rgbOf(COLORS[1]), b = rgbOf(COLORS[2]);
    for (let i = 0; i < 3; i++) {
      if (mid[i] < Math.min(a[i], b[i]) - 1 || mid[i] > Math.max(a[i], b[i]) + 1) return false;
    }
    return true;
  })(), at(0.39));
  check('过渡是连续的（0.38→0.40 变化幅度有限）', (() => {
    const x = rgbOf(at(0.38)), y = rgbOf(at(0.40));
    return Math.max(Math.abs(x[0] - y[0]), Math.abs(x[1] - y[1]), Math.abs(x[2] - y[2])) < 80;
  })());
  check('每一档交界都连续（无跳变）', (() => {
    for (let k = 1; k < 5; k++) {
      const edge = k / 5;
      const before = rgbOf(at(edge - 0.001)), after = rgbOf(at(edge + 0.001));
      const d = Math.max(...[0, 1, 2].map(i => Math.abs(before[i] - after[i])));
      if (d > 40) return false;
    }
    return true;
  })());

  console.log('\n[3] 风格约束：不突兀');
  check('所有档位都压低了饱和度（最高通道 ≤ 215）', COLORS.every(c => maxCh(c) <= 215),
    COLORS.map(c => c + '=' + maxCh(c)).join(' '));
  check('没有刺眼纯色（最低通道 ≥ 95）', COLORS.every(c => minCh(c) >= 95),
    COLORS.map(c => c + '=' + minCh(c)).join(' '));
  check('每档都带灰调（通道极差 ≤ 110）', COLORS.every(c => maxCh(c) - minCh(c) <= 110),
    COLORS.map(c => maxCh(c) - minCh(c)).join(','));
  check('CSS 给 stroke 加了过渡（换色是渐隐渐显，不是硬切）',
    /\.ring-fg\s*\{[^}]*transition:[^;]*stroke/s.test(css));
  check('过渡时长适中（0.2~1s）', /transition:[^;]*stroke\s+(0?\.\d+)s/s.test(css) &&
    (() => { const m = css.match(/transition:[^;]*stroke\s+(0?\.\d+)s/s); const v = Number(m[1]); return v >= 0.2 && v <= 1; })());
  check('index.html 不再有整圈彩段容器', !/ring-arcs/.test(html));
  check('CSS 里旧的旋转关键帧已移除', !/@keyframes\s+ring-spin/.test(css));
  check('renderer 里旧的整圈流转代码已移除',
    !src.includes('buildRingSegments') && !src.includes('arcPath') && !src.includes('seg-flow'));

  console.log('\n[4] 进度口径与开关');
  // 倒计时/专注：已完成比例
  api.timer.plannedMs = 60000;
  check('倒计时 20% 进度 → 赤红', api.ringFlowColor(api.ringProgress(12000)) === COLORS[1],
    api.ringFlowColor(api.ringProgress(12000)));
  check('倒计时 100% → 亮紫', api.ringFlowColor(api.ringProgress(60000)) === COLORS[4]);
  // 正计时：一小时一圈
  api.timer.plannedMs = null;
  check('正计时 30 分钟 → 进度 0.5 → 银白', (() => {
    const p = api.ringProgress(1800000);
    return Math.abs(p - 0.5) < 0.001 && api.ringFlowColor(p) === COLORS[2];
  })(), 'progress=' + api.ringProgress(1800000));
  check('正计时 50 分钟 → 进度 5/6 → 亮紫', api.ringFlowColor(api.ringProgress(3000000)) === COLORS[4]);

  api.timer.status = 'running';
  api.timer.mode = 'countdown';
  api.timer.phase = 'focus';
  api.updateRing(0.2, false);
  check('updateRing 按传入进度上色（进度环用同一口径）',
    rgbOf(ringFg.style.stroke).join(',') === rgbOf(COLORS[1]).join(','), String(ringFg.style.stroke));
  check('渐变三档同步为同色（避免与单色描边打架）',
    stopEls[0]._a['stop-color'] === stopEls[1]._a['stop-color'] &&
    stopEls[1]._a['stop-color'] === stopEls[2]._a['stop-color']);

  globalThis.__flowOn = false;
  api.updateRing(0.6, false);
  check('关闭该设置后回到品牌金色', ringFg.style.stroke === '#c9a15e', String(ringFg.style.stroke));
  api.timer.mode = 'focus';
  api.timer.phase = 'short';
  api.updateRing(0.6, true);
  check('关闭该设置时休息阶段仍是青玉', ringFg.style.stroke === '#7fa89a', String(ringFg.style.stroke));
  api.timer.status = 'idle';
  api.updateRing(0, false);
  check('空闲时回到金玉静止渐变', ringFg.style.stroke === '', String(ringFg.style.stroke));

  console.log('\n[5] setVisibleOnAllWorkspaces 兼容守卫（胶囊不显示的元凶）');
  check('pip.js 里对返回值做了类型守卫', /typeof\s+r\.catch\s*===\s*'function'/.test(pipSrc));
  check('pip.js 里不再有 setVisibleOnAllWorkspaces(...).catch 直链',
    !/setVisibleOnAllWorkspaces\([^)]*\)\s*\.catch/.test(pipSrc));
  await probePip();

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.log('\n测试自身异常: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
