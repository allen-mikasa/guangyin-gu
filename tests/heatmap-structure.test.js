/* 光阴蛊 · 长河星图结构回归测试
 * 教训：上一版只用假 DOM 验证「没抛错」，结果把「格子被自动布局排到可视区外」这种
 * 结构/样式回归放过去了。这里直接切 renderHeatWeeks / renderHeatMonths 生成的 HTML，
 * 逐列校验「7 行、日期连续、未来格为空」，并反向确认旧的自动流动写法确实会错。
 * 用法：node tests/heatmap-structure.test.js
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

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

const code = [
  "const HEAT_COLORS = ['#16202e', '#274452', '#3d6b68', '#7a9a72', '#c9a15e'];",
  slice('const pad =', 'function loadSettings('),
  slice('function startOfDay(', 'function shiftCursor('),
  slice('function heatColumnHtml(', 'function onHeatClick('),
  'window.__h = { renderHeatWeeks, renderHeatMonths, dateKey, startOfDay, heatCellHtml, heatColumnHtml };'
].join('\n');
const window = {};
new Function('window', 'console', code)(window, console);
const H = window.__h;

/* ---------- 解析生成的 HTML ---------- */
function parseCols(html) {
  const cols = [];
  const colRe = /<div class="heat-col">([\s\S]*?)<\/div>\s*(?=<div class="heat-col">|$)/g;
  // heat-col 内部是 7 个自身闭合的 div，用更直接的切分方式更稳
  const parts = html.split('<div class="heat-col">').slice(1);
  parts.forEach(raw => {
    const body = raw.slice(0, raw.lastIndexOf('</div>'));
    const cells = [...body.matchAll(/<div class="heat-cell([^"]*)"(?: data-day="([^"]+)")?/g)].map(m => ({
      cls: m[1].trim(),
      day: m[2] || null
    }));
    cols.push({ cells, label: (body.match(/class="heat-month">([^<]*)</) || [])[1] || null });
  });
  return cols;
}

const D = (y, m, d, hh = 0) => new Date(y, m - 1, d, hh);
const today = D(2026, 10, 1, 12);          // 固定“今天”＝2026-10-01（周四）
const byDay = { '2026-09-30': 7200, '2026-10-01': 1800 };

/* ---------- 1. 周视图结构 ---------- */
console.log('\n[1] 周视图（近 20 周）');
const dow = (today.getDay() + 6) % 7;
const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow - 19 * 7);
const wkHtml = H.renderHeatWeeks(weekStart, 20, byDay, today);
const wkCols = parseCols(wkHtml);
check('生成 20 列（一周一列）', wkCols.length === 20, 'got=' + wkCols.length);
check('每列恰好 7 格（周一→周日）', wkCols.every(c => c.cells.length === 7),
  '各列格数=' + wkCols.map(c => c.cells.length).join(','));
check('周视图不出现月份文字', wkCols.every(c => c.label === null));
check('列内日期连续递增 1 天', (() => {
  for (const c of wkCols) {
    for (let i = 1; i < c.cells.length; i++) {
      if (!c.cells[i].day || !c.cells[i - 1].day) continue;
      const a = +new Date(c.cells[i - 1].day + 'T00:00:00');
      const b = +new Date(c.cells[i].day + 'T00:00:00');
      if (b - a !== 86400000) return false;
    }
  }
  return true;
})());
check('今天所在格可点击且日期正确', (() => {
  const all = wkCols.flatMap(c => c.cells).filter(c => c.day);
  return all.some(c => c.day === '2026-10-01' && c.cls.includes('clickable'));
})(), '今天未找到');
check('未来日期为空占位（不可点击）', (() => {
  const all = wkCols.flatMap(c => c.cells).filter(c => c.cls.includes('empty'));
  return all.length > 0 && all.every(c => c.day === null);
})(), '未来格数=' + wkCols.flatMap(c => c.cells).filter(c => c.cls.includes('empty')).length);
check('有数据的日期落在正确格位（2026-09-30 在 09-30 那行）', (() => {
  for (const c of wkCols) {
    const i = c.cells.findIndex(x => x.day === '2026-09-30');
    if (i < 0) continue;
    return i === 2;                       // 周三 = 第 3 行
  }
  return false;
})());

/* ---------- 2. 月视图结构 ---------- */
console.log('\n[2] 月视图（近 12 个月）');
const monthStart = new Date(today.getFullYear(), today.getMonth() - 11, 1);
const moHtml = H.renderHeatMonths(monthStart, 12, byDay, today);
const moCols = parseCols(moHtml);
check('列数 = 覆盖 12 个月所需的周数', moCols.length >= 48 && moCols.length <= 60, 'got=' + moCols.length);
check('每列恰好 7 格', moCols.every(c => c.cells.length === 7),
  '各列格数=' + moCols.map(c => c.cells.length).join(','));
check('每个月只在一列上标月份文字（共 12 个月）', (() => {
  const labels = moCols.filter(c => c.label).map(c => c.label);
  const months = new Set(labels.map(l => l.replace('年', '-1')));
  return labels.length >= 12 && labels.length <= 13 && months.size === 12;
})(), '标签=' + moCols.filter(c => c.label).map(c => c.label).join(','));
check('列内日期严格连续（无跳日/跨列错位）', (() => {
  const all = moCols.flatMap(c => c.cells).filter(c => c.day).map(c => c.day);
  for (let i = 1; i < all.length; i++) {
    if (+new Date(all[i] + 'T00:00:00') - +new Date(all[i - 1] + 'T00:00:00') !== 86400000) return false;
  }
  return true;
})());
check('今天在最后一列且可点击', (() => {
  const last = moCols[moCols.length - 1];
  return last.cells.some(c => c.day === '2026-10-01' && c.cls.includes('clickable'));
})());
check('每月 1 号带 month-start 标记', (() => {
  const marks = moCols.flatMap(c => c.cells).filter(c => c.cls.includes('month-start') && c.day);
  return marks.length === 12 && marks.every(c => c.day.endsWith('-01'));
})(), '标记数=' + moCols.flatMap(c => c.cells).filter(c => c.cls.includes('month-start')).length);

/* ---------- 3. 反向验证：旧的自动流动写法确实会错 ---------- */
console.log('\n[3] 反向验证：grid-auto-flow 方案');
const allCells = wkCols.flatMap(c => c.cells).length;
check('新方案：列内固定 7 格，不依赖自动流动', wkCols.every(c => c.cells.length === 7));
check('旧方案会把 20 周摊成 ' + (20 * 7) + ' 个隐式列（进而溢出可视区）',
  !css.includes('grid-auto-flow: column'), 'styles.css 里仍残留 grid-auto-flow');

/* ---------- 4. 样式约束 ---------- */
console.log('\n[4] 样式约束');
check('.heat-cell 有显式宽高（不依赖行高推断）', /\.heat-cell\s*\{[^}]*width:\s*15px[^}]*height:\s*15px/s.test(css));
check('.heat-col 固定 7 行', /\.heat-col\s*\{[^}]*grid-template-rows:\s*repeat\(7,\s*15px\)/s.test(css));
check('月视图格宽有单独定义', /\.heatmap\.wide \.heat-cell\s*\{\s*width:\s*13px/s.test(css));
check('容器横向滚动而非换行', /\.heatmap\s*\{[^}]*display:\s*flex/s.test(css) && /\.heat-scroll\s*\{[^}]*overflow-x:\s*auto/s.test(css));
check('renderRiver 不再写 gridTemplateRows', !src.includes('style.gridTemplateRows'));

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
