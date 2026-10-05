/* v1.2.0 验证：长河日/周/月/年/总计 + 下钻 + 自定义事项 + 卷宗改名 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { initBackend } = require('./backend');

const shotDir = path.join(__dirname, 'verify-shots');
if (!fs.existsSync(shotDir)) fs.mkdirSync(shotDir, { recursive: true });
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let win;
const assert = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) errors.push(msg); };
const js = async code => win.webContents.executeJavaScript(code);

app.whenReady().then(async () => {
  try {
  initBackend(() => win);
  win = new BrowserWindow({
    show: true, width: 1200, height: 820, backgroundColor: '#0c1119',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) errors.push('[console] ' + message); });
  console.log('STEP load');
  await win.loadFile(path.join(__dirname, 'src', 'index.html'));
  await sleep(2000);
  console.log('STEP inject');

  // ---- 注入跨期 mock 数据 ----
  await js(`(async () => {
    const pad = n => String(n).padStart(2,'0');
    const dk = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
    const recs = [];
    let seq = 0;
    const mk = (d, h, dur, scene, mod, mode='stopwatch', phase=null) => {
      const s = new Date(d); s.setHours(h, 0, 0, 0);
      const e = new Date(s.getTime() + dur*1000);
      recs.push({ id:'v12_'+(seq++), date:dk(d), startAt:s.toISOString(), endAt:e.toISOString(),
        durationSec:dur, plannedSec:null, mode, scene, module:mod, status:'finished', completed:true,
        phase: phase || (mode==='focus'?'focus':null), round: mode==='focus'?1:null, updatedAt:e.getTime() });
    };
    const now = new Date();
    // 今天：言语 2 段（9 点、14 点）、判断 1 段、休息 1 段、专注 2 轮
    mk(now, 9, 2400, 'study', '言语理解');
    mk(now, 14, 3000, 'study', '言语理解');
    mk(now, 10, 1800, 'study', '判断推理');
    mk(now, 12, 2700, 'life', '用餐');
    mk(now, 16, 1500, 'study', '资料分析', 'focus');
    mk(now, 16, 300, 'life', '休息', 'focus', 'short');
    // 本周一、周三
    const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay()+6)%7));
    const wed = new Date(mon); wed.setDate(mon.getDate()+2);
    mk(mon, 20, 3600, 'study', '申论');
    mk(wed, 19, 1200, 'study', '政治理论');
    // 上月 2 天
    const lm1 = new Date(now.getFullYear(), now.getMonth()-1, 5); mk(lm1, 9, 4200, 'study', '数量关系');
    const lm2 = new Date(now.getFullYear(), now.getMonth()-1, 18); mk(lm2, 15, 900, 'life', '运动');
    // 今年 3 月、6 月
    mk(new Date(now.getFullYear(), 2, 10), 10, 5400, 'study', '常识判断');
    mk(new Date(now.getFullYear(), 5, 2), 20, 3300, 'study', '申论');
    // 去年 10、11 月
    mk(new Date(now.getFullYear()-1, 9, 8), 9, 4800, 'study', '言语理解');
    mk(new Date(now.getFullYear()-1, 9, 9), 10, 4200, 'study', '判断推理');
    mk(new Date(now.getFullYear()-1, 10, 15), 14, 3600, 'life', '杂务');
    for (const r of recs) await window.gu.upsertRecord(r);
    records = await window.gu.getRecords();
    refreshAll();
    return records.length;
  })()`);
  await sleep(800);

  console.log('STEP river');
  // ---- 长河五模式 ----
  await js(`document.querySelector('.tab[data-page="river"]').click(); 1`);
  await sleep(600);
  const counts = {};
  let dayCards = null;
  for (const rg of ['day', 'week', 'month', 'year', 'total']) {
    await js(`document.querySelector('#river-range button[data-range="${rg}"]').click(); 1`);
    await sleep(500);
    counts[rg] = await js(`document.querySelectorAll('#river-chart .river-col').length`);
    if (rg === 'day') dayCards = await js(`Array.from(document.querySelectorAll('#stat-cards .sc-val')).map(e=>e.textContent)`);
    fs.writeFileSync(path.join(shotDir, `v12-${rg}.png`), (await win.webContents.capturePage()).toPNG());
  }
  assert(counts.day === 24, '日视图 24 时辰柱，实际 ' + counts.day);
  assert(counts.week === 7, '周视图 7 天柱，实际 ' + counts.week);
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  assert(counts.month === daysInMonth, '月视图 ' + daysInMonth + ' 天柱，实际 ' + counts.month);
  assert(counts.year === 12, '年视图 12 月柱，实际 ' + counts.year);
  assert(counts.total >= 12, '总计视图按月柱 >=12，实际 ' + counts.total);

  // 今日卡片（周一时本周一即今天，含申论 1 段）：修习 12300 秒=3.4h、凡尘 3000 秒=50 分、7 段、专注 1 轮
  console.log('日卡片:', JSON.stringify(dayCards));
  assert(dayCards[0].indexOf('3.4') >= 0, '今日修习 3.4 小时，实际 ' + dayCards[0]);
  assert(dayCards[1].indexOf('50') >= 0, '今日凡尘 50 分钟，实际 ' + dayCards[1]);
  assert(dayCards[2] === '7 段', '今日卷宗 7 段，实际 ' + dayCards[2]);
  assert(dayCards[4] === '1 轮', '专注圆满 1 轮，实际 ' + dayCards[4]);

  // ---- 下钻：年视图点当前月柱 -> 月视图 ----
  await js(`document.querySelector('#river-range button[data-range="year"]').click(); 1`);
  await sleep(400);
  await js(`document.querySelectorAll('#river-chart .river-col')[new Date().getMonth()].click(); 1`);
  await sleep(500);
  const afterDrill = await js(`({range: river.range, bars: document.querySelectorAll('#river-chart .river-col').length, label: document.querySelector('#river-cursor-label').textContent})`);
  assert(afterDrill.range === 'month' && afterDrill.bars === daysInMonth, '年柱下钻到月视图，实际 ' + JSON.stringify(afterDrill));
  fs.writeFileSync(path.join(shotDir, 'v12-drill-month.png'), (await win.webContents.capturePage()).toPNG());

  console.log('STEP custom');
  // ---- 自定义事项 ----
  await js(`settings.customStudy=['错题复盘']; settings.customLife=['通勤']; saveSettings(); buildModuleGrids(); renderModuleTimes(); selectModule('study','错题复盘'); 1`);
  await sleep(300);
  const custom = await js(`({
    study: Array.from(document.querySelectorAll('#study-grid .module-btn')).map(b=>b.dataset.module),
    life: Array.from(document.querySelectorAll('#life-grid .module-btn')).map(b=>b.dataset.module),
    dial: document.querySelector('#dial-module').textContent
  })`);
  assert(custom.study.indexOf('错题复盘') >= 0 && custom.life.indexOf('通勤') >= 0, '自定义事项出现: ' + JSON.stringify(custom));
  assert(custom.dial === '错题复盘', '选中自定义科目，实际 ' + custom.dial);
  await js(`document.querySelector('.tab[data-page="timer"]').click(); 1`);
  await sleep(400);
  fs.writeFileSync(path.join(shotDir, 'v12-custom.png'), (await win.webContents.capturePage()).toPNG());

  console.log('STEP rename');
  // ---- 卷宗改名 ----
  await js(`document.querySelector('.tab[data-page="scroll"]').click(); 1`);
  await sleep(500);
  const renameOk = await js(`(async () => {
    const rec = records.find(r => r.module === '言语理解');
    await window.gu.upsertRecord({ ...rec, module: '言语理解·真题强化', updatedAt: Date.now() });
    records = await window.gu.getRecords();
    refreshAll();
    return records.some(r => r.module === '言语理解·真题强化');
  })()`);
  assert(renameOk === true, '卷宗改名成功');
  await sleep(400);
  fs.writeFileSync(path.join(shotDir, 'v12-rename.png'), (await win.webContents.capturePage()).toPNG());
  const editBtns = await js(`document.querySelectorAll('.edit-btn').length`);
  assert(editBtns >= 10, '每行有改名按钮，实际 ' + editBtns);

  console.log('ERRORS=' + (errors.length ? errors.join(' | ') : 'NONE'));
  } catch (e) {
    console.log('FATAL ' + e.stack);
    try { fs.writeFileSync(path.join(shotDir, 'v12-error.png'), (await win.webContents.capturePage()).toPNG()); } catch (_) {}
  } finally {
    app.quit();
  }
});
