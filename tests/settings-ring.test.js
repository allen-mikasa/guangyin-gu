/* 光阴蛊 · 设置面板与光圈流转单测
 * 直接执行 src/renderer.js 的「设置 / 光圈流转」真实代码。
 * 用法：node tests/settings-ring.test.js
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
const from = src.indexOf('/* ---------------- 设置 ---------------- */');
const to = src.indexOf('/* ---------------- 浮窗置顶 ---------------- */');
if (from < 0 || to < 0) throw new Error('切片失败：设置/光圈区块找不到');
const block = src.slice(from, to);

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};

/** 从源码里取一个具名函数/常量的最小定义（到下一个顶层定义为止） */
function grab(pattern) {
  const i = src.search(pattern);
  if (i < 0) throw new Error('缺少依赖: ' + pattern);
  const rest = src.slice(i + 1);
  const m = rest.search(/\n(?=(function |const |let |\/\* ))/);
  return m < 0 ? src.slice(i) : src.slice(i, i + 1 + m);
}

/* ---------- 伪造 DOM ---------- */
const stops = [0, 1, 2].map(() => ({ _a: {}, setAttribute(k, v) { this._a[k] = v; }, getAttribute(k) { return this._a[k]; } }));
const inputs = {};
['autoCap', 'autoHide', 'ringFlow', 'pinned'].forEach(k => { inputs[k] = { checked: false, onchange: null }; });
const ringFg = { style: {} };
const ringArcsEl = {
  _html: '',
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  style: { _p: {}, setProperty(k, v) { this._p[k] = v; } },
  set innerHTML(v) { this._html = String(v); },
  get innerHTML() { return this._html; }
};
const others = {};
const document = {
  querySelector(sel) {
    if (sel === '#ring-fg') return ringFg;
    if (sel === '#ring-arcs') return ringArcsEl;
    if (sel === '#set-autocap') return inputs.autoCap;
    if (sel === '#set-autohide') return inputs.autoHide;
    if (sel === '#set-ringflow') return inputs.ringFlow;
    if (sel === '#set-pinned') return inputs.pinned;
    if (!others[sel]) others[sel] = { style: {}, hidden: false, set onclick(v) {}, set onchange(v) {} };
    return others[sel];
  },
  querySelectorAll: sel => {
    if (sel === '#ringGrad stop') return stops;
    return [];
  },
  addEventListener() {}
};
const window = { gu: {} };
const localStorage = { getItem: () => null, setItem() {} };
globalThis.__calls = [];

const deps = [
  'const $ = s => document.querySelector(s);',
  'const $$ = s => Array.from(document.querySelectorAll(s));',
  grab(/function saveSettings\(\)/)
].join('\n');

const makeApi = settingsSeed => {
  const code = [
    'let settings = ' + JSON.stringify(settingsSeed) + ';',
    'let records = [];',
    deps,
    'const timer = { mode: "stopwatch", status: "idle", phase: "focus", busy: false };',
    'let pipMode = false, capShown = false;',
    'function showCapsule() { globalThis.__calls.push("show"); }',
    'function hideCapsule() { globalThis.__calls.push("hide"); }',
    'function toast() {}',
    'const ringFg = $("#ring-fg");',
    block,
    'return { initSettingDefaults, on, applyPinned, updateRing,' +
    ' get settings() { return settings; }, timer, ringFg,' +
    ' set pipMode(v) { pipMode = v; }, get pipMode() { return pipMode; },' +
    ' set capShown(v) { capShown = v; }, get capShown() { return capShown; } };'
  ].join('\n');
  return new Function('window', 'document', 'localStorage', 'console', 'requestAnimationFrame', 'cancelAnimationFrame', code)(
    window, document, localStorage, console, () => 1, () => {});
};

/* ---------- 1. 默认值 ---------- */
console.log('\n[1] 设置默认值');
const a = makeApi({});
a.initSettingDefaults();
check('autoCap 默认开启', a.settings.autoCap === true);
check('autoHide 默认开启', a.settings.autoHide === true);
check('ringFlow 默认开启', a.settings.ringFlow === true);
check('pinned 默认关闭', a.settings.pinned === false);
const b = makeApi({ autoHide: false, ringFlow: false, pinned: true, autoCap: false });
b.initSettingDefaults();
check('已有取值不被覆盖', b.settings.autoHide === false && b.settings.pinned === true && b.settings.autoCap === false);

/* ---------- 2. 设置项校验（光圈几何与流转已移至 tests/ring-segments.test.js） ---------- */
console.log('\n[2] 设置项取值');
const c = makeApi({ ringFlow: true });
check('ringFlow=true 时 on() 为真', c.on('ringFlow') === true);
const c2 = makeApi({ ringFlow: false });
check('ringFlow=false 时 on() 为假', c2.on('ringFlow') === false);

/* ---------- 3. updateRing 的开关行为 ---------- */
console.log('\n[3] 光圈更新与定时器');
// 关闭该设置时的三条分支（开启时的分档取色在 tests/ring-segments.test.js 断言）
const d = makeApi({ ringFlow: false });
d.timer.status = 'running';
d.updateRing();
check('关闭该设置：光圈为品牌金色',
  d.ringFg.style.stroke === '#c9a15e', String(d.ringFg.style.stroke));
check('关闭该设置：渐变三档同色（与描边一致）',
  new Set(stops.map(s => s._a['stop-color'])).size === 1, JSON.stringify(stops.map(s => s._a['stop-color'])));

const e = makeApi({ ringFlow: false });
e.timer.status = 'running';
e.updateRing();
check('关闭该设置：仍为金色', e.ringFg.style.stroke === '#c9a15e', String(e.ringFg.style.stroke));

const f = makeApi({ ringFlow: false });
f.timer.status = 'running';
f.timer.mode = 'focus';
f.timer.phase = 'short';
f.updateRing();
check('关闭流转 + 休息阶段：光圈为青玉', f.ringFg.style.stroke === '#7fa89a', String(f.ringFg.style.stroke));

const g = makeApi({ ringFlow: true });
g.timer.status = 'idle';
g.updateRing();
const s2 = stops.map(s => s._a['stop-color']);
check('空闲且开启流转：不启动动画、用静止渐变', s2[0] === '#e8c98a' && s2[2] === '#7fa89a', JSON.stringify(s2));

/* ---------- 4. 置顶开关下发 ---------- */
console.log('\n[4] 置顶开关下发');
const sent = [];
window.gu.setPinned = v => { sent.push(v); return Promise.resolve(true); };
const h = makeApi({ pinned: true });
h.applyPinned();
check('pinned=true 时下发 true', sent.length === 1 && sent[0] === true, JSON.stringify(sent));
h.pipMode = true;
h.applyPinned();
check('浮窗模式下强制下发 true', sent[sent.length - 1] === true, JSON.stringify(sent));
const h2 = makeApi({ pinned: false });
sent.length = 0;
h2.applyPinned();
check('pinned=false 且非浮窗时下发 false', sent.length === 1 && sent[0] === false, JSON.stringify(sent));

/* ---------- 5. 设置改动即时生效 ---------- */
console.log('\n[5] 改动设置即时生效');
globalThis.__calls = [];
const i2 = makeApi({});
i2.initSettingDefaults();
const { bindSettings } = new Function('window', 'document', 'localStorage', 'console',
  ['let settings = ' + JSON.stringify({}) + ';', deps,
    'const timer = { mode: "stopwatch", status: "running", phase: "focus" };',
    'let pipMode = true, capShown = false;',
    'function showCapsule() { globalThis.__calls.push("show"); }',
    'function hideCapsule() { globalThis.__calls.push("hide"); }',
    'function applyPinned() {}', 'function updateRing() {}', 'function closeSettings() {}',
    block, 'return { bindSettings };'].join('\n'))(window, document, localStorage, console, () => 1, () => {});
bindSettings();
inputs.autoCap.checked = true;
inputs.autoCap.onchange();
check('开启自动胶囊且正在计时 → 立即缩为胶囊', globalThis.__calls.includes('show'), JSON.stringify(globalThis.__calls));
inputs.autoCap.checked = false;
inputs.autoCap.onchange();
check('关闭自动胶囊不会误触发隐藏', globalThis.__calls.filter(x => x === 'hide').length === 0, JSON.stringify(globalThis.__calls));

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
