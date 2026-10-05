/* 光阴蛊 · 卷宗搜索 / 改名归类 / 极往统计 回归测试
 * 直接执行 src/renderer.js 的真实函数，覆盖：
 *   1) 搜索：按事项名称过滤，且有搜索词时可跨天匹配
 *   2) 改名：可选新归属（修习 / 诸事），返回 {name, scene}
 *   3) 极往：勾选事项 → 分桶堆叠统计，时长与区间求交、只统计所选事项
 * 用法：node tests/past-search.test.js
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
function slice(from, to) {
  const a = src.indexOf(from);
  const b = to ? src.indexOf(to, a) : src.length;
  if (a < 0 || b < 0) throw new Error('切片失败: ' + from + ' → ' + to);
  return src.slice(a, b);
}

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};

/* ---------- 可交互的假 DOM（能看到 onclick 并手动触发） ---------- */
const styleWrites = {};
const els = new Map();
function stubEl(key) {
  const listeners = {};
  return {
    _key: key, _html: '', textContent: '', hidden: false, dataset: {}, disabled: false, title: '',
    value: '', checked: false,
    _onclick: null, _oninput: null, _onkeydown: null, _onchange: null,
    get onclick() { return this._onclick; }, set onclick(v) { this._onclick = v; },
    get oninput() { return this._oninput; }, set oninput(v) { this._oninput = v; },
    get onkeydown() { return this._onkeydown; }, set onkeydown(v) { this._onkeydown = v; },
    get onchange() { return this._onchange; }, set onchange(v) { this._onchange = v; },
    style: new Proxy({
      setProperty(prop, v) { (styleWrites[key] = styleWrites[key] || {})[prop] = v; },
      getPropertyValue(prop) { return (styleWrites[key] || {})[prop] || ''; }
    }, {
      set(_t, prop, v) { (styleWrites[key] = styleWrites[key] || {})[prop] = v; return true; },
      get(_t, prop) { if (Reflect.has(_t, prop)) return Reflect.get(_t, prop); return (styleWrites[key] || {})[prop] || ''; }
    }),
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    _get(sel) { return document.querySelector(key + ' ' + sel); },
    querySelector(sel) { return document.querySelector(key + ' ' + sel); },
    querySelectorAll(sel) {
      if (key === '#rename-scene' && sel === 'button') {
        return ['study', 'life'].map(s => {
          const el = document.querySelector('#rename-scene button[' + s + ']');
          el.dataset.scene = s;
          return el;
        });
      }
      return [];
    },
    get parentNode() { return document.querySelector('#page-past'); },
    remove() {}, appendChild() {}, focus() {}, select() {}, click() { if (this._onclick) this._onclick(); },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); }
  };
}
const document = {
  querySelector(sel) { if (!els.has(sel)) els.set(sel, stubEl(sel)); return els.get(sel); },
  querySelectorAll: () => [],
  createElement: () => stubEl('created'),
  addEventListener() {}
};
const requestAnimationFrame = cb => { cb(); return 1; };
const cancelAnimationFrame = () => {};

/* ---------- 装配真实代码 ---------- */
const body = [
  slice('/* ================= 光阴蛊', '/* ---------------- 计时核心'),   // 常量 + 状态 + 工具 + init
  slice('function startOfDay(', 'function shiftCursor('),
  slice('function readPlannedMs(', '/* ---------------- 记录持久化'),
  slice('/* ---------------- 记录持久化', '/* ---------------- 统计'),
  slice('/* ---------------- 统计', 'function startOfDay('),
  slice('function buildBuckets(', '/* ---------------- 卷宗 ---------------- */'),
  slice('/* ---------------- 卷宗 ---------------- */'),
  'const __api = { renderScroll, renameRecordModal, renderPast, bindPastEvents, pastCatalog, pastBuckets,' +
  ' effectiveRecords, dateKey, startOfDay, recordSecInRange, get past() { return past; },' +
  ' setSearch(v) { scrollSearch = v; }, getSearch() { return scrollSearch; },' +
  ' setFilter(v) { scrollFilter = v; }, timer, init,' +
  ' setRecords(r) { records = r; }, get records() { return records; } };' +
  ' window.__api = __api;'
].join('\n');

const D = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm);
const today = new Date();
const Y = today.getFullYear(), M = today.getMonth() + 1, DD = today.getDate();
const keyOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const rec = (id, scene, module, day, h0, m0, mins, extra = {}) => {
  const st = D(day.getFullYear(), day.getMonth() + 1, day.getDate(), h0, m0);
  const en = new Date(st.getTime() + mins * 60000);
  return {
    id, date: keyOf(day), startAt: st.toISOString(), endAt: en.toISOString(),
    durationSec: mins * 60, plannedSec: null, mode: 'stopwatch', scene, module,
    status: 'finished', completed: true,
    segments: [{ start: st.toISOString(), end: en.toISOString() }], ...extra
  };
};
const d0 = new Date(Y, M - 1, DD);
const d1 = new Date(Y, M - 1, DD - 1);
const d2 = new Date(Y, M - 1, DD - 2);
const recs = [
  rec('a', 'study', '资料分析', d0, 9, 0, 60),
  rec('b', 'study', '申论', d0, 11, 0, 30),
  rec('c', 'study', '申论', d1, 14, 0, 45),
  rec('d', 'life', '休息', d1, 16, 0, 20),
  rec('e', 'study', '资料分析', d2, 8, 0, 15)
];

let api;
const window = {
  gu: {
    onTimerEnded() {}, onCapRequestExit() {}, onCapExpanded() {},
    async getRecords() { return recs; }, async upsertRecord() {}, async deleteRecord() {}, async clearRecords() {},
    scheduleDeadline() {}, cancelDeadline() {}, notify() {}, enterPip() {}, exitPip() {}, hideSelf() {},
    capShow() {}, capHide() {}, capClose() {}, capState() {}, setPinned: () => Promise.resolve(true)
  },
  soundEngine: { bell() {}, toggle() {}, setVolume() {}, masterVol: 0.6, ctx: null }
};
const localStorage = { getItem: () => null, setItem() {} };
const setInterval = () => 0;

api = new Function('window', 'document', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'console', 'setInterval',
  body + '\nreturn window.__api;')(window, document, localStorage, requestAnimationFrame, cancelAnimationFrame, console, setInterval);
api.setRecords(recs);

(async () => {
  await new Promise(r => setTimeout(r, 10));

  /* ---------- 1. 卷宗搜索 ---------- */
  console.log('\n[1] 卷宗搜索（按事项名称）');
  const rowCount = () => (document.querySelector('#record-list').innerHTML.match(/class="record-row"/g) || []).length;
  const html = () => document.querySelector('#record-list').innerHTML;

  api.setSearch(''); api.setFilter('all'); api.renderScroll();
  const allRows = rowCount();
  check('未搜索时列出全部记录', allRows === 5, 'got=' + allRows);

  const text = () => html().replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  api.setSearch('申论'); api.renderScroll();
  check('搜索「申论」只剩 2 行', rowCount() === 2, 'got=' + rowCount());
  check('搜索结果文本只含申论', /申论/.test(text()) && !/资料分析/.test(text()), text().slice(0, 120));
  check('搜索可跨天命中（昨天那条也在）',
    html().includes(keyOf(d1).slice(5)) && html().includes(keyOf(d0).slice(5)));

  api.setSearch('资料'); api.renderScroll();
  check('搜索「资料」命中 2 行（前缀匹配）', rowCount() === 2, 'got=' + rowCount());

  api.setSearch('不存在的科目'); api.renderScroll();
  check('无匹配时不渲染任何行', rowCount() === 0, 'got=' + rowCount());
  check('无匹配时显示"换个词试试"提示', document.querySelector('#record-no-match').hidden === false);
  check('无匹配时不显示"卷宗空空"（那是真的没数据）', document.querySelector('#record-empty').hidden === true);

  api.setSearch('申论'); api.setFilter('life'); api.renderScroll();
  check('搜索与场景筛选叠加后为空', rowCount() === 0, 'got=' + rowCount());

  api.setSearch(''); api.setFilter('all'); api.renderScroll();
  check('清空搜索后恢复全部', rowCount() === 5, 'got=' + rowCount());
  check('结果计数已写入', /\d/.test(document.querySelector('#record-count').textContent),
    document.querySelector('#record-count').textContent);

  /* ---------- 2. 改名 + 归类 ---------- */
  console.log('\n[2] 改名与归属');
  let res = null;
  const p1 = api.renameRecordModal(recs[1]).then(v => { res = v; });
  await new Promise(r => setTimeout(r, 5));
  check('弹窗打开时预填原名称', document.querySelector('#rename-input').value === '申论',
    document.querySelector('#rename-input').value);
  check('弹窗打开时预选原归属', document.querySelector('#rename-scene button[study]').classList.contains('active'));
  document.querySelector('#rename-input').value = '申论精读';
  document.querySelector('#rename-scene button[life]').onclick();
  check('切换归属后高亮跟随', document.querySelector('#rename-scene button[life]').classList.contains('active'));
  document.querySelector('#rename-ok').onclick();
  await p1;
  check('返回新名称与新归属', res && res.name === '申论精读' && res.scene === 'life', JSON.stringify(res));
  check('确定后弹窗关闭', document.querySelector('#rename-mask').hidden === true);

  const p2 = api.renameRecordModal(recs[0]).then(v => { res = v; });
  await new Promise(r => setTimeout(r, 5));
  document.querySelector('#rename-input').value = '   ';
  document.querySelector('#rename-ok').onclick();
  check('空名称不放行（弹窗仍开着）', document.querySelector('#rename-mask').hidden === false);
  document.querySelector('#rename-input').value = '这个名称实在是太长了超过十个字';
  document.querySelector('#rename-ok').onclick();
  check('超长名称不放行', document.querySelector('#rename-mask').hidden === false);
  document.querySelector('#rename-cancel').onclick();
  await p2;
  check('取消返回 null', res === null, JSON.stringify(res));

  /* ---------- 3. 极往统计 ---------- */
  console.log('\n[3] 极往：多选事项统计');
  api.past.picks = [];
  api.past.range = 'total';
  api.renderPast();
  const catalog = api.pastCatalog();
  check('事项清单按场景归集', catalog.length === 3 && catalog.some(c => c.module === '休息'),
    catalog.map(c => c.scene + ':' + c.module).join(','));
  check('未选择时自动预选 4 项以内', api.past.picks.length > 0 && api.past.picks.length <= 4,
    JSON.stringify(api.past.picks));

  const keyStudy = 'study\u0000资料分析';
  const keyShen = 'study\u0000申论';
  const keyLife = 'life\u0000休息';
  api.past.picks = [keyStudy, keyShen];
  api.renderPast();
  const cards = document.querySelector('#past-cards').innerHTML;
  check('概览卡显示已选 2 项', /2 项/.test(cards), cards.slice(0, 120));
  check('合计 = 资料分析(75分) + 申论(75分) = 2.5 小时', /2\.5 小时/.test(cards), cards);
  check('修习占比 100%', /100%/.test(cards), cards);

  const bk = api.pastBuckets('全部');
  const picked = new Set(api.past.picks);
  const sumByKey = {};
  bk.forEach(b => Object.entries(b.byKey).forEach(([k, v]) => { sumByKey[k] = (sumByKey[k] || 0) + v; }));
  check('分桶只统计所选事项（休息不计）', sumByKey[keyLife] === undefined,
    JSON.stringify(Object.keys(sumByKey)));
  check('资料分析累计 4500 秒', Math.abs((sumByKey[keyStudy] || 0) - 4500) < 2, String(sumByKey[keyStudy]));
  check('申论累计 4500 秒', Math.abs((sumByKey[keyShen] || 0) - 4500) < 2, String(sumByKey[keyShen]));
  check('桶内秒数之和 = 记录时长之和', (() => {
    const total = bk.reduce((s, b) => s + b.sec, 0);
    return Math.abs(total - 9000) < 4;
  })(), String(bk.reduce((s, b) => s + b.sec, 0)));

  // 只选一个事项时，份额为 100%
  api.past.picks = [keyLife];
  api.renderPast();
  const share = document.querySelector('#past-share').innerHTML;
  check('只选诸事「休息」时份额 100%', /100\.0%/.test(share), share.slice(0, 160));
  check('只选诸事时走势图仍渲染', document.querySelector('#past-chart').innerHTML.length > 0);

  // 全部取消（ensurePastPicks 会自动回填默认项，属于设计的兜底行为）
  api.past.picks = [];
  api.renderPast();
  check('清空选择后不报错，并自动回填默认项',
    api.past.picks.length > 0 && document.querySelector('#past-share').innerHTML.length > 0,
    'picks=' + JSON.stringify(api.past.picks));

  // 真·空态：卷宗里没有任何记录时
  api.setRecords([]);
  api.past.picks = [];
  api.renderPast();
  check('无任何记录时份额区显示提示', /尚未选择事项/.test(document.querySelector('#past-share').innerHTML),
    document.querySelector('#past-share').innerHTML.slice(0, 120));
  api.setRecords(recs);

  // 区间切换：近七日应只含最近 7 天
  api.past.picks = [keyStudy];
  api.past.range = 'week';
  const wk = api.pastBuckets('近七日');
  check('近七日分桶 = 7 个', wk.length === 7, 'got=' + wk.length);

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.log('\n测试自身异常: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
