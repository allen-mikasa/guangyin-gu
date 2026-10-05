/* 光阴蛊 · 长河统计与计时可靠性 harness
 * 在 Node 中直接执行 src/renderer.js 的真实函数体（伪造 DOM），覆盖：
 *   1) 日/周/月/年/总计 五个视图均不得抛错（周/月/年 走 todayKey 分支，旧代码在此崩溃）
 *   2) 跨零点记录的按天分摊
 *   3) 卷宗按片段拆分到两天
 *   4) 日均分母（历史整段 / 未来区间）
 *   5) finishPhaseAuto 重入保护（原先被 tick 与主进程 deadline 双触发 → 重复落库）
 * 用法：node tests/river-stats.test.js
 */
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  function slice(from, to) {
    const a = src.indexOf(from);
    const b = to ? src.indexOf(to, a) : src.length;
    if (a < 0 || b < 0) throw new Error('切片失败: ' + from + ' → ' + to);
    return src.slice(a, b);
  }
  // LEGACY_BUG=1 时把原始 Bug 的类别注回去（renderRiver 里引用未声明的标识符 → ReferenceError），
  // 用来反向验证本 harness 确实能抓到那个错误，而不是“永远绿”。
  const legacyBug = process.env.LEGACY_BUG === '1';
  let body = [
    slice('/* ================= 光阴蛊', '/* ---------------- 工具'),        // 常量 + 状态
    slice('/* ---------------- 工具', '/* ---------------- 计时核心'),        // 工具 + init/bindEvents + 浮窗/胶囊/模式选择
    slice('function startOfDay(', 'function shiftCursor('),
    slice('function readPlannedMs(', '/* ---------------- 记录持久化'),                 // 计时核心：含 finishPhaseAuto
    slice('/* ---------------- 记录持久化', '/* ---------------- 统计'),            // 含 closeRecord / resetTimerUI
    slice('/* ---------------- 统计', 'function startOfDay('),                       // 统计入口 + 今日视图
    slice('function buildBuckets(', '/* ---------------- 卷宗 ---------------- */'),
    slice('/* ---------------- 卷宗 ---------------- */'),               // 含 renderScroll + 文件尾部事件绑定
    'const __api = { renderRiver, buildBuckets, daysElapsedInRange, recordSecInRange, rangeBounds,' +
    ' init, dateKey, startOfDay, segmentsOf, aggregateByDay, splitSegsByDay, flattenRecordPieces,' +
    ' renderScroll, finishPhaseAuto, resetTimerUI, closeRecord, refreshAll, cursorLabel, timer,' +
    ' get river() { return river; }, setRecords(r) { records = r; }, get records() { return records; } };' +
    ' window.__api = __api;'
  ].join('\n');
  if (legacyBug) {
    const target = 'b.drill === todayKey()';
    if (!body.includes(target)) throw new Error('反向验证失败：body 中找不到 ' + target);
    body = body.replace(target, 'b.drill === __undeclared_bug__');
  }

  /* ---------- 测试数据（必须先于 window 定义，供 init 的 getRecords 使用） ---------- */
  const D = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm);
  const today = new Date();
  const Y = today.getFullYear(), M = today.getMonth() + 1, DD = today.getDate();
  const dayKeyOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const recs = [
    { // 今日普通完整记录
      id: 'r1', date: dayKeyOf(today), startAt: D(Y, M, DD, 9, 0).toISOString(), endAt: D(Y, M, DD, 10, 30).toISOString(),
      durationSec: 5400, plannedSec: 5400, mode: 'stopwatch', scene: 'study', module: '资料分析',
      status: 'finished', completed: true,
      segments: [{ start: D(Y, M, DD, 9, 0).toISOString(), end: D(Y, M, DD, 10, 30).toISOString() }]
    },
    { // 跨夜：02-06 23:50 → 02-07 00:20
      id: 'r2', date: '2026-02-06', startAt: D(2026, 2, 6, 23, 50).toISOString(), endAt: D(2026, 2, 7, 0, 20).toISOString(),
      durationSec: 1800, plannedSec: null, mode: 'stopwatch', scene: 'study', module: '申论',
      status: 'finished', completed: true,
      segments: [{ start: D(2026, 2, 6, 23, 50).toISOString(), end: D(2026, 2, 7, 0, 20).toISOString() }]
    },
    { // 同日两段（暂停续计）
      id: 'r3', date: '2026-02-07', startAt: D(2026, 2, 7, 14, 0).toISOString(), endAt: D(2026, 2, 7, 15, 20).toISOString(),
      durationSec: 3600, plannedSec: null, mode: 'stopwatch', scene: 'life', module: '杂务',
      status: 'finished', completed: true,
      segments: [
        { start: D(2026, 2, 7, 14, 0).toISOString(), end: D(2026, 2, 7, 14, 20).toISOString() },
        { start: D(2026, 2, 7, 14, 40).toISOString(), end: D(2026, 2, 7, 15, 20).toISOString() }
      ]
    },
    { // 旧版遗留：无 segments、无 plannedSec
      id: 'r4', date: '2026-02-05', startAt: D(2026, 2, 5, 8, 0).toISOString(), endAt: D(2026, 2, 5, 8, 45).toISOString(),
      durationSec: 2700, status: 'finished', completed: true, mode: 'countdown', scene: 'study', module: '常识判断'
    },
    { // 暂停中，不应计入有效统计
      id: 'r5', date: '2026-02-07', startAt: D(2026, 2, 7, 16, 0).toISOString(), endAt: null, durationSec: 600,
      status: 'paused', completed: false, mode: 'stopwatch', scene: 'study', module: '数量关系',
      segments: [{ start: D(2026, 2, 7, 16, 0).toISOString(), end: null }], updatedAt: D(2026, 2, 7, 16, 10).getTime()
    },
    { // 坏数据：非法日期，旧代码可能死循环
      id: 'r6', date: '2026-02-04', startAt: 'invalid-date', endAt: null, durationSec: 100,
      status: 'finished', completed: false, mode: 'stopwatch', scene: 'study', module: '坏数据',
      segments: [{ start: 'invalid-date', end: null }]
    }
  ];
  let testRecords = recs;

  /* ---------- 伪造 DOM ---------- */
  const styleWrites = {};
  const els = new Map();                     // 同一个选择器返回同一个元素（真实 DOM 的行为）
  function stubEl(key, parent) {
    return {
      _key: key, _removed: false, _html: '', textContent: '', hidden: false, dataset: {}, disabled: false,
      title: '',
      style: new Proxy({
        setProperty(prop, v) { (styleWrites[key] = styleWrites[key] || {})[prop] = v; },
        getPropertyValue(prop) { return (styleWrites[key] || {})[prop] || ''; }
      }, {
        set(_t, prop, v) { (styleWrites[key] = styleWrites[key] || {})[prop] = v; return true; },
        get(_t, prop) {
          if (Reflect.has(_t, prop)) return Reflect.get(_t, prop);
          return (styleWrites[key] || {})[prop] || '';
        }
      }),
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      get parentNode() { return els.get('#page-past') || els.get('#past-chart') || null; },
      querySelector: sel => els.get(key + ' ' + sel) || stubEl(key + ' ' + sel),
      querySelectorAll: () => [],
      closest: () => null,
      remove() { this._removed = true; },
      appendChild() {}, focus() {}, select() {}, click() {},
      get innerHTML() { return this._html; },
      set innerHTML(v) { this._html = String(v); }
    };
  }
  const document = {
    querySelector(sel) { if (!els.has(sel)) els.set(sel, stubEl(sel, els.get('#page-past') || null)); return els.get(sel); },
    querySelectorAll: () => [],
    createElement: () => stubEl('created'),
    addEventListener() {}
  };
  document.body = { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } };
  const window = {
    gu: {
      onTimerEnded() {}, onCapRequestExit() {}, onCapExpanded() {},
      async getRecords() { return testRecords; },
      async upsertRecord() { return { ok: true }; }, async deleteRecord() {}, async clearRecords() {},
      scheduleDeadline() {}, cancelDeadline() {}, notify() {},
      enterPip() {}, exitPip() {}, hideSelf() {}, capShow() {}, capHide() {}, capClose() {}, capState() {}
    },
    soundEngine: { bell() {}, toggle() {}, setVolume() {}, masterVol: 0.6, ctx: null }
  };
  const localStorage = { getItem: () => null, setItem() {} };
  // 光圈流转用 rAF 自递归；这里同步执行但设上限，避免测试里栈溢出
  let rafCount = 0;
  const requestAnimationFrame = cb => { if (rafCount++ < 200) cb(); return rafCount; };
  const cancelAnimationFrame = () => {};
  const setInterval = () => 0, setTimeout2 = setTimeout;

  /* ---------- 执行真实函数体 ---------- */
  let api;
  try {
    api = new Function('window', 'document', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'console', 'setInterval',
      body + '\nreturn window.__api;')(window, document, localStorage, requestAnimationFrame, cancelAnimationFrame, console, setInterval);
  } catch (e) {
    console.log('❌ 载入失败: ' + e.constructor.name + ': ' + e.message);
    process.exit(1);
  }
  window.__api = api;
  window.__apiReady = (async () => {
    try { await api.init(); } catch (e) { window.__initError = e; }
  })();

  let pass = 0, fail = 0;
  function check(name, cond, extra) {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
  }
  const near = (a, b, tol = 0.51) => Math.abs(a - b) <= tol;

  /* ---------- 0. 完整 init 流程（含 refreshAll，任何视图崩都会在这里暴露） ---------- */
  console.log('\n[0] init 全流程');
  try {
    await window.__apiReady;
  } catch (e) { /* 已在 __apiReady 内捕获 */ }
  check('init 全流程无异常', !window.__initError,
    window.__initError ? window.__initError.constructor.name + ': ' + window.__initError.message : '');

  api.setRecords(recs);
  api.timer.module = '资料分析';
  api.timer.status = 'idle';

  /* ---------- 1. 五个视图 ---------- */
  console.log('\n[1] 各时间范围渲染（旧代码在 周/月/年/总计 处抛 ReferenceError: todayKey）');
  for (const range of ['day', 'week', 'month', 'year', 'total']) {
    api.river.range = range;
    api.river.cursor = D(2026, 2, 7, 12);
    let err = null;
    try { api.renderRiver(); } catch (e) { err = e; }
    check(`${range} 视图渲染无异常`, !err, err ? err.constructor.name + ': ' + err.message : '');
    if (err) continue;
    check(`${range} 标题已写入`, /光阴长河/.test(document.querySelector('#river-title').innerHTML));
    check(`${range} 模块分布已渲染`, document.querySelector('#module-rank').innerHTML.length > 0);
    check(`${range} 星图已渲染`, document.querySelector('#heatmap').innerHTML.length > 0);
  }
  console.log('   · 星图行数模板 = ' + JSON.stringify(styleWrites['#heatmap'] && styleWrites['#heatmap'].gridTemplateRows));

  /* ---------- 2. 跨夜分摊 ---------- */
  console.log('\n[2] 跨零点按天分摊（长河口径）');
  const cross = recs.find(r => r.id === 'r2');
  check('02-06 摊到 600 秒', near(api.recordSecInRange(cross, D(2026, 2, 6).getTime(), D(2026, 2, 7).getTime()), 600));
  check('02-07 摊到 1200 秒', near(api.recordSecInRange(cross, D(2026, 2, 7).getTime(), D(2026, 2, 8).getTime()), 1200));
  const bb = api.buildBuckets('day', D(2026, 2, 7), D(2026, 2, 8), [cross]);
  check('日视图 0 点桶 = 1200 秒', near(bb.buckets[0].sec, 1200), 'got=' + bb.buckets[0].sec);

  /* ---------- 3. 卷宗拆分 ---------- */
  console.log('\n[3] 卷宗跨夜拆分到两天');
  const pieces = api.flattenRecordPieces([cross])[0];
  check('跨夜记录产生 2 个片段', pieces.segs.length === 2, 'got=' + pieces.segs.length);
  check('crossDay 标记为真', pieces.crossDay === true);
  check('片段1 = 02-06 / 600 秒', pieces.segs[0].key === '2026-02-06' && near(pieces.segs[0].sec, 600), JSON.stringify(pieces.segs[0]));
  check('片段2 = 02-07 / 1200 秒', pieces.segs[1].key === '2026-02-07' && near(pieces.segs[1].sec, 1200), JSON.stringify(pieces.segs[1]));
  const multi = api.flattenRecordPieces([recs.find(r => r.id === 'r3')])[0];
  check('同日两段不算跨天', multi.multi === true && multi.crossDay === false);
  check('两段合计 3600 秒', near(multi.segs.reduce((s, x) => s + x.sec, 0), 3600));
  check('坏数据被安全丢弃', api.flattenRecordPieces([recs.find(r => r.id === 'r6')]).length === 0);
  let scrollErr = null;
  try { api.renderScroll(); } catch (e) { scrollErr = e; }
  check('卷宗渲染无异常', !scrollErr, scrollErr ? scrollErr.constructor.name + ': ' + scrollErr.message : '');
  const rows = (document.querySelector('#record-list').innerHTML.match(/class="record-row"/g) || []).length;
  check('卷宗至少渲染出 2 行', rows >= 2, '总行数=' + rows);

  // 片段序号必须取"该记录内的真实序号"。
  // 曾经误用"当日分组内的位置"，同一天记录一多就会标出 20/2 这种越界序号。
  console.log('\n[3.1] 片段序号标注');
  const tagHtml = document.querySelector('#record-list').innerHTML;
  const tags = [...tagHtml.matchAll(/<i class="seg-tag"[^>]*>(\d+)\/(\d+)<\/i>/g)].map(m => ({ i: Number(m[1]), n: Number(m[2]) }));
  check('出现了片段标注', tags.length > 0, 'count=' + tags.length);
  check('序号一律不超过总数（没有 20/2 这类越界）', tags.every(t => t.i >= 1 && t.i <= t.n),
    JSON.stringify(tags));
  check('两段记录的标注只可能是 1/2 或 2/2',
    tags.every(t => t.n !== 2 || t.i === 1 || t.i === 2), JSON.stringify(tags));
  const r3pieces = api.flattenRecordPieces([recs.find(r => r.id === 'r3')])[0];
  check('同日两段的 segIndex 为 1、2', r3pieces.segs.map(s => s.segIndex).join(',') === '1,2',
    r3pieces.segs.map(s => s.segIndex).join(','));
  const crossPieces = api.flattenRecordPieces([recs.find(r => r.id === 'r2')])[0];
  check('跨夜一段被拆成两天时，两天都是第 1 段',
    crossPieces.segs.every(s => s.segIndex === 1), crossPieces.segs.map(s => s.segIndex).join(','));

  /* ---------- 4. 日均分母 ---------- */
  console.log('\n[4] 日均分母');
  const wk = api.rangeBounds('week', D(2020, 5, 6));
  check('历史整周 = 7 天', api.daysElapsedInRange(wk[0], wk[1]) === 7, 'got=' + api.daysElapsedInRange(wk[0], wk[1]));
  const fut = api.rangeBounds('week', D(2999, 1, 4));
  check('未来区间 = 0 天', api.daysElapsedInRange(fut[0], fut[1]) === 0, 'got=' + api.daysElapsedInRange(fut[0], fut[1]));

  /* ---------- 5. 自动结算重入 ---------- */
  console.log('\n[5] finishPhaseAuto 重入保护');
  let saves = 0;
  window.gu = {
    cancelDeadline() {}, notify() {},
    async upsertRecord() { saves++; },
    async getRecords() { return api.records; }
  };
  const rec0 = {
    id: 'rc1', date: api.dateKey(today), startAt: D(Y, M, DD, 9, 0).toISOString(), endAt: null, durationSec: 0,
    plannedSec: 60, mode: 'countdown', scene: 'study', module: '资料分析', status: 'running', completed: false,
    segments: [{ start: D(Y, M, DD, 9, 0).toISOString(), end: null }], updatedAt: Date.now()
  };
  api.setRecords([rec0]);
  api.timer.mode = 'countdown';
  api.timer.status = 'running';
  api.timer.plannedMs = 60000;
  api.timer.accumulatedMs = 0;
  api.timer.startedAt = Date.now() - 61000;
  api.timer.recordId = 'rc1';
  api.timer.module = '资料分析';
  api.timer.scene = 'study';
  await Promise.all([api.finishPhaseAuto(), api.finishPhaseAuto()]);
  await new Promise(r => setTimeout(r, 80));
  check('并发两次只落库一次', saves === 1, 'got=' + saves + ' 次');
  check('结算后状态回到 idle', api.timer.status === 'idle', 'got=' + api.timer.status);

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})();
