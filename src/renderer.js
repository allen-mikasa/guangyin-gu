/* ================= 光阴蛊 · 渲染主逻辑 ================= */
const STUDY_MODULES = ['资料分析', '言语理解', '判断推理', '数量关系', '常识判断', '政治理论', '申论'];
const LIFE_MODULES = ['休息', '用餐', '运动', '杂务', '睡眠'];
const SOUNDS = [
  { id: 'ocean', name: '海浪' }, { id: 'rain', name: '细雨' },
  { id: 'stream', name: '溪涧' }, { id: 'wind', name: '晚风' },
  { id: 'fire', name: '篝火' }, { id: 'white', name: '白噪音' }
];
const QUICK_MIN = [1, 3, 5, 10, 25, 30, 45, 60, 90];
const RING_C = 2 * Math.PI * 140;
const HEARTBEAT_MS = 15000;

let records = [];
let settings = loadSettings();
settings.customStudy = Array.isArray(settings.customStudy) ? settings.customStudy : [];
settings.customLife = Array.isArray(settings.customLife) ? settings.customLife : [];

// 长河页时段状态：day | week | month | year | total，cursor 为选中期内任意一天
const river = { range: 'day', cursor: new Date() };
// 「今天」的日期键：多处口径以它为界（此前误写成 buildBuckets 的局部变量，导致周/月视图崩溃）。
// 惰性求值，避免与 dateKey 的声明顺序相互牵制。
let _todayKey = null;
function todayKey() { return _todayKey || (_todayKey = dateKey()); }
// 热力图取色阶（与图例同源）
const HEAT_COLORS = ['#16202e', '#274452', '#3d6b68', '#7a9a72', '#c9a15e'];

// 浮窗置顶
let pipMode = false;
let savedPage = 'timer';
// 胶囊形态
let capShown = false;
let idleHideTimer = null;

const timer = {
  mode: 'stopwatch',
  scene: null, module: null,
  status: 'idle',           // idle | running | paused
  busy: false,              // 自动结算进行中，拦截重入与手动操作
  startedAt: 0,
  accumulatedMs: 0,
  plannedMs: null,
  recordId: null,
  recordStartAt: 0,
  // 专注模式
  studyModule: null,
  phase: 'focus', round: 1,
  focusCfg: { focus: 25, short: 5, long: 15, cycle: 4 },
  completedFocus: 0
};

/* ---------------- 工具 ---------------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const pad = n => String(n).padStart(2, '0');
function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function hm(ts) { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function hms(ts) { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
function weekday(key) { return ['日', '一', '二', '三', '四', '五', '六'][new Date(key + 'T00:00:00').getDay()]; }
function shichen(h) {
  const names = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  return names[Math.floor(((h + 1) % 24) / 2)] + '时';
}
function fmtClock(ms) {
  ms = Math.max(0, Math.floor(ms / 1000)) * 1000;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}
function fmtDur(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h}小时${m}分`;
  if (m) return `${m}分${s ? s + '秒' : ''}`;
  return `${s}秒`;
}
function fmtHour(sec) {
  if (sec >= 3600) return (sec / 3600).toFixed(1) + ' 小时';
  if (sec >= 60) return Math.round(sec / 60) + ' 分钟';
  return Math.round(sec) + ' 秒';
}
function loadSettings() {
  try { return JSON.parse(localStorage.getItem('guangyin-settings') || '{}'); } catch (e) { return {}; }
}
function saveSettings() { localStorage.setItem('guangyin-settings', JSON.stringify(settings)); }
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 2200);
}
function modal(title, body) {
  return new Promise(resolve => {
    $('#modal-title').textContent = title;
    $('#modal-body').textContent = body;
    $('#modal-mask').hidden = false;
    const ok = $('#modal-ok'), cancel = $('#modal-cancel');
    const done = v => { $('#modal-mask').hidden = true; ok.onclick = null; cancel.onclick = null; resolve(v); };
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
  });
}
/** 带输入框的弹窗，返回去空格文本或 null（取消） */
function promptModal(title, value = '', placeholder = '') {
  return new Promise(resolve => {
    $('#modal-title').textContent = title;
    const body = $('#modal-body');
    body.innerHTML = '';
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'modal-input'; inp.maxLength = 12;
    inp.value = value; inp.placeholder = placeholder;
    body.appendChild(inp);
    $('#modal-mask').hidden = false;
    const ok = $('#modal-ok'), cancel = $('#modal-cancel');
    ok.classList.remove('danger');
    setTimeout(() => { inp.focus(); inp.select(); }, 60);
    const done = v => {
      $('#modal-mask').hidden = true;
      ok.onclick = null; cancel.onclick = null; inp.onkeydown = null;
      ok.classList.add('danger');
      resolve(v);
    };
    ok.onclick = () => done(inp.value.trim());
    cancel.onclick = () => done(null);
    inp.onkeydown = e => {
      if (e.key === 'Enter') ok.click();
      if (e.key === 'Escape') cancel.click();
    };
  });
}

/* ---------------- 初始化 ---------------- */
async function init() {
  buildModuleGrids();
  buildSounds();
  buildQuickTimes();
  bindEvents();
  initSettingDefaults();
  bindSettings();
  applySettingsUI();
  records = await window.gu.getRecords();
  await recoverSessions();
  records = await window.gu.getRecords();
  refreshAll();
  applyPinned();
  updateRing();
  clockTick();
  setInterval(clockTick, 1000);
  setInterval(tick, 250);
  setInterval(heartbeat, HEARTBEAT_MS);
}

function buildModuleGrids() {
  buildSceneGrid('study', STUDY_MODULES, settings.customStudy);
  buildSceneGrid('life', LIFE_MODULES, settings.customLife);
}
function buildSceneGrid(scene, builtins, customs) {
  const g = $(scene === 'study' ? '#study-grid' : '#life-grid');
  g.innerHTML = '';
  builtins.forEach(m => g.appendChild(moduleBtn(scene, m, false)));
  customs.forEach(m => g.appendChild(moduleBtn(scene, m, true)));
  const add = document.createElement('button');
  add.className = 'module-btn add-custom';
  add.textContent = '＋ 自定义';
  add.onclick = () => addCustom(scene);
  g.appendChild(add);
}
function moduleBtn(scene, m, isCustom) {
  const b = document.createElement('button');
  b.className = 'module-btn' + (isCustom ? ' custom' : '');
  b.dataset.scene = scene; b.dataset.module = m;
  b.innerHTML = `${m}<span class="m-time"></span>` +
    (isCustom ? '<span class="m-ops"><i class="op-rename" title="改名">✎</i><i class="op-del" title="删除">✕</i></span>' : '');
  b.onclick = e => {
    if (e.target.closest('.m-ops')) return;
    selectModule(scene, m);
  };
  if (isCustom) {
    b.querySelector('.op-rename').onclick = e => { e.stopPropagation(); renameCustom(scene, m); };
    b.querySelector('.op-del').onclick = e => { e.stopPropagation(); removeCustom(scene, m); };
  }
  return b;
}
async function addCustom(scene) {
  if (timer.status !== 'idle') { toast('计时进行中，请先结束当前光阴'); return; }
  const key = scene === 'study' ? 'customStudy' : 'customLife';
  const name = await promptModal(scene === 'study' ? '新建修习科目' : '新建凡尘事项', '', scene === 'study' ? '如：错题复盘' : '如：通勤');
  if (!name) return;
  if (name.length > 10) { toast('名称请控制在 10 字以内'); return; }
  const all = [...(scene === 'study' ? STUDY_MODULES : LIFE_MODULES), ...settings[key]];
  if (all.includes(name)) { toast('该名称已存在'); return; }
  settings[key].push(name); saveSettings();
  buildModuleGrids(); renderModuleTimes();
  selectModule(scene, name);
  toast('已添加「' + name + '」');
}
async function renameCustom(scene, oldName) {
  if (timer.status !== 'idle') { toast('计时进行中，请先结束当前光阴'); return; }
  const key = scene === 'study' ? 'customStudy' : 'customLife';
  const name = await promptModal('更改事项名称', oldName, '输入新名称');
  if (!name || name === oldName) return;
  if (name.length > 10) { toast('名称请控制在 10 字以内'); return; }
  const all = [...(scene === 'study' ? STUDY_MODULES : LIFE_MODULES), ...settings[key].filter(x => x !== oldName)];
  if (all.includes(name)) { toast('该名称已存在'); return; }
  settings[key] = settings[key].map(x => x === oldName ? name : x);
  if (settings.lastScene === scene && settings.lastModule === oldName) settings.lastModule = name;
  saveSettings();
  buildModuleGrids(); renderModuleTimes();
  if (timer.scene === scene && timer.module === oldName) {
    timer.module = name;
    if (scene === 'study') timer.studyModule = name;
    $('#dial-module').textContent = name;
  }
  selectModule(scene, name);
  toast('已更名为「' + name + '」');
}
async function removeCustom(scene, name) {
  if (timer.status !== 'idle') { toast('计时进行中，请先结束当前光阴'); return; }
  const ok = await modal('删除自定义事项', `将移除「${name}」选项（历史卷宗记录不受影响），确认？`);
  if (!ok) return;
  const key = scene === 'study' ? 'customStudy' : 'customLife';
  settings[key] = settings[key].filter(x => x !== name);
  saveSettings();
  if (timer.scene === scene && timer.module === name) {
    timer.scene = null; timer.module = null;
    $('#dial-module').textContent = '未择科目';
    $('#dial-sub').textContent = '选择模块，即刻启程';
  }
  buildModuleGrids(); renderModuleTimes();
  toast('已移除「' + name + '」');
}
function buildSounds() {
  const list = $('#sound-list');
  SOUNDS.forEach(s => {
    const row = document.createElement('div');
    row.className = 'sound-item'; row.id = `sound-${s.id}`;
    row.innerHTML = `<div class="s-name">${s.name}</div><input type="range" min="0" max="100" value="50">`;
    const name = row.querySelector('.s-name'), slider = row.querySelector('input');
    name.onclick = () => {
      const on = !row.classList.contains('on');
      row.classList.toggle('on', on);
      window.soundEngine.toggle(s.id, on, slider.value / 100);
      settings[`snd_${s.id}`] = on;
      saveSettings();
    };
    slider.oninput = () => {
      window.soundEngine.setVolume(s.id, slider.value / 100);
      settings[`vol_${s.id}`] = slider.value; saveSettings();
    };
    list.appendChild(row);
  });
}
function buildQuickTimes() {
  const box = $('#quick-times');
  QUICK_MIN.forEach((m, i) => {
    const b = document.createElement('button');
    b.textContent = m + '分'; b.dataset.min = m;
    if (m === 25) b.classList.add('active');
    b.onclick = () => {
      $$('#quick-times button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      $('#cd-min').value = m; $('#cd-sec').value = 0;
    };
    box.appendChild(b);
  });
}
function applySettingsUI() {
  // 声音
  SOUNDS.forEach(s => {
    const row = $(`#sound-${s.id}`);
    const slider = row.querySelector('input');
    if (settings[`vol_${s.id}`] != null) slider.value = settings[`vol_${s.id}`];
    if (settings[`snd_${s.id}`]) {
      row.classList.add('on');
      window.soundEngine.toggle(s.id, true, slider.value / 100);
    }
  });
  if (settings.masterVol != null) $('#master-vol').value = settings.masterVol;
  window.soundEngine.masterVol = ($('#master-vol').value) / 100;
  // 专注配置
  const fc = settings.focusCfg;
  if (fc) {
    $('#fk-focus').value = fc.focus; $('#fk-short').value = fc.short;
    $('#fk-long').value = fc.long; $('#fk-cycle').value = fc.cycle;
    timer.focusCfg = { ...timer.focusCfg, ...fc };
  }
  if (settings.lastModule) selectModule(settings.lastScene || 'study', settings.lastModule);
}

function bindEvents() {
  $$('.tab').forEach(t => t.onclick = () => {
    $$('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $$('.page').forEach(p => p.classList.remove('active'));
    $(`#page-${t.dataset.page}`).classList.add('active');
    if (t.dataset.page !== 'timer') $('#page-timer').classList.remove('active');
    refreshAll();
  });

  $$('#mode-switch button').forEach(b => b.onclick = () => setMode(b.dataset.mode));

  $('#btn-start').onclick = start;
  $('#btn-pause').onclick = pause;
  $('#btn-resume').onclick = resume;
  $('#btn-stop').onclick = () => stop(false);

  $('#master-vol').oninput = e => {
    window.soundEngine.setMaster(e.target.value / 100);
    settings.masterVol = e.target.value; saveSettings();
  };

  $('#btn-clear').onclick = async () => {    const ok = await modal('清空卷宗', '所有计时记录将被永久删除，且不可恢复。确要清空？');
    if (ok) {
      await window.gu.clearRecords();
      records = []; refreshAll(); toast('卷宗已清空');
    }
  };
  $('#btn-export-csv').onclick = exportCSV;

  // 卷宗：按事项名称搜索
  const searchEl = $('#record-search');
  const clearEl = $('#record-search-clear');
  searchEl.oninput = () => {
    scrollSearch = searchEl.value;
    clearEl.hidden = !scrollSearch;
    renderScroll();
  };
  searchEl.onkeydown = e => { if (e.key === 'Escape') { searchEl.value = ''; scrollSearch = ''; clearEl.hidden = true; renderScroll(); } };
  clearEl.onclick = () => {
    searchEl.value = ''; scrollSearch = ''; clearEl.hidden = true;
    renderScroll(); searchEl.focus();
  };

  // 极往
  bindPastEvents();

  // 长河：日 / 周 / 月 / 年 / 总计
  $$('#river-range button').forEach(b => b.onclick = () => {
    river.range = b.dataset.range;
    $$('#river-range button').forEach(x => x.classList.toggle('active', x === b));
    renderRiver();
  });
  $('#river-prev').onclick = () => shiftCursor(-1);
  $('#river-next').onclick = () => shiftCursor(1);
  $('#river-today').onclick = () => { river.cursor = new Date(); renderRiver(); };
  $('#river-chart').onclick = e => {
    const col = e.target.closest('.river-col');
    if (!col || !col.dataset.drill) return;
    const nextRange = col.dataset.drillRange === 'month' ? 'month' : 'day';
    // 下钻落点取该桶的中间时刻（此前一律落在 1 号/周一，视觉上像没跳）
    const cur = col.dataset.drillCursor ? new Date(+col.dataset.drillCursor) : new Date(col.dataset.drill);
    river.range = nextRange;
    river.cursor = cur;
    $$('#river-range button').forEach(x => x.classList.toggle('active', x.dataset.range === nextRange));
    renderRiver();
  };
  $('#heatmap').onclick = onHeatClick;

  // 浮窗置顶 / 胶囊
  $('#btn-pip').onclick = enterPip;
  $('#btn-pip-exit').onclick = exitPip;
  $('#btn-cap').onclick = async () => {
    if (capShown) await hideCapsule();
    else if (timer.status === 'running') await showCapsule();
  };
}

/* ---------------- 设置 ---------------- */
const SETTING_KEYS = ['autoCap', 'autoHide', 'ringFlow', 'pinned'];
const SETTING_DEFAULTS = { autoCap: true, autoHide: true, ringFlow: true, pinned: false };
const SETTING_INPUTS = { autoCap: '#set-autocap', autoHide: '#set-autohide', ringFlow: '#set-ringflow', pinned: '#set-pinned' };

function initSettingDefaults() {
  SETTING_KEYS.forEach(k => {
    if (typeof settings[k] !== 'boolean') settings[k] = SETTING_DEFAULTS[k];
  });
  saveSettings();
}
function on(k) { return !!settings[k]; }

function openSettings() {
  SETTING_KEYS.forEach(k => { const el = $(SETTING_INPUTS[k]); if (el) el.checked = on(k); });
  $('#settings-mask').hidden = false;
}
function closeSettings() { $('#settings-mask').hidden = true; }

function bindSettings() {
  Object.entries(SETTING_INPUTS).forEach(([key, sel]) => {
    const el = $(sel);
    if (!el) return;
    el.onchange = () => {
      settings[key] = !!el.checked;
      saveSettings();
      if (key === 'pinned') applyPinned();
      if (key === 'ringFlow') updateRing();
      if (key === 'autoCap' && pipMode) {
        if (settings.autoCap && timer.status === 'running' && !capShown) showCapsule();
        else if (!settings.autoCap && capShown) hideCapsule();
      }
    };
  });
  $('#btn-settings').onclick = openSettings;
  $('#settings-close').onclick = closeSettings;
  $('#settings-mask').onclick = e => { if (e.target === $('#settings-mask')) closeSettings(); };
}

/** 把「始终置顶」落到主进程（不改变窗口尺寸，只切总在最前） */
function applyPinned() {
  if (typeof window.gu.setPinned !== 'function') return;
  const want = settings.pinned || pipMode;
  window.gu.setPinned(want).catch(() => {});
}

/* ---------------- 光圈随进度变色 ---------------- */
// 配色刻意压低饱和度、并在每档末尾平滑过渡，避免跳色突兀
const RING_FLOW_COLORS = ['#8fd3b0', '#c9705f', '#bfc9d4', '#d0ae6e', '#a98ad0'];

/** 进度分段取色：0~1/5 翠绿 → 1/5~2/5 赤红 → 2/5~3/5 银白 → 3/5~4/5 金黄 → 4/5~1 亮紫。
 *  每档末段（末 20%）与下一档做插值，颜色是"走到该处才转过去"，不是跳变。 */
function hexToRgb(h) {
  const v = h.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
function lerpColor(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const f = n => Math.round(A[n] + (B[n] - A[n]) * t);
  return `rgb(${f(0)}, ${f(1)}, ${f(2)})`;
}
function ringFlowColor(t) {
  const n = RING_FLOW_COLORS.length;
  const p = Math.max(0, Math.min(0.999999, t));
  const i = Math.min(n - 1, Math.floor(p * n));    // 恰好 1.0 时归属最后一档
  const local = p * n - i;                          // 本档内的推进量 0..1
  const BLEND_START = 0.8;                          // 末 20% 才开始过渡到下一档
  if (local <= BLEND_START || i === n - 1) return RING_FLOW_COLORS[i];
  return lerpColor(RING_FLOW_COLORS[i], RING_FLOW_COLORS[i + 1], (local - BLEND_START) / (1 - BLEND_START));
}
function setRingStops(c1, c2, c3) {
  const stops = document.querySelectorAll('#ringGrad stop');
  if (!stops || stops.length < 3) return;
  stops[0].setAttribute('stop-color', c1);
  stops[1].setAttribute('stop-color', c2);
  stops[2].setAttribute('stop-color', c3);
}
/** 当前进度（0..1）：正计时为一小时一圈，与表盘读数同一口径 */
function ringProgress(elapsed) {
  if (timer.plannedMs) return Math.min(1, Math.max(0, elapsed / timer.plannedMs));
  return ((elapsed % 3600000) / 3600000);
}
/** 光圈外观统一入口：随进度变色 / 休息青玉 / 空闲金玉渐变，只在这里决定。
 *  frac 与表盘读数同一口径（倒计时/专注=已完成比例，正计时=当小时内比例）。 */
function updateRing(frac, isRestArg) {
  const fg = $('#ring-fg');
  if (!fg) return;
  const isRest = isRestArg != null ? isRestArg : (timer.mode === 'focus' && timer.phase !== 'focus');
  if (timer.status === 'idle' || !on('ringFlow')) {
    if (timer.status === 'idle') {
      fg.style.stroke = '';                       // 由 url(#ringGrad) 的静止渐变接管
      setRingStops('#e8c98a', '#c9a15e', '#7fa89a');
    } else if (isRest) {
      fg.style.stroke = '#7fa89a';
      setRingStops('#7fa89a', '#7fa89a', '#7fa89a');
    } else {
      fg.style.stroke = '#c9a15e';
      setRingStops('#c9a15e', '#c9a15e', '#c9a15e');
    }
    return;
  }
  const t = frac == null ? ringProgress(currentElapsed()) : frac;
  const c = ringFlowColor(t);
  fg.style.stroke = c;
  setRingStops(c, c, c);
}

/* ---------------- 浮窗置顶 ---------------- */
function switchPageOnly(page) {
  $$('.tab').forEach(x => x.classList.toggle('active', x.dataset.page === page));
  $$('.page').forEach(p => p.classList.remove('active'));
  $('#page-' + page).classList.add('active');
}

async function enterPip() {
  if (pipMode) return;
  const active = $('.tab.active');
  savedPage = active ? active.dataset.page : 'timer';
  if (savedPage !== 'timer') switchPageOnly('timer');
  pipMode = true;
  document.body.classList.add('pip');
  $('#pip-bar').hidden = false;
  await window.gu.enterPip();
  updateCapButton();
  capDiag(`enterPip 完成：timer.status=${timer.status} autoCap=${on('autoCap')} pipMode=${pipMode}`);
  // 胶囊形态由设置决定；关闭后就只保留浮窗小窗
  if (on('autoCap') && timer.status === 'running') {
    await showCapsule();
    toast('计时中已缩为胶囊，点 ✕ 退出置顶');
  } else if (!on('autoCap')) {
    toast('已进入浮窗置顶');
  } else {
    toast('浮窗置顶已开启，开始计时会自动缩为胶囊');
  }
}

async function exitPip() {
  if (!pipMode) return;
  clearTimeout(idleHideTimer);
  if (capShown) { await window.gu.capClose(); capShown = false; }
  pipMode = false;
  document.body.classList.remove('pip');
  $('#pip-bar').hidden = true;
  await window.gu.exitPip();
  updateCapButton();
  applyPinned();          // 退出浮窗后按设置决定是否仍然置顶
  if (savedPage !== 'timer') {
    switchPageOnly(savedPage);
    refreshAll();
  }
}

/** 主进程已恢复窗口时，仅复位界面 */
function resetPipUI() {
  clearTimeout(idleHideTimer);
  capShown = false; pipMode = false;
  document.body.classList.remove('pip');
  $('#pip-bar').hidden = true;
  updateCapButton();
}

/* ---------------- 胶囊形态 ---------------- */
/** 诊断：把胶囊相关决策写进 userData/guangyin-pip.log（打包后看不到控制台） */
function capDiag(msg) {
  if (window.gu && typeof window.gu.capDiag === 'function') window.gu.capDiag(msg).catch(() => {});
}
async function showCapsule() {
  if (!pipMode) { capDiag('showCapsule 跳过：pipMode=false'); return; }
  if (capShown) { capDiag('showCapsule 跳过：胶囊已显示'); return; }
  if (!on('autoCap')) { capDiag('showCapsule 跳过：设置里已关闭自动胶囊'); return; }
  capDiag(`showCapsule 执行：mode=${timer.mode} status=${timer.status} module=${timer.module} plannedMs=${timer.plannedMs}`);
  capShown = true;
  updateCapButton();
  pushCapState();
  const ok = await window.gu.capShow();
  capDiag('capShow 返回=' + JSON.stringify(ok));
}
async function hideCapsule() {
  if (!capShown) return;
  capShown = false;
  updateCapButton();
  await window.gu.capHide();
}
function pushCapState() {
  if (!pipMode || !capShown) return;
  const elapsed = currentElapsed();
  const showMs = timer.plannedMs ? Math.max(0, timer.plannedMs - elapsed) : elapsed;
  const isRest = timer.mode === 'focus' && timer.phase !== 'focus';
  window.gu.capState({ module: timer.module, time: fmtClock(showMs), rest: isRest });
}
function updateCapButton() {
  const btn = $('#btn-cap');
  if (btn) btn.hidden = !(pipMode && !capShown && timer.status === 'running');
}
/** 计时结束后空闲自动隐藏（可在设置里关闭） */
function scheduleIdleHide() {
  if (!pipMode) return;
  clearTimeout(idleHideTimer);
  if (!on('autoHide')) {
    toast('计时已结束，窗口保持显示');
    return;
  }
  toast('窗口将自动隐藏，可由托盘图标或 Ctrl+Alt+G 召回');
  idleHideTimer = setTimeout(async () => {
    if (pipMode && timer.status === 'idle') {
      if (capShown) { await window.gu.capClose(); capShown = false; }
      await window.gu.hideSelf();
    }
  }, 4000);
}

/* ---------------- 模块 / 模式选择 ---------------- */
function selectModule(scene, m) {
  if (timer.status !== 'idle') { toast('计时进行中，请先结束当前光阴'); return; }
  timer.scene = scene; timer.module = m; timer.studyModule = scene === 'study' ? m : timer.studyModule;
  settings.lastModule = m; settings.lastScene = scene; saveSettings();
  $$('.module-btn').forEach(b => b.classList.toggle('selected', b.dataset.module === m && b.dataset.scene === scene));
  $('#dial-module').textContent = m;
  $('#dial-sub').textContent = scene === 'study' ? '将赴光阴长河' : '凡尘诸事 · 自在安排';
}
function setMode(mode) {
  if (timer.status !== 'idle') { toast('计时进行中，不可更换模式'); return; }
  timer.mode = mode;
  $$('#mode-switch button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  $('#cfg-countdown').hidden = mode !== 'countdown';
  $('#cfg-focus').hidden = mode !== 'focus';
  $('#dial-sub').textContent = mode === 'focus' ? '一轮专注，一轮调息' : (mode === 'countdown' ? '限定光阴，分秒必争' : '但行前路，无问西东');
}

/* ---------------- 计时核心 ---------------- */
function readPlannedMs() {  if (timer.mode === 'countdown') {
    const m = Math.max(0, Math.min(600, parseInt($('#cd-min').value) || 0));
    const s = Math.max(0, Math.min(59, parseInt($('#cd-sec').value) || 0));
    const ms = (m * 60 + s) * 1000;
    return ms > 0 ? ms : null;
  }
  if (timer.mode === 'focus') {
    const cfg = {
      focus: clampInt('#fk-focus', 1, 180, 25),
      short: clampInt('#fk-short', 1, 60, 5),
      long: clampInt('#fk-long', 1, 60, 15),
      cycle: clampInt('#fk-cycle', 2, 12, 4)
    };
    timer.focusCfg = cfg; settings.focusCfg = cfg; saveSettings();
    return cfg.focus * 60000;
  }
  return null;
}
function clampInt(sel, min, max, def) {
  const v = parseInt($(sel).value);
  if (isNaN(v)) return def;
  return Math.max(min, Math.min(max, v));
}

async function start() {
  if (!timer.module) { toast('请先择一科目或事项'); return; }
  if (timer.mode === 'focus' && timer.scene !== 'study') { toast('专注模式请先择一修习科目'); return; }
  const planned = readPlannedMs();
  if (timer.mode !== 'stopwatch' && !planned) { toast('请设定有效的时辰'); return; }

  timer.status = 'running';
  timer.startedAt = Date.now();
  timer.accumulatedMs = 0;
  timer.plannedMs = planned;
  timer.phase = 'focus'; timer.round = 1; timer.completedFocus = 0;
  lockUI(true);
  await beginRecord();
  scheduleEnd();
  if (pipMode && on('autoCap')) await showCapsule();
}

async function pause() {
  if (timer.busy) return;                 // 自动结算正在落库，别插队
  if (timer.status !== 'running') return;
  const now = Date.now();
  timer.accumulatedMs += now - timer.startedAt;
  timer.status = 'paused';
  timer.startedAt = 0;
  window.gu.cancelDeadline();
  const old = records.find(r => r.id === timer.recordId) || {};
  await persistCurrent({ status: 'paused', segments: closeLastSegment(old, now) });
  updateControlButtons();
  if (capShown) await hideCapsule();
}

async function resume() {
  if (timer.busy) return;
  if (timer.status !== 'paused') return;
  const now = Date.now();
  const old = records.find(r => r.id === timer.recordId) || {};
  timer.status = 'running';
  timer.startedAt = now;
  scheduleEnd();
  await persistCurrent({ status: 'running', segments: appendSegment(old, now) });
  updateControlButtons();
  if (pipMode && on('autoCap')) await showCapsule();
}

/** 手动结束 */
async function stop(manual = true) {
  if (timer.status === 'idle') return;
  const elapsed = currentElapsed();
  const reached = timer.plannedMs && elapsed >= timer.plannedMs;
  window.gu.cancelDeadline();

  let status, completed;
  if (timer.mode === 'stopwatch') { status = 'finished'; completed = true; }
  else { status = reached ? 'finished' : 'aborted'; completed = !!reached; }

  await closeRecord(status, completed, elapsed);
  resetTimerUI(timer.mode === 'focus');
  refreshAll();
  if (pipMode) {
    if (capShown) await hideCapsule();
    scheduleIdleHide();
  } else if (manual) toast(reached ? '此段光阴，已得圆满' : '此段光阴已封存');
}

/** 到点自动完成一段。
 *  必须在上锁后才允许 await：主进程 deadline 与本地 250ms tick 是两条独立触发路径，
 *  此前 closeRecord 的多次 IPC 等待窗口内会被再次进入，同一段光阴结算两次。 */
async function finishPhaseAuto() {
  if (timer.status !== 'running' || timer.busy) return;
  timer.busy = true;
  timer.status = 'idle';            // 立刻失效，拦住 tick / deadline 的第二发
  let shouldReset = true;
  try {
    const elapsed = timer.plannedMs;
    timer.accumulatedMs = elapsed;
    window.gu.cancelDeadline();
    window.soundEngine.bell(3);

    if (timer.mode === 'countdown') {
      await closeRecord('finished', true, elapsed);
      window.gu.notify('倒计时终了', `${timer.module} · ${fmtDur(timer.plannedMs / 1000)} 已圆满`);
      resetTimerUI(false);
      refreshAll();
      if (pipMode) {
        if (capShown) await hideCapsule();
        scheduleIdleHide();
      } else toast('时辰已到，功不唐捐');
      return;
    }

    // 专注模式：轮转
    if (timer.phase === 'focus') {
      timer.completedFocus++;
      await closeRecord('finished', true, elapsed);
      const isLong = timer.round % timer.focusCfg.cycle === 0;
      const nextPhase = isLong ? 'long' : 'short';
      const nextMin = isLong ? timer.focusCfg.long : timer.focusCfg.short;
      window.gu.notify(`第 ${timer.round} 轮专注功成`, isLong ? '长休片刻，再赴长河' : '且歇片刻，调息养心');
      await beginPhase('rest', nextPhase, timer.round, nextMin * 60000);
    } else {
      const wasLong = timer.phase === 'long';
      await closeRecord('finished', true, elapsed);
      const nextRound = wasLong ? 1 : timer.round + 1;
      window.gu.notify('休息时辰已尽', '再赴光阴长河');
      await beginPhase('focus', 'focus', nextRound, timer.focusCfg.focus * 60000);
    }
    shouldReset = false;            // 已由 beginPhase 接续下一轮，状态保持 running
    refreshAll();
  } finally {
    // 若期间用户手动结束/暂停，保留其状态；否则恢复 running
    if (shouldReset && !timer.recordId) timer.status = 'idle';
    else if (shouldReset) timer.status = 'running';
    timer.busy = false;
    updateControlButtons();
  }
}

async function beginPhase(kind, phase, round, plannedMs) {
  timer.phase = phase; timer.round = round;
  timer.plannedMs = plannedMs;
  timer.accumulatedMs = 0; timer.startedAt = Date.now();
  if (kind === 'rest') {
    timer.scene = 'life'; timer.module = '休息';
  } else {
    timer.scene = 'study'; timer.module = timer.studyModule || STUDY_MODULES[0];
  }
  await beginRecord();
  scheduleEnd();
}

function currentElapsed() {
  return timer.accumulatedMs + (timer.status === 'running' ? Date.now() - timer.startedAt : 0);
}

/* ---------------- 记录持久化 ---------------- */
async function saveRecord(rec) {
  await window.gu.upsertRecord(rec);
  records = await window.gu.getRecords();
}

async function beginRecord() {
  const now = Date.now();
  const rec = {
    id: 'r_' + now.toString(36) + Math.random().toString(36).slice(2, 6),
    date: dateKey(),
    startAt: new Date(now).toISOString(),
    endAt: null,
    durationSec: 0,
    plannedSec: timer.plannedMs ? timer.plannedMs / 1000 : null,
    mode: timer.mode,
    scene: timer.scene,
    module: timer.module,
    status: 'running',
    completed: false,
    phase: timer.mode === 'focus' ? timer.phase : null,
    round: timer.mode === 'focus' ? timer.round : null,
    segments: [{ start: new Date(now).toISOString(), end: null }],
    updatedAt: now
  };
  timer.recordId = rec.id;
  timer.recordStartAt = now;
  $('#dial-module').textContent = timer.module;
  await saveRecord(rec);
  highlightRunningModule();
}

async function persistCurrent(extra = {}) {
  if (!timer.recordId) return;
  const elapsed = currentElapsed();
  const old = records.find(r => r.id === timer.recordId) || {};
  const rec = {
    ...old,
    durationSec: Math.floor(elapsed / 1000),
    module: timer.module, scene: timer.scene,
    phase: timer.mode === 'focus' ? timer.phase : null,
    round: timer.mode === 'focus' ? timer.round : null,
    updatedAt: Date.now(),
    ...extra
  };
  await saveRecord(rec);
}

async function closeRecord(status, completed, elapsedMs) {
  if (!timer.recordId) return;
  const old = records.find(r => r.id === timer.recordId) || {};
  const now = Date.now();
  const rec = {
    ...old,
    endAt: new Date(now).toISOString(),
    durationSec: Math.max(1, Math.floor(elapsedMs / 1000)),
    status, completed,
    module: timer.module, scene: timer.scene,
    phase: timer.mode === 'focus' ? timer.phase : null,
    round: timer.mode === 'focus' ? timer.round : null,
    segments: closeLastSegment(old, now),
    updatedAt: now
  };
  await saveRecord(rec);
  timer.recordId = null;
}

async function heartbeat() {
  if (timer.status === 'running' && timer.recordId) {
    await persistCurrent({ status: 'running' });
    records = await window.gu.getRecords();
    renderToday();
    renderModuleTimes();
    highlightRunningModule();
  }
}

function scheduleEnd() {
  if (!timer.plannedMs) { window.gu.cancelDeadline(); return; }
  const elapsed = currentElapsed();
  const deadline = Date.now() + timer.plannedMs - elapsed;
  window.gu.scheduleDeadline(deadline, { kind: 'phaseEnd' });
}

/** 异常退出恢复 */
async function recoverSessions() {
  const pendings = records.filter(r => r.status === 'running' || r.status === 'paused');
  for (const r of pendings) {
    if (r.status === 'running') {
      const endTs = r.updatedAt || Date.now();
      await saveRecord({
        ...r, status: 'aborted',
        endAt: new Date(endTs).toISOString(),
        segments: closeLastSegment(r, endTs),
        updatedAt: Date.now()
      });
    } else {
      // 暂停态：恢复到界面
      timer.mode = r.mode;
      timer.scene = r.scene; timer.module = r.module;
      if (r.scene === 'study') timer.studyModule = r.module;
      timer.status = 'paused';
      timer.accumulatedMs = (r.durationSec || 0) * 1000;
      timer.startedAt = 0;
      timer.plannedMs = r.plannedSec ? r.plannedSec * 1000 : null;
      timer.phase = r.phase || 'focus'; timer.round = r.round || 1;
      timer.recordId = r.id; timer.recordStartAt = new Date(r.startAt).getTime();
      if (timer.mode === 'focus' && settings.focusCfg) timer.focusCfg = { ...timer.focusCfg, ...settings.focusCfg };
      setModeSilent(r.mode);
      lockUI(true);
      $('#btn-pause').hidden = true; $('#btn-resume').hidden = false; $('#btn-stop').hidden = false;
      $$('.module-btn').forEach(b => b.classList.toggle('selected', b.dataset.module === r.module && b.dataset.scene === r.scene));
      $('#dial-module').textContent = r.module;
      toast('已恢复上次未竟的计时');
    }
  }
}
function setModeSilent(mode) {
  timer.mode = mode;
  $$('#mode-switch button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  $('#cfg-countdown').hidden = mode !== 'countdown';
  $('#cfg-focus').hidden = mode !== 'focus';
}

/* ---------------- UI 刷新 ---------------- */
function lockUI(locked) {
  $$('#mode-switch button, .module-btn, #cfg-countdown input, #cfg-focus input, #quick-times button')
    .forEach(el => el.disabled = locked);
  updateControlButtons();
}
function updateControlButtons() {
  const running = timer.status === 'running', paused = timer.status === 'paused';
  $('#btn-start').hidden = running || paused;
  $('#btn-pause').hidden = !running;
  $('#btn-resume').hidden = !paused;
  $('#btn-stop').hidden = !running && !paused;
  updateCapButton();
}
function resetTimerUI(restoreStudy = false) {
  timer.status = 'idle';
  timer.accumulatedMs = 0; timer.startedAt = 0;
  timer.plannedMs = null; timer.recordId = null;
  timer.phase = 'focus'; timer.round = 1; timer.completedFocus = 0;
  if (restoreStudy && timer.studyModule) {
    timer.scene = 'study'; timer.module = timer.studyModule;
    $$('.module-btn').forEach(b => b.classList.toggle('selected', b.dataset.module === timer.studyModule && b.dataset.scene === 'study'));
    $('#dial-module').textContent = timer.studyModule;
  }
  lockUI(false);
  $$('.module-btn').forEach(b => b.classList.remove('running'));
  updateRing(0, false);
}
function highlightRunningModule() {
  $$('.module-btn').forEach(b => b.classList.toggle('running', b.dataset.module === timer.module && timer.status !== 'idle'));
}

function tick() {
  if (timer.status === 'idle') { updateDial(); return; }
  const elapsed = currentElapsed();
  // 本地到点检测（双保险）
  if (timer.plannedMs && timer.status === 'running' && elapsed >= timer.plannedMs) {
    finishPhaseAuto();
    return;
  }
  updateDial(elapsed);
  pushCapState();
}

function updateDial(elapsed = timer.status === 'idle' ? 0 : currentElapsed()) {
  let showMs, frac;
  const isRest = timer.mode === 'focus' && timer.phase !== 'focus';
  if (timer.plannedMs) {
    showMs = timer.status === 'idle' ? timer.mode === 'stopwatch' ? 0 : (readPlannedMs() || 0) : Math.max(0, timer.plannedMs - elapsed);
    frac = timer.status === 'idle' ? 0 : Math.min(1, elapsed / timer.plannedMs);
  } else {
    showMs = elapsed;
    frac = (elapsed % 3600000) / 3600000; // 正计时：一小时一圈
  }
  $('#dial-time').textContent = fmtClock(showMs);
  const pipTitle = $('#pip-title');
  if (pipTitle) pipTitle.textContent = timer.module || '光阴蛊';
  $('#ring-fg').style.strokeDashoffset = RING_C * (1 - (timer.status === 'idle' && timer.plannedMs ? 0 : frac));
  updateRing(frac, isRest);

  // 副标题
  let sub = '';
  if (timer.mode === 'focus' && timer.status !== 'idle') {
    const phaseName = timer.phase === 'focus' ? `第 ${timer.round} 轮 · 专注` : (timer.phase === 'long' ? `第 ${timer.round} 轮后 · 长休` : `第 ${timer.round} 轮后 · 短休`);
    $('#dial-sub').textContent = phaseName;
    $('#dial-sub').className = 'dial-sub ' + (isRest ? 'phase-rest' : 'phase-focus');
  } else if (timer.status === 'paused') {
    $('#dial-sub').textContent = '光阴暂歇';
    $('#dial-sub').className = 'dial-sub';
  } else if (timer.status === 'running') {
    $('#dial-sub').textContent = timer.mode === 'stopwatch' ? '光阴流淌中…' : '分秒必争中…';
    $('#dial-sub').className = 'dial-sub';
  }
}

/* ---------------- 统计 ---------------- */
function effectiveRecords() {
  return records.filter(r => r.status === 'finished' || r.status === 'aborted');
}
function refreshAll() {
  renderToday();
  renderRiver();
  renderScroll();
  renderModuleTimes();
  renderPast();
}
function sumBy(list, pred) { return list.filter(pred).reduce((s, r) => s + (r.durationSec || 0), 0); }

function renderToday() {
  const today = dateKey();
  const t0 = startOfDay(new Date());
  const t1 = new Date(t0.getTime() + 86400000);
  // 段数仍按记录创建日统计
  const todayRecs = effectiveRecords().filter(r => r.date === today);
  // 时长按片段与今日的实际交集（跨天记录正确分摊）
  let studySec = 0, lifeSec = 0;
  const map = {};
  effectiveRecords().forEach(r => {
    const sec = recordSecInRange(r, t0.getTime(), t1.getTime());
    if (sec <= 0) return;
    if (r.scene === 'study') studySec += sec; else lifeSec += sec;
    map[r.module] = (map[r.module] || 0) + sec;
  });
  $('#today-total').textContent = fmtHour(studySec);
  $('#today-sub').textContent = `修习 ${todayRecs.filter(r => r.scene === 'study').length} 段 · 诸事 ${todayRecs.filter(r => r.scene === 'life').length} 段`;
  const top = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = top.length ? top[0][1] : 1;
  $('#today-bars').innerHTML = top.map(([m, s]) =>
    `<div class="tbar"><span class="tbar-name">${m}</span><div class="tbar-track"><div class="tbar-fill" style="width:${Math.max(3, s / max * 100)}%"></div></div><span class="tbar-val">${fmtHour(s)}</span></div>`
  ).join('') || '<div style="text-align:center;color:var(--text-faint);font-size:13px;">尚无记录</div>';
}

function renderModuleTimes() {
  const t0 = startOfDay(new Date());
  const t1 = new Date(t0.getTime() + 86400000);
  const map = {};
  effectiveRecords().forEach(r => {
    const sec = recordSecInRange(r, t0.getTime(), t1.getTime());
    if (sec > 0) map[r.module] = (map[r.module] || 0) + sec;
  });
  $$('.module-btn').forEach(b => {
    const tag = b.querySelector('.m-time');
    if (!tag) return;
    const s = map[b.dataset.module] || 0;
    tag.textContent = s ? '今日 ' + fmtHour(s) : '';
  });
}

function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

/* ---- 计时片段（打标）：开始/继续开段，暂停/结束闭段 ---- */
function normalizeSegs(old) {
  if (Array.isArray(old.segments) && old.segments.length) {
    return old.segments.map(s => ({ start: s.start, end: s.end || null }));
  }
  return [{ start: old.startAt || new Date().toISOString(), end: null }];
}
function closeLastSegment(old, endTs) {
  const segs = normalizeSegs(old);
  const last = segs[segs.length - 1];
  if (!last.end) last.end = new Date(endTs).toISOString();
  return segs;
}
function appendSegment(old, startTs) {
  const segs = normalizeSegs(old);
  segs.push({ start: new Date(startTs).toISOString(), end: null });
  return segs;
}
/** 取记录的实际计时片段（毫秒；兼容无 segments 的旧记录） */
function segmentsOf(r) {
  const fallbackEnd = r.endAt ? +new Date(r.endAt)
    : (r.status === 'running' ? Date.now() : (r.updatedAt || +new Date(r.startAt)));
  if (Array.isArray(r.segments) && r.segments.length) {
    return r.segments.map(s => ({
      start: +new Date(s.start),
      end: s.end ? +new Date(s.end)
        : (r.status === 'running' ? Date.now() : (r.updatedAt || +new Date(s.start)))
    })).filter(s => isFinite(s.start) && isFinite(s.end) && s.end > s.start);
  }
  const st = +new Date(r.startAt);
  if (!isFinite(st) || !isFinite(fallbackEnd) || fallbackEnd <= st) return [];
  return [{ start: st, end: fallbackEnd }];
}
/** 两区间重叠秒数 */
function overlapSec(aStart, aEnd, bStart, bEnd) {
  const st = Math.max(aStart, bStart);
  const en = Math.min(aEnd, bEnd);
  return en > st ? (en - st) / 1000 : 0;
}
/** 一条记录与 [bStart,bEnd) 的实际交集秒数（null 表示无界） */
function recordSecInRange(r, bStart, bEnd) {
  let sec = 0;
  segmentsOf(r).forEach(sg => {
    let st = sg.start, en = sg.end;
    if (bStart != null) st = Math.max(st, bStart);
    if (bEnd != null) en = Math.min(en, bEnd);
    if (en > st) sec += (en - st) / 1000;
  });
  return sec;
}
function rangeBounds(range, cursor) {
  const c = startOfDay(cursor);
  if (range === 'day') return [c, new Date(c.getFullYear(), c.getMonth(), c.getDate() + 1)];
  if (range === 'week') {
    const mon = (c.getDay() + 6) % 7;
    const s = new Date(c); s.setDate(c.getDate() - mon);
    const e = new Date(s); e.setDate(s.getDate() + 7);
    return [s, e];
  }
  if (range === 'month') return [new Date(c.getFullYear(), c.getMonth(), 1), new Date(c.getFullYear(), c.getMonth() + 1, 1)];
  if (range === 'year') return [new Date(c.getFullYear(), 0, 1), new Date(c.getFullYear() + 1, 0, 1)];
  return [null, null];
}
function inRangeRec(r, sKey, eKey) {
  if (sKey === null) return true;
  return r.date >= sKey && r.date < eKey;
}
/** [s, e) 内已经历的天数（已被"今天"截断；用于日均）。
 *  修掉旧 elapsedDays 的两个问题：历史整段被截断成"今天几号"、未来区间算出 0 天再被 max(1) 强行变 1。 */
function daysElapsedInRange(s, e) {
  const today = startOfDay(new Date()).getTime();
  const from = s ? startOfDay(s).getTime() : today;
  const to = e ? Math.min(startOfDay(new Date(+e - 1)).getTime(), today) : today; // e 为开区间，退一天取末日
  if (!isFinite(from) || !isFinite(to) || to < from) return 0;
  return Math.floor((to - from) / 86400000) + 1;
}
function shiftCursor(dir) {
  if (river.range === 'total') return;
  const d = new Date(river.cursor);
  if (river.range === 'day') d.setDate(d.getDate() + dir);
  else if (river.range === 'week') d.setDate(d.getDate() + 7 * dir);
  else if (river.range === 'month') d.setMonth(d.getMonth() + dir);
  else if (river.range === 'year') d.setFullYear(d.getFullYear() + dir);
  river.cursor = d;
  renderRiver();
}

/** 构建时间桶并把各记录片段按实际交集分摊 */
function buildBuckets(range, s, e, listAll) {
  const sTs = s ? s.getTime() : null, eTs = e ? e.getTime() : null;
  const sKey = s ? dateKey(s) : null;
  let buckets = [], xLabelIdx = [], unitName = '日', chartName = '';
  if (range === 'day') {
    for (let h = 0; h < 24; h++) {
      const bStart = sTs + h * 3600000;
      buckets.push({ key: h + '时', bStart, bEnd: bStart + 3600000, sec: 0, lifeSec: 0, drill: null });
    }
    xLabelIdx = [0, 3, 6, 9, 12, 15, 18, 21, 23];
    unitName = '时';
    chartName = sKey === todayKey() ? '今日时辰' : `${sKey.slice(5).replace('-', '月') + '日'} 时辰`;
  } else if (range === 'week') {
    const wNames = ['一', '二', '三', '四', '五', '六', '日'];
    for (let i = 0; i < 7; i++) {
      const d = new Date(s); d.setDate(s.getDate() + i);
      const k = dateKey(d), bStart = d.getTime();
      buckets.push({
        key: '周' + wNames[i], bStart, bEnd: bStart + 86400000, sec: 0, lifeSec: 0,
        drill: k <= todayKey() ? k : null, drillRange: 'day',
        drillCursor: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime()
      });
    }
    xLabelIdx = buckets.map((_, i) => i);
    unitName = '日';
    chartName = sKey <= todayKey() && todayKey() < eTs ? '本周七日' : '七日光阴';
  } else if (range === 'month') {
    const days = new Date(s.getFullYear(), s.getMonth() + 1, 0).getDate();
    for (let i = 1; i <= days; i++) {
      const d = new Date(s.getFullYear(), s.getMonth(), i);
      const k = dateKey(d), bStart = d.getTime();
      buckets.push({
        key: i + '', bStart, bEnd: bStart + 86400000, sec: 0, lifeSec: 0,
        drill: k <= todayKey() ? k : null, drillRange: 'day',
        drillCursor: new Date(s.getFullYear(), s.getMonth(), i, 12).getTime()
      });
    }
    xLabelIdx = [0, 4, 9, 14, 19, 24, days - 1];
    unitName = '日';
    chartName = (s.getFullYear() === new Date().getFullYear() && s.getMonth() === new Date().getMonth()) ? '本月每日' : '当月每日';
  } else if (range === 'year') {
    for (let m = 0; m < 12; m++) {
      const bStart = new Date(s.getFullYear(), m, 1).getTime();
      const bEnd = new Date(s.getFullYear(), m + 1, 1).getTime();
      const mk = dateKey(new Date(bStart));
      buckets.push({
        key: (m + 1) + '月', bStart, bEnd, sec: 0, lifeSec: 0,
        drill: mk <= todayKey() ? mk : null, drillRange: 'month',
        drillCursor: new Date(s.getFullYear(), m, 15, 12).getTime()
      });
    }
    xLabelIdx = buckets.map((_, i) => i);
    unitName = '月';
    chartName = s.getFullYear() === new Date().getFullYear() ? '本年十二月' : s.getFullYear() + '年十二月';
  } else {
    const first = listAll.slice().sort((a, b) => (a.startAt || '').localeCompare(b.startAt || ''))[0];
    const now = new Date();
    const fm = first ? new Date(first.startAt) : now;
    let y = fm.getFullYear(), m = fm.getMonth();
    while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth())) {
      const bStart = new Date(y, m, 1).getTime();
      const bEnd = new Date(y, m + 1, 1).getTime();
      buckets.push({
        key: `${String(y).slice(2)}/${m + 1}`, bStart, bEnd, sec: 0, lifeSec: 0,
        drill: dateKey(new Date(bStart)), drillRange: 'month',
        drillCursor: new Date(y, m, 15, 12).getTime()
      });
      m++; if (m > 11) { m = 0; y++; }
    }
    if (!buckets.length) buckets.push({ key: '无', bStart: 0, bEnd: 0, sec: 0, lifeSec: 0, drill: null, drillRange: null, drillCursor: null });
    xLabelIdx = buckets.map((_, i) => (i === 0 || i === buckets.length - 1 || i % 3 === 0) ? i : -1).filter(i => i >= 0);
    unitName = '月';
    chartName = '全部月份';
  }

  // 把每条记录的片段按实际交集分摊进桶。
  // 外层先按片段自身时间范围裁掉无关桶，避免「记录数 × 桶数」的无效全量扫描。
  listAll.forEach(r => {
    const segs = segmentsOf(r);
    let rMin = Infinity, rMax = -Infinity;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].start < rMin) rMin = segs[i].start;
      if (segs[i].end > rMax) rMax = segs[i].end;
    }
    if (!isFinite(rMin) || rMax <= rMin) return;
    for (let bi = 0; bi < buckets.length; bi++) {
      const b = buckets[bi];
      if (b.bEnd <= rMin || b.bStart >= rMax) continue;
      let sec = 0;
      for (let i = 0; i < segs.length; i++) sec += overlapSec(segs[i].start, segs[i].end, b.bStart, b.bEnd);
      if (sec > 0) { if (r.scene === 'study') b.sec += sec; else b.lifeSec += sec; }
    }
  });
  return { buckets, xLabelIdx, unitName, chartName };
}

function renderRiver() {
  const listAll = effectiveRecords();
  const [s, e] = rangeBounds(river.range, river.cursor);
  const sTs = s ? s.getTime() : null, eTs = e ? e.getTime() : null;
  const sKey = s ? dateKey(s) : null, eKey = e ? dateKey(e) : null;
  // 时长按片段与范围的实际交集
  let studySec = 0, lifeSec = 0;
  listAll.forEach(r => {
    const sec = recordSecInRange(r, sTs, eTs);
    if (r.scene === 'study') studySec += sec; else lifeSec += sec;
  });
  // 卷宗条目 / 专注圆满按记录创建日归属
  const list = listAll.filter(r => inRangeRec(r, sKey, eKey));
  const focusDone = list.filter(r => r.mode === 'focus' && r.completed && r.phase === 'focus').length;

  // 日均修习：分子是"真实时间交集"，分母必须是同一区间的已过天数，否则历史/未来区间会虚高
  let denom;
  if (river.range === 'total') {
    const first = listAll.slice().sort((a, b) => (a.startAt || '').localeCompare(b.startAt || ''))[0];
    denom = first ? daysElapsedInRange(startOfDay(new Date(first.startAt)), null) : 0;
  } else denom = daysElapsedInRange(s, e);
  const avgSec = denom > 0 ? Math.round(studySec / denom) : 0;

  const rangeName = cursorLabel();
  const cards = [
    [rangeName + '修习', fmtHour(studySec)],
    [rangeName + '凡尘', fmtHour(lifeSec)],
    ['卷宗条目', list.length + ' 条'],
    ['日均修习', denom > 0 ? fmtHour(avgSec) : '—'],
    ['专注圆满', focusDone + ' 轮']
  ];
  $('#stat-cards').innerHTML = cards.map(([l, v]) =>
    `<div class="stat-card"><div class="sc-val">${v}</div><div class="sc-label">${l}</div></div>`).join('');

  // 时间桶：修习/凡尘时长按片段与桶的实际交集分摊
  const bb = buildBuckets(river.range, s, e, listAll);
  const buckets = bb.buckets, xLabelIdx = bb.xLabelIdx, unitName = bb.unitName, chartName = bb.chartName;

  // 柱图：修习 + 凡尘堆叠；峰值刻度取真实峰值（不再被 600 秒下限掩盖）
  const maxSec = Math.max(1, ...buckets.map(b => b.sec + b.lifeSec));
  $('#river-chart').innerHTML = buckets.map(b => {
    const tot = b.sec + b.lifeSec;
    const h = tot ? Math.max(3, Math.sqrt(tot / maxSec) * 100) : 0;
    const pStudy = tot ? b.sec / tot * 100 : 0;
    const tip = `${b.key}：修习 ${fmtHour(b.sec)}${b.lifeSec ? '，凡尘 ' + fmtHour(b.lifeSec) : ''}${b.drill ? '（点击下钻）' : ''}`;
    const isToday = b.drill === todayKey();
    const attr = `data-today="${isToday ? 1 : 0}" title="${tip}"` +
      (b.drill ? ` data-drill="${b.drill}" data-drill-range="${b.drillRange || 'day'}"${b.drillCursor ? ` data-drill-cursor="${b.drillCursor}"` : ''}` : '');
    if (!tot) return `<div class="river-col" ${attr}><div class="rc-dot"></div></div>`;
    const stack = b.sec && b.lifeSec
      ? `<div class="rc-bar rc-study" data-h="${(h * pStudy / 100).toFixed(2)}"></div><div class="rc-bar rc-life" data-h="${(h * (100 - pStudy) / 100).toFixed(2)}"></div>`
      : `<div class="rc-bar ${b.sec ? 'rc-study' : 'rc-life'}" data-h="${h.toFixed(2)}"></div>`;
    return `<div class="river-col" ${attr}>${stack}</div>`;
  }).join('');
  // 柱图生长动画：首帧保持初始高度 0，下一帧过渡到目标高度
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $('#river-chart').querySelectorAll('.rc-bar').forEach(bar => {
      bar.style.height = bar.dataset.h + '%';
    });
  }));
  $('#river-x').style.gridTemplateColumns = `repeat(${buckets.length}, 1fr)`;
  $('#river-x').innerHTML = xLabelIdx.map(i => {
    const b = buckets[i]; if (!b) return '';
    return `<span style="grid-column:${i + 1}">${b.key}</span>`;
  }).join('');
  $('#river-unit').textContent = `峰值 ${fmtHour(maxSec)} / ${unitName}`;
  $('#river-title').innerHTML = `<span class="deco">◆</span> 光阴长河 · ${chartName}`;

  // 图例：柱图用两色堆叠，热力图用它自己的五级色阶
  const heatPanel = $('.heat-panel');
  if (heatPanel) {
    heatPanel.title = '每一格代表一天：颜色越亮表示该日修习时长越多，点击可跳到那一天';
    const ht = heatPanel.querySelector('.panel-title');
    if (ht) ht.textContent = river.range === 'day' || river.range === 'week' ? '长河星图 · 近二十周' : '长河星图 · 近十二月';
  }
  const lg = $('.legend-cells');
  if (lg && !lg.dataset.stack) {
    lg.dataset.stack = '1';
    lg.innerHTML =
      `<i style="background:linear-gradient(180deg,#e8c98a,#c9a15e)"></i><span class="legend-tag">修习</span>` +
      `<i style="background:linear-gradient(180deg,#9dc3b5,#7fa89a)"></i><span class="legend-tag">凡尘</span>` +
      `<i style="background:#16202e"></i><i style="background:#274452"></i><i style="background:#3d6b68"></i>` +
      `<i style="background:#7a9a72"></i><i style="background:#c9a15e"></i><span class="legend-tag">星图深浅</span>`;
  }

  // 光标标签 / 翻页按钮
  $('#river-cursor-label').textContent = cursorLabel();
  const t = startOfDay(new Date());
  $('#river-prev').disabled = river.range === 'total';
  $('#river-next').disabled = river.range === 'total' || (s && s > t);

  // 模块分布（当前范围内修习，片段交集）
  const modMap = {};
  listAll.filter(r => r.scene === 'study').forEach(r => {
    const sec = recordSecInRange(r, sTs, eTs);
    if (sec > 0) modMap[r.module] = (modMap[r.module] || 0) + sec;
  });
  const ranked = Object.entries(modMap).sort((a, b) => b[1] - a[1]);
  const rMax = ranked.length ? ranked[0][1] : 1;
  $('#module-rank').innerHTML = ranked.length ? ranked.map(([m, sec]) =>
    `<div class="rank-row"><span class="rk-name">${m}</span><div class="rk-track"><div class="rk-fill" style="width:${Math.max(2, sec / rMax * 100)}%"></div></div><span class="rk-val">${fmtHour(sec)}</span></div>`
  ).join('') : '<div style="color:var(--text-faint);font-size:13px;text-align:center;padding:20px;">此期尚无修习记录</div>';

  // 长河星图：日/周 → 近 20 周；月/年/总计 → 近 12 个月；格子日期一律锚定当天 00:00
  const studyList = listAll.filter(r => r.scene === 'study');
  const dayMap = aggregateByDay(studyList);
  const byDay = {};
  Object.keys(dayMap).forEach(k => { byDay[k] = dayMap[k]; });
  const WEEKS = 20, MONTHS = 12;
  const dow = (t.getDay() + 6) % 7;                                 // 周一为一周之始
  const weekStart = new Date(t.getFullYear(), t.getMonth(), t.getDate() - dow - (WEEKS - 1) * 7);
  const monthStart = new Date(t.getFullYear(), t.getMonth() - (MONTHS - 1), 1);
  const showWeeks = river.range === 'day' || river.range === 'week';
  const heatmapEl = $('#heatmap');
  // 每列固定 7 行（周一→周日），不再依赖 grid 自动流动，避免行数错乱把格子排到可视区外
  heatmapEl.classList.toggle('wide', !showWeeks);
  heatmapEl.innerHTML = showWeeks
    ? renderHeatWeeks(weekStart, WEEKS, byDay, t)
    : renderHeatMonths(monthStart, MONTHS, byDay, t);

  refreshPageHint();
}

/** 提示当前页是否已在托盘常驻（窗口隐藏后可由托盘 / Ctrl+Alt+G 召回） */
function refreshPageHint() {
  const el = $('#river-hint');
  if (el) el.textContent = '时长按真实计时片段与区间交集计算；条目按开始日归属。窗口隐藏后可由托盘图标或 Ctrl+Alt+G 召回。';
}

/** 汇总每天的修习秒数（key 为 dateKey，与 dateKey(startOfDay) 口径一致） */
function aggregateByDay(list) {
  const map = {};
  list.forEach(r => {
    segmentsOf(r).forEach(sg => {
      let cur = startOfDay(new Date(sg.start)).getTime();
      let guard = 0;
      while (cur < sg.end && guard++ < 800) {
        const sec = overlapSec(sg.start, sg.end, cur, cur + 86400000);
        if (sec > 0) {
          const k = dateKey(new Date(cur));
          map[k] = (map[k] || 0) + sec;
        }
        cur += 86400000;
      }
    });
  });
  return map;
}

/** 单列（一周），从上到下固定 7 行：周一 → 周日 */
function heatColumnHtml(days, monthLabel) {
  const head = monthLabel ? `<span class="heat-month">${monthLabel}</span>` : '';
  return `<div class="heat-col">${head}${days.join('')}</div>`;
}

/** 一天一格；sec 为当日修习秒数 */
function heatCellHtml(key, sec, opts) {
  const o = opts || {};
  const bg = sec > 0 ? HEAT_COLORS[Math.min(4, Math.ceil(Math.sqrt(sec / 3600) * 2.8))] : HEAT_COLORS[0];
  const mark = o.monthStart ? ' month-start' : '';
  const tip = `${key} 周${weekday(key)}：${fmtHour(sec)}修习`;
  return `<div class="heat-cell clickable${mark}" data-day="${key}" style="background:${bg}" title="${tip}"></div>`;
}

/** 近 N 周星图：一周一列，列内周一到周日共 7 格 */
function renderHeatWeeks(weekStart, weeks, byDay, today) {
  const cols = [];
  for (let w = 0; w < weeks; w++) {
    const days = [];
    for (let r = 0; r < 7; r++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + w * 7 + r);
      if (d > today) { days.push('<div class="heat-cell empty"></div>'); continue; }
      const k = dateKey(d);
      days.push(heatCellHtml(k, byDay[k] || 0, { monthStart: d.getDate() === 1 }));
    }
    cols.push(heatColumnHtml(days, null));
  }
  return cols.join('');
}

/** 近 N 月星图：仍是一周一列、列内 7 格；列首标注该周所属月份，跨月处描金线 */
function renderHeatMonths(monthStart, months, byDay, today) {
  const first = new Date(monthStart);
  first.setDate(1 - ((first.getDay() + 6) % 7));                    // 回退到首个周一
  const td = startOfDay(today);
  const cols = [];
  let lastMonthKey = '';
  for (let w = 0; w < 60; w++) {
    const ws = new Date(first);
    ws.setDate(first.getDate() + w * 7);
    if (ws > td) break;
    const days = [];
    for (let r = 0; r < 7; r++) {
      const dd = new Date(ws);
      dd.setDate(ws.getDate() + r);
      if (dd > td) { days.push('<div class="heat-cell empty"></div>'); continue; }
      const k = dateKey(dd);
      days.push(heatCellHtml(k, byDay[k] || 0, { monthStart: dd.getDate() === 1 }));
    }
    // 哪一列是该月第一次出现，就在哪一列标月份（该周可能跨月，格子上另有金线标记 1 号）
    const mk = `${ws.getFullYear()}-${ws.getMonth()}`;
    const label = mk === lastMonthKey
      ? null
      : (ws.getMonth() === 0 ? `${ws.getFullYear()}年` : `${ws.getMonth() + 1}月`);
    lastMonthKey = mk;
    cols.push(heatColumnHtml(days, label));
  }
  return cols.join('');
}

/** 点星图格子 → 跳到那一天（日视图） */
function onHeatClick(e) {
  const cell = e.target.closest ? e.target.closest('.heat-cell[data-day]') : null;
  if (!cell) return;
  const [y, m, d] = cell.dataset.day.split('-').map(Number);
  river.range = 'day';
  river.cursor = new Date(y, m - 1, d, 12);
  $$('#river-range button').forEach(x => x.classList.toggle('active', x.dataset.range === 'day'));
  renderRiver();
}

function cursorLabel() {
  const c = startOfDay(river.cursor), t = startOfDay(new Date());
  if (river.range === 'total') return '全部光阴';
  if (river.range === 'day') return +c === +t ? '今日' : `${c.getMonth() + 1}月${c.getDate()}日 周${weekday(dateKey(c))}`;
  if (river.range === 'week') {
    const [s, e] = rangeBounds('week', c);
    if (s <= t && t < e) return '本周';
    const e2 = new Date(e.getTime() - 86400000);
    return `${s.getMonth() + 1}.${s.getDate()} – ${e2.getMonth() + 1}.${e2.getDate()}`;
  }
  if (river.range === 'month') return (c.getFullYear() === t.getFullYear() && c.getMonth() === t.getMonth()) ? '本月' : `${c.getFullYear()}年${c.getMonth() + 1}月`;
  return c.getFullYear() === t.getFullYear() ? '本年' : c.getFullYear() + '年';
}

/* ---------------- 卷宗 ---------------- */
let scrollFilter = 'all';
let scrollSearch = '';

/** 把「一段计时」切到自然日：与长河完全同一口径（真实时间交集）。
 *  返回 [{ key, start, end, sec, segIndex }]，当天即闭的普通记录只会产生一条。
 *  segIndex 是它在该记录原始 segments 里的序号（从 1 计），用于「第 n/N 段」标注 —— 
 *  不能用「当日分组内的位置」，否则会标出 20/2 这种越界序号。 */
function splitSegsByDay(r) {
  const out = [];
  segmentsOf(r).forEach((sg, i) => {
    let cur = startOfDay(new Date(sg.start)).getTime();
    let guard = 0;
    while (cur < sg.end && guard++ < 800) {
      const segEnd = Math.min(cur + 86400000, sg.end);
      const sec = (segEnd - Math.max(cur, sg.start)) / 1000;
      if (sec > 0) out.push({ key: dateKey(new Date(cur)), start: Math.max(cur, sg.start), end: segEnd, sec, segIndex: i + 1 });
      cur += 86400000;
    }
  });
  return out;
}

/** 记录列表 → 按天归属的行数据（跨夜记录会落在两天，时长按当天实际占用显示） */
function flattenRecordPieces(list) {
  return list.map(r => {
    const segs = splitSegsByDay(r);
    const days = new Set(segs.map(s => s.key));
    const plannedSec = r.plannedSec || 0;
    return {
      rec: r,
      multi: segs.length > 1,
      crossDay: days.size > 1,
      segs,
      isPaused: r.status === 'paused',
      isRunning: r.status === 'running',
      // 只有「计入计划时长的最后一面」才可能算圆满，避免跨界片段都被判圆满
      remainingSec: Math.max(0, plannedSec - segs.slice(0, -1).reduce((s, x) => s + x.sec, 0))
    };
  }).filter(it => it.segs.length);
}

function renderScroll() {
  $$('#record-filter button').forEach(b => {
    b.onclick = () => { scrollFilter = b.dataset.filter; $$('#record-filter button').forEach(x => x.classList.remove('active')); b.classList.add('active'); renderScroll(); };
  });
  const kw = scrollSearch.trim().toLowerCase();
  let list = records.slice().sort((a, b) => (b.startAt || '').localeCompare(a.startAt || ''));
  if (scrollFilter !== 'all') list = list.filter(r => r.scene === scrollFilter);
  const beforeSearch = list.length;
  if (kw) list = list.filter(r => String(r.module || '').toLowerCase().includes(kw));
  const items = flattenRecordPieces(list);

  $('#record-empty').hidden = !(beforeSearch === 0 && !kw);
  $('#record-no-match').hidden = !(kw && beforeSearch > 0 && items.length === 0);
  const cnt = $('#record-count');
  if (cnt) {
    const total = records.length;
    cnt.textContent = (kw || scrollFilter !== 'all')
      ? `命中 ${list.length} / 共 ${total} 条`
      : `共 ${total} 条`;
  }
  const groups = {};
  items.forEach(it => it.segs.forEach(s => { (groups[s.key] = groups[s.key] || []).push({ it, s }); }));

  const modeName = { stopwatch: '正计时', countdown: '倒计时', focus: '专注' };
  const html = Object.keys(groups).sort((a, b) => b.localeCompare(a)).map(day => {
    const entries = groups[day].sort((x, y) => x.s.start - y.s.start);
    const studySec = entries.filter(e => e.it.rec.scene === 'study').reduce((s, e) => s + e.s.sec, 0);
    const label = `<div class="record-day-label">${day} · 周${weekday(day)}${studySec ? ' · 修习 ' + fmtHour(studySec) : ''}</div>`;
    const rows = entries.map(({ it, s }) => {
      const r = it.rec;
      const range = `${hm(s.start)} — ${hm(s.end)}`;
      let statusHtml;
      if (r.status === 'paused') statusHtml = '<span class="status-abort">已暂停</span>';
      else if (r.status === 'running') statusHtml = '<span class="status-abort">进行中</span>';
      else if (r.completed && s.sec >= it.remainingSec - 2) statusHtml = '<span class="status-done">圆满</span>';
      else statusHtml = '<span class="status-abort">中辍</span>';
      const modLabel = (r.mode === 'focus' && r.phase && r.phase !== 'focus') ? `${r.module}（休）` : r.module;
      // 改名 / 删除是记录级操作，一条记录只在其首个片段上提供
      const isFirstEver = it.segs[0] === s;
      const ops = isFirstEver
        ? `<button class="edit-btn" data-id="${r.id}">改名</button><button class="del-btn" data-id="${r.id}">删除</button>`
        : '';
      const multiHere = it.segs.length > 1;
      const segTip = multiHere
        ? `（这轮计时分了 ${it.segs.length} 段：暂停/继续各开一段${it.crossDay ? '，跨零点又按天拆分' : ''}）`
        : '';
      const segTag = multiHere ? `<i class="seg-tag" title="这轮计时的第 ${s.segIndex} 段，共 ${it.segs.length} 段">${s.segIndex}/${it.segs.length}</i>` : '';
      return `<div class="record-row">
        <span class="col-date">${s.key.slice(5)}${s.key !== day ? ' …' : ''}</span>
        <span class="col-range">${range}</span>
        <span class="col-module" title="${modLabel}${segTip}">${modLabel}${segTag}${it.crossDay ? '<i class="seg-tag cross" title="这一段跨过了零点，按天拆开显示">跨夜</i>' : ''}${r.mode === 'focus' && r.round ? ' · 第' + r.round + '轮' : ''}</span>
        <span class="col-mode">${modeName[r.mode] || r.mode}</span>
        <span class="col-dur" data-sec="${Math.round(s.sec)}">${fmtDur(s.sec)}</span>
        <span class="col-status">${statusHtml}</span>
        <span class="col-op">${ops}</span>
      </div>`;
    }).join('');
    return label + rows;
  }).join('');

  const box = $('#record-list');
  box.innerHTML = html;
  box.querySelectorAll('.del-btn').forEach(btn => {
    btn.onclick = async () => {
      const ok = await modal('删除记录', '此段光阴记录将被删除，确认？');
      if (!ok) return;
      await window.gu.deleteRecord(btn.dataset.id);
      records = await window.gu.getRecords();
      refreshAll(); toast('已删除');
    };
  });
  box.querySelectorAll('.edit-btn').forEach(btn => {
    btn.onclick = async () => {
      const rec = records.find(r => r.id === btn.dataset.id);
      if (!rec) return;
      const res = await renameRecordModal(rec);
      if (!res) return;
      const moved = res.scene !== rec.scene;
      if (res.name === rec.module && !moved) return;
      await window.gu.upsertRecord({ ...rec, module: res.name, scene: res.scene, updatedAt: Date.now() });
      if (timer.recordId === rec.id) {
        timer.module = res.name;
        timer.scene = res.scene;
        if (res.scene === 'study') timer.studyModule = res.name;
        $('#dial-module').textContent = res.name;
      }
      records = await window.gu.getRecords();
      refreshAll();
      toast(moved
        ? `已改为「${res.name}」· 归入${res.scene === 'study' ? '修习' : '诸事'}`
        : `已更名为「${res.name}」`);
    };
  });
}

/* ---------------- 改名 / 归类 弹窗 ---------------- */
/** 改名可同时改归属；返回 { name, scene } 或 null（取消） */
function renameRecordModal(rec) {
  return new Promise(resolve => {
    const mask = $('#rename-mask');
    const inp = $('#rename-input');
    const hint = $('#rename-hint');
    const segBox = $('#rename-scene');
    let scene = rec.scene === 'study' ? 'study' : 'life';
    const paint = () => {
      segBox.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.scene === scene));
      hint.textContent = scene === 'study'
        ? '归入修习：会记入修习时长、日均与各科分布。'
        : '归入诸事：计入凡尘时长，不再出现在各科分布里。';
    };
    inp.value = rec.module || '';
    paint();
    mask.hidden = false;
    setTimeout(() => { inp.focus(); inp.select(); }, 60);

    const done = v => {
      mask.hidden = true;
      $('#rename-ok').onclick = null;
      $('#rename-cancel').onclick = null;
      inp.onkeydown = null;
      segBox.querySelectorAll('button').forEach(b => b.onclick = null);
      resolve(v);
    };
    const submit = () => {
      const name = inp.value.trim();
      if (!name) { toast('名称不能为空'); return; }
      if (name.length > 10) { toast('名称请控制在 10 字以内'); return; }
      done({ name, scene });
    };
    segBox.querySelectorAll('button').forEach(b => b.onclick = () => { scene = b.dataset.scene; paint(); });
    $('#rename-ok').onclick = submit;
    $('#rename-cancel').onclick = () => done(null);
    inp.onkeydown = e => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') done(null);
    };
    mask.onclick = e => { if (e.target === mask) done(null); };
  });
}

/* ================= 极往：自选事项的过往统计 ================= */
const PAST_RANGE_DAYS = { week: 7, month: 30, year: 365 };
const PAST_RANGE_NAME = { week: '近七日', month: '近三十日', year: '近一年', total: '全部' };
const PAST_COLORS = ['#c9a15e', '#7fa89a', '#8f9ec9', '#c08a6a', '#9ac98f', '#c98fa8', '#8fc9c4', '#b8a06a', '#a08fc9', '#c9b48f'];
const past = { picks: [], range: 'total' };

function pastRangeBounds() {
  if (past.range === 'total') return [null, null];
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const start = startOfDay(new Date());
  start.setDate(start.getDate() - (PAST_RANGE_DAYS[past.range] - 1));
  return [start, end];
}
const pastKeyOf = (scene, module) => scene + '\u0000' + module;

/** 所有出现过的科目/事项（含当前自定义项），附条数与总时长 */
function pastCatalog() {
  const map = new Map();
  effectiveRecords().forEach(r => {
    const key = pastKeyOf(r.scene, r.module);
    if (!map.has(key)) map.set(key, { scene: r.scene, module: r.module, count: 0, sec: 0 });
    const it = map.get(key);
    it.count++;
    it.sec += r.durationSec || 0;
  });
  return [...map.values()].sort((a, b) => b.sec - a.sec);
}

function pastSelectedSet() {
  return new Set(past.picks);
}

function ensurePastPicks() {
  const catalog = pastCatalog();
  const valid = new Set(catalog.map(c => pastKeyOf(c.scene, c.module)));
  past.picks = past.picks.filter(k => valid.has(k));
  if (!past.picks.length) catalog.slice(0, 4).forEach(c => past.picks.push(pastKeyOf(c.scene, c.module)));
}

function renderPastPicker() {
  const catalog = pastCatalog();
  const on = pastSelectedSet();
  const build = (scene, el) => {
    if (!el) return;
    const list = catalog.filter(c => c.scene === scene);
    if (!list.length) {
      el.innerHTML = '<span class="past-empty">暂无记录</span>';
      return;
    }
    el.innerHTML = list.map(c => {
      const key = pastKeyOf(c.scene, c.module);
      return `<button class="past-chip${scene === 'life' ? ' life' : ''}${on.has(key) ? ' on' : ''}" data-key="${encodeURIComponent(key)}" title="共 ${c.count} 条记录 · ${fmtHour(c.sec)}">
        ${c.module}<span class="chip-n">${c.count}</span></button>`;
    }).join('');
    el.querySelectorAll('.past-chip').forEach(btn => {
      btn.onclick = () => {
        const key = decodeURIComponent(btn.dataset.key);
        const set = pastSelectedSet();
        if (set.has(key)) past.picks = past.picks.filter(k => k !== key);
        else past.picks.push(key);
        renderPast();
      };
    });
  };
  build('study', $('#past-study-chips'));
  build('life', $('#past-life-chips'));
}

function bindPastEvents() {
  const pick = mode => {
    const catalog = pastCatalog();
    if (mode === 'all') past.picks = catalog.map(c => pastKeyOf(c.scene, c.module));
    else if (mode === 'none') past.picks = [];
    else past.picks = catalog.filter(c => c.scene === mode).map(c => pastKeyOf(c.scene, c.module));
    renderPast();
  };
  $('#past-pick-all').onclick = () => pick('all');
  $('#past-pick-none').onclick = () => pick('none');
  $('#past-pick-study').onclick = () => pick('study');
  $('#past-pick-life').onclick = () => pick('life');
  $$('#past-range button').forEach(b => b.onclick = () => {
    past.range = b.dataset.range;
    $$('#past-range button').forEach(x => x.classList.toggle('active', x === b));
    renderPast();
  });
}

function renderPast() {
  if (!$('#past-study-chips')) return;
  ensurePastPicks();
  renderPastPicker();

  const [from, to] = pastRangeBounds();
  const fTs = from ? from.getTime() : null, tTs = to ? to.getTime() : null;
  const picked = new Set(past.picks);
  const nodes = past.picks.map(k => {
    const [scene, module] = k.split('\u0000');
    return { key: k, scene, module };
  });
  const colorOf = new Map(nodes.map((n, i) => [n.key, PAST_COLORS[i % PAST_COLORS.length]]));

  // 每个选中事项在区间内的总秒数（片段与区间求交）
  const totals = nodes.map(n => ({
    ...n,
    sec: effectiveRecords()
      .filter(r => r.scene === n.scene && r.module === n.module)
      .reduce((s, r) => s + recordSecInRange(r, fTs, tTs), 0)
  }));
  const grand = totals.reduce((s, t) => s + t.sec, 0);

  // 概览卡
  const rangeName = PAST_RANGE_NAME[past.range];
  const cards = [
    ['所选事项', nodes.length + ' 项'],
    [rangeName + '合计', grand > 0 ? fmtHour(grand) : '—'],
    ['修习占比', grand > 0 ? Math.round(totals.filter(t => t.scene === 'study').reduce((s, t) => s + t.sec, 0) / grand * 100) + '%' : '—'],
    ['日均', (() => {
      const denom = past.range === 'total' ? daysElapsedInRange(from, to) : PAST_RANGE_DAYS[past.range];
      return grand > 0 && denom > 0 ? fmtHour(Math.round(grand / denom)) : '—';
    })()]
  ];
  $('#past-cards').innerHTML = cards.map(([l, v]) =>
    `<div class="stat-card"><div class="sc-val">${v}</div><div class="sc-label">${l}</div></div>`).join('');

  // 走势：按时段粒度分桶，堆叠显示各事项
  const buckets = pastBuckets(rangeName);
  const maxSec = Math.max(1, ...buckets.map(b => b.sec));
  const bucketTops = buckets.map((b, i) => ({ ...b, idx: i, total: b.sec }));
  $('#past-chart').innerHTML = bucketTops.map(b => {
    if (b.sec <= 0) return '<div class="past-col" title="' + b.key + '：无记录"><div class="pb-dot"></div></div>';
    const stacks = nodes.map(n => {
      const sec = b.byKey[n.key] || 0;
      if (sec <= 0) return '';
      const h = Math.max(2, sec / maxSec * 100);
      return `<div class="pb" data-h="${h.toFixed(2)}" style="background:${colorOf.get(n.key)}" title="${n.module} ${fmtHour(sec)}"></div>`;
    }).join('');
    return `<div class="past-col" title="${b.key}：合计 ${fmtHour(b.sec)}">${stacks}</div>`;
  }).join('');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $('#past-chart').querySelectorAll('.pb').forEach(el => { el.style.height = el.dataset.h + '%'; });
  }));
  $('#past-x').style.gridTemplateColumns = `repeat(${buckets.length}, 1fr)`;
  const step = Math.max(1, Math.ceil(buckets.length / 12));
  $('#past-x').innerHTML = buckets.map((b, i) =>
    `<span style="grid-column:${i + 1}">${(i % step === 0 || i === buckets.length - 1) ? b.key : ''}</span>`).join('');
  $('#past-trend-title').innerHTML = `<span class="deco">◆</span> 岁月走势 · ${rangeName}`;

  // 图例
  const legend = $('#past-note');
  const ranked = totals.slice().sort((a, b) => b.sec - a.sec);
  $('#past-share').innerHTML = ranked.length ? ranked.map(t => {
    const pct = grand > 0 ? t.sec / grand * 100 : 0;
    return `<div class="share-row">
      <span class="sr-name" title="${t.module}">${t.module}</span>
      <div class="sr-track"><div class="sr-fill" style="width:${Math.max(1, pct)}%;background:${colorOf.get(t.key)}"></div></div>
      <span class="sr-val">${t.sec > 0 ? fmtHour(t.sec) : '—'} · ${pct.toFixed(1)}%</span>
    </div>`;
  }).join('') : '<div class="past-empty">尚未选择事项</div>';
  legend.innerHTML = '时长按真实计时片段与所选区间求交计算；走势柱为堆叠显示，颜色与左侧份额一致。';

  // 走势区图例
  const oldLegend = $('#past-legend');
  if (oldLegend) oldLegend.remove();
  if (nodes.length) {
    const lg = document.createElement('div');
    lg.className = 'past-legend';
    lg.id = 'past-legend';
    lg.innerHTML = nodes.map(n => `<span><i style="background:${colorOf.get(n.key)}"></i>${n.module}</span>`).join('');
    $('#past-chart').parentNode.appendChild(lg);
  }
}

/** 按时段粒度分桶；每个桶再按事项拆分（用于堆叠） */
function pastBuckets(rangeName) {
  const [from, to] = pastRangeBounds();
  const fTs = from ? from.getTime() : null, tTs = to ? to.getTime() : null;
  const t = startOfDay(new Date());
  const list = effectiveRecords();
  const picked = new Set(past.picks);
  const buckets = [];
  const addBucket = (key, bStart, bEnd) => { const b = { key, bStart, bEnd, sec: 0, byKey: {} }; buckets.push(b); return b; };

  if (past.range === 'week') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(t); d.setDate(t.getDate() - i);
      addBucket(`${d.getMonth() + 1}/${d.getDate()}`, d.getTime(), d.getTime() + 86400000);
    }
  } else if (past.range === 'month') {
    for (let w = 4; w >= 0; w--) {
      const d = new Date(t); d.setDate(t.getDate() - (w * 7 + 6));
      const s = startOfDay(d);
      addBucket(`${s.getMonth() + 1}/${s.getDate()}`, s.getTime(), s.getTime() + 7 * 86400000);
    }
  } else {
    // 近一年 / 全部：按月
    let startDate;
    if (past.range === 'year') { startDate = new Date(t.getFullYear(), t.getMonth() - 11, 1); }
    else {
      const first = list.slice().sort((a, b) => (a.startAt || '').localeCompare(b.startAt || ''))[0];
      startDate = first ? new Date(new Date(first.startAt).getFullYear(), new Date(first.startAt).getMonth(), 1) : new Date(t.getFullYear(), t.getMonth(), 1);
    }
    let y = startDate.getFullYear(), m = startDate.getMonth();
    while (y < t.getFullYear() || (y === t.getFullYear() && m <= t.getMonth())) {
      const s = new Date(y, m, 1);
      addBucket(`${String(y).slice(2)}/${m + 1}`, s.getTime(), new Date(y, m + 1, 1).getTime());
      m++; if (m > 11) { m = 0; y++; }
    }
  }
  if (!buckets.length) addBucket('无', 0, 0);

  list.forEach(r => {
    const key = pastKeyOf(r.scene, r.module);
    if (!picked.has(key)) return;
    segmentsOf(r).forEach(sg => {
      buckets.forEach(b => {
        let st = sg.start, en = sg.end;
        if (fTs != null) st = Math.max(st, fTs);
        if (tTs != null) en = Math.min(en, tTs);
        st = Math.max(st, b.bStart); en = Math.min(en, b.bEnd);
        if (en > st) {
          const sec = (en - st) / 1000;
          b.sec += sec;
          b.byKey[key] = (b.byKey[key] || 0) + sec;
        }
      });
    });
  });
  return buckets;
}

/* ---------------- 导出 CSV ---------------- */
function exportCSV() {
  const list = effectiveRecords().sort((a, b) => (a.startAt || '').localeCompare(b.startAt || ''));
  if (!list.length) { toast('尚无记录可导出'); return; }
  const modeName = { stopwatch: '正计时', countdown: '倒计时', focus: '专注' };
  const head = '日期,开始时间,结束时间,场景,科目/事项,模式,轮次,计划时长(分),实际时长(分),状态';
  const rows = list.map(r => [
    r.date, hms(new Date(r.startAt).getTime()), r.endAt ? hms(new Date(r.endAt).getTime()) : '',
    r.scene === 'study' ? '修习' : '诸事', r.module, modeName[r.mode] || r.mode,
    r.round || '', r.plannedSec ? Math.round(r.plannedSec / 60) : '',
    (r.durationSec / 60).toFixed(1),
    r.completed ? '圆满' : '中辍'
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const blob = new Blob(['\ufeff' + head + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `光阴蛊-记录-${dateKey()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('CSV 已导出至下载目录');
}

/* ---------------- 时钟 ---------------- */
function clockTick() {
  const d = new Date();
  $('#now-time').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  $('#now-date').textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 周${['日', '一', '二', '三', '四', '五', '六'][d.getDay()]} · ${shichen(d.getHours())}`;
}

/* ---------------- 主进程兜底回调 ---------------- */
window.gu.onTimerEnded((payload) => {
  if (payload && payload.kind === 'phaseEnd') finishPhaseAuto();
});

// 胶囊 ✕ 退出 / 第二实例唤起
window.gu.onCapRequestExit((p) => {
  if (!pipMode) return;
  if (p && p.restored) resetPipUI();
  else exitPip();
});

// 主进程已退出浮窗（托盘还原 / 胶囊 ✕ 等）：只复位界面，不再重复请求
if (window.gu.onPipExited) {
  window.gu.onPipExited(() => {
    if (!pipMode) return;
    resetPipUI();
    if (savedPage !== 'timer') { switchPageOnly(savedPage); refreshAll(); }
  });
}

// 点击胶囊展开：同步 renderer 状态
window.gu.onCapExpanded(() => {
  capShown = false;
  updateCapButton();
});

// 任意交互后解锁音频（浏览器自动播放策略）
document.addEventListener('pointerdown', () => {
  const eng = window.soundEngine;
  if (eng.ctx && eng.ctx.state === 'suspended') eng.ctx.resume();
}, { passive: true });

init();
