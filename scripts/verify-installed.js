// 校验已安装 app.asar 内是否含本次修复（星图列式布局 / 设置 / 光圈流转 / 胶囊诊断）
const fs = require('fs');
const asar = process.argv[2] || 'D:/光阴蛊/guangyin-gu/resources/app.asar';
const b = fs.readFileSync(asar);
const headerSize = b.readUInt32LE(12);
const json = JSON.parse(b.slice(16, 16 + headerSize).toString('utf8'));
const base = 16 + headerSize;

function readFile(entry) {
  const off = base + Number(entry.offset);
  return b.slice(off, off + Number(entry.size)).toString('utf8');
}
function entryOf(p) {
  const parts = p.split('/');
  let node = json.files;
  for (const part of parts) {
    if (!node || !node[part] && !(node.files && node.files[part])) {
      if (node && node.files && node.files[part]) { node = node.files[part]; continue; }
      if (node && node[part]) { node = node[part]; continue; }
      return null;
    }
    node = node[part];
  }
  return node;
}

const renderer = readFile(json.files.src.files['renderer.js']);
const styles = readFile(json.files.src.files['styles.css']);
const indexHtml = readFile(json.files.src.files['index.html']);
const capsuleHtml = readFile(json.files.src.files['capsule.html']);
const capsuleRenderer = readFile(json.files.src.files['capsule-renderer.js']);
const pip = readFile(json.files['pip.js']);
const main = readFile(json.files['main.js']);

const checks = [
  ['星图改为列式布局（heat-col）', renderer.includes('function heatColumnHtml')],
  ['星图不再写 gridTemplateRows', !renderer.includes('style.gridTemplateRows')],
  ['月份视图按周推进', renderer.includes('for (let w = 0; w < 60; w++)')],
  ['设置默认值', renderer.includes('SETTING_DEFAULTS')],
  ['光圈五档调色板', renderer.includes('RING_FLOW_COLORS')],
  ['光圈按进度分档取色', renderer.includes('function ringFlowColor')],
  ['档内平滑过渡（非硬切）', renderer.includes('BLEND_START')],
  ['进度口径与表盘一致', renderer.includes('function ringProgress')],
  ['旧的整圈彩段方案已移除', !renderer.includes('buildRingSegments') && !renderer.includes('arcPath')],
  ['胶囊诊断日志', renderer.includes('capDiag')],
  ['设置面板 HTML', indexHtml.includes('id="settings-mask"')],
  ['整圈彩段容器已移除', !indexHtml.includes('ring-arcs')],
  ['.heat-col 样式', styles.includes('.heat-col {')],
  ['光圈描边有颜色过渡', /\.ring-fg\s*\{[^}]*transition:[^;]*stroke/s.test(styles)],
  ['旧的旋转关键帧已移除', !/@keyframes\s+ring-spin/.test(styles)],
  ['面板 min-width 修正', styles.includes('.river-bottom > .panel { min-width: 0')],
  ['设置面板样式', styles.includes('.set-switch')],
  ['主进程胶囊日志', pip.includes('guangyin-pip.log')],
  ['setVisibleOnAllWorkspaces 类型守卫', pip.includes("typeof r.catch === 'function'")],
  ['主进程恢复置顶开关', main.includes('st.pinned')],
  ['托盘已打包', main.includes('function createTray')],
  // v1.7 新增
  ['胶囊改用系统拖动（app-region）', /-webkit-app-region:\s*drag/.test(capsuleHtml)],
  ['胶囊交互元素声明 no-drag', /-webkit-app-region:\s*no-drag/.test(capsuleHtml)],
  // 只在"代码"层面判定：注释里提到关键字不算
  ['胶囊已移除自实现拖拽计算',
    !/addEventListener\('pointermove'/.test(capsuleRenderer) &&
    !/setPointerCapture/.test(capsuleRenderer) &&
    !/window\.cap\.drag/.test(capsuleRenderer)],
  ['胶囊预加载不再暴露位移接口', !/^\s*drag\s*:/m.test(readFile(json.files['capsule-preload.js']))],
  ['cap:drag 改为 handle 并回传位移', /ipcMain\.handle\('cap:drag'/.test(pip) && pip.includes('clamped')],
  ['退出前落盘胶囊位置', pip.includes('function flushCapPos') && main.includes('flushCapPos()')],
  ['卷宗搜索输入框', indexHtml.includes('id="record-search"')],
  ['卷宗搜索渲染逻辑', renderer.includes('scrollSearch') && renderer.includes('record-no-match')],
  ['改名弹窗（含归属选择）', indexHtml.includes('id="rename-mask"') && indexHtml.includes('id="rename-scene"')],
  ['改名返回 name + scene', renderer.includes('function renameRecordModal') && renderer.includes('res.scene')],
  ['极往页签', indexHtml.includes('data-page="past"')],
  ['极往页面结构', indexHtml.includes('id="past-chart"') && indexHtml.includes('id="past-study-chips"')],
  ['极往统计逻辑', renderer.includes('function renderPast') && renderer.includes('function pastBuckets')],
  ['极往已接入 refreshAll', /renderScroll\(\);\s*\n\s*renderModuleTimes\(\);\s*\n\s*renderPast\(\)/.test(renderer)],
  ['极往样式', styles.includes('.past-chip') && styles.includes('.past-col')],
];

let ok = 0, bad = 0;
for (const [name, pass] of checks) {
  console.log((pass ? '  ✓ ' : '  ✗ ') + name);
  pass ? ok++ : bad++;
}
console.log(`\n打包内容核验：通过 ${ok} / 失败 ${bad}`);
process.exit(bad ? 1 : 0);
