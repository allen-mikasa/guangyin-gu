/* 验证脚本：electron verify.js --user-data-dir=test-profile */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { initBackend } = require('./backend');

const shotDir = path.join(__dirname, 'verify-shots');
if (!fs.existsSync(shotDir)) fs.mkdirSync(shotDir, { recursive: true });
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(shotDir, name), img.toPNG());
  console.log('SHOT ' + name);
}

app.whenReady().then(async () => {
  try {
    initBackend(() => win);
    const win = new BrowserWindow({
      show: true, width: 1200, height: 820, backgroundColor: '#0c1119',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
      }
    });
    win.webContents.on('console-message', (e, level, message) => {
      if (level >= 2) errors.push('[console:' + level + '] ' + message);
    });
    win.webContents.on('render-process-gone', (e, d) => errors.push('render-gone ' + JSON.stringify(d)));
    win.webContents.on('preload-error', (e, p, err) => errors.push('preload ' + err.message));

    await win.loadFile(path.join(__dirname, 'src', 'index.html'));
    await sleep(2200);
    await shot(win, 'v1-home.png');

    // 选模块 + 倒计时模式
    await win.webContents.executeJavaScript(`selectModule('study','资料分析'); setMode('countdown'); 1`);
    await sleep(300);
    await shot(win, 'v2-countdown.png');

    // 开始 3 秒倒计时（测试到点闭环）
    await win.webContents.executeJavaScript(`$('#cd-min').value=0; $('#cd-sec').value=3; start(); 1`);
    await sleep(1500);
    await shot(win, 'v3-running.png');
    const dial = await win.webContents.executeJavaScript(`$('#dial-time').textContent`);
    console.log('DIAL_AFTER_1.5S=' + dial);
    const ring = await win.webContents.executeJavaScript(`$('#ring-fg').style.strokeDashoffset`);
    console.log('RING_OFFSET=' + ring);
    await sleep(3200);
    const autoDone = await win.webContents.executeJavaScript(`({status:timer.status, completed: records.filter(r=>r.completed).length, idle: $('#btn-start').hidden===false})`);
    console.log('COUNTDOWN_AUTO_DONE=' + JSON.stringify(autoDone));

    // 专注模式轮转测试（压缩为 3 秒一段）
    await win.webContents.executeJavaScript(`selectModule('study','申论'); setMode('focus'); 1`);
    await sleep(300);
    await shot(win, 'v6-focus-cfg.png');
    await win.webContents.executeJavaScript(`
      $('#fk-focus').value=1; $('#fk-short').value=1; $('#fk-long').value=1; $('#fk-cycle').value=2;
      start();
      timer.plannedMs=3000; timer.accumulatedMs=0; timer.startedAt=Date.now();
      timer.focusCfg.short=0.05; timer.focusCfg.long=0.05;
      scheduleEnd(); 1
    `);
    await sleep(500);
    await shot(win, 'v7-focus-running.png');
    await sleep(3200); // 专注段 -> 短休
    const phase1 = await win.webContents.executeJavaScript(`({phase:timer.phase, round:timer.round, module:timer.module, status:timer.status, scene:timer.scene})`);
    console.log('FOCUS_TO_REST=' + JSON.stringify(phase1));
    await shot(win, 'v8-rest.png');
    await sleep(3600); // 短休 -> 第 2 轮专注
    const phase2 = await win.webContents.executeJavaScript(`({phase:timer.phase, round:timer.round, module:timer.module, status:timer.status})`);
    console.log('REST_TO_FOCUS=' + JSON.stringify(phase2));
    await win.webContents.executeJavaScript(`stop(false); 1`);
    await sleep(800);
    const focusRecs = await win.webContents.executeJavaScript(`records.filter(r=>r.mode==='focus').length`);
    console.log('FOCUS_RECORDS=' + focusRecs);

    // 声音引擎（真实点击 UI）
    const audio = await win.webContents.executeJavaScript(`new Promise(res => {
      try {
        document.querySelector('#sound-ocean .s-name').click();
        document.querySelector('#sound-rain .s-name').click();
        setTimeout(() => res({ state: window.soundEngine.ctx.state, ocean: !!window.soundEngine.players.ocean, rain: !!window.soundEngine.players.rain, uiOn: document.querySelectorAll('.sound-item.on').length }), 700);
      } catch (e) { res({ err: e.message }); }
    })`);
    console.log('AUDIO=' + JSON.stringify(audio));
    await win.webContents.executeJavaScript(`window.soundEngine.stopAll();1`);

    // 注入 35 天模拟数据
    const injected = await win.webContents.executeJavaScript(`(${mockData.toString()})()`);
    console.log('MOCK_INJECTED=' + injected);
    await win.webContents.executeJavaScript(`window.gu.getRecords().then(r => { records = r; refreshAll(); return r.length; })`);
    await sleep(500);

    // 长河页
    await win.webContents.executeJavaScript(`document.querySelector('.tab[data-page="river"]').click(); refreshAll(); 1`);
    await sleep(700);
    await shot(win, 'v4-river.png');
    const cards = await win.webContents.executeJavaScript(`[...document.querySelectorAll('.sc-val')].map(e=>e.textContent).join(' | ')`);
    console.log('STAT_CARDS=' + cards);

    // 卷宗页
    await win.webContents.executeJavaScript(`document.querySelector('.tab[data-page="scroll"]').click(); 1`);
    await sleep(600);
    await shot(win, 'v5-scroll.png');
    const rowCount = await win.webContents.executeJavaScript(`document.querySelectorAll('.record-row').length`);
    console.log('RECORD_ROWS=' + rowCount);

    // 删除功能
    const before = await win.webContents.executeJavaScript(`window.gu.getRecords().then(r=>r.length)`);
    const firstId = await win.webContents.executeJavaScript(`document.querySelector('.del-btn').dataset.id`);
    await win.webContents.executeJavaScript(`window.gu.deleteRecord(${JSON.stringify(firstId)}).then(()=>window.gu.getRecords()).then(r=>r.length)`);
    const after = await win.webContents.executeJavaScript(`window.gu.getRecords().then(r=>r.length)`);
    console.log('DELETE_TEST before=' + before + ' after=' + after);

    // 数据文件路径
    const dp = await win.webContents.executeJavaScript(`window.gu.dataPath()`);
    console.log('DATA_FILE=' + dp);

    console.log('ERRORS=' + (errors.length ? errors.join(' || ') : 'NONE'));
    win.close();
    app.quit();
  } catch (e) {
    console.log('FATAL ' + e.stack);
    app.exit(1);
  }
});

async function mockData() {
  const mods = ['资料分析', '言语理解', '判断推理', '数量关系', '常识判断', '政治理论', '申论'];
  const life = ['休息', '用餐', '运动', '杂务'];
  const pad = n => String(n).padStart(2, '0');
  const dk = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  let n = 0;
  for (let d = 34; d >= 0; d--) {
    const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - d);
    if (Math.random() < 0.12) continue;
    const segs = 2 + Math.floor(Math.random() * 4);
    let cur = day.getTime() + (8 * 3600 + Math.floor(Math.random() * 120) * 60) * 1000;
    for (let s = 0; s < segs; s++) {
      const mins = [25, 30, 45, 60, 90][Math.floor(Math.random() * 5)];
      const start = cur, end = cur + mins * 60000;
      const isFocus = Math.random() < 0.4;
      const r = {
        id: 'mock_' + d + '_' + s, date: dk(day),
        startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(),
        durationSec: mins * 60, plannedSec: isFocus ? 25 * 60 : null,
        mode: isFocus ? 'focus' : (Math.random() < 0.5 ? 'stopwatch' : 'countdown'),
        scene: 'study', module: mods[Math.floor(Math.random() * mods.length)],
        status: 'finished', completed: Math.random() < 0.9,
        phase: isFocus ? 'focus' : null, round: isFocus ? 1 + Math.floor(Math.random() * 4) : null,
        updatedAt: end
      };
      await window.gu.upsertRecord(r);
      cur = end + (5 + Math.floor(Math.random() * 20)) * 60000;
      n++;
    }
    if (Math.random() < 0.7) {
      const mins = 15 + Math.floor(Math.random() * 50);
      const start = day.getTime() + (12 * 3600 + Math.floor(Math.random() * 60) * 60) * 1000;
      const r = {
        id: 'mock_life_' + d, date: dk(day),
        startAt: new Date(start).toISOString(), endAt: new Date(start + mins * 60000).toISOString(),
        durationSec: mins * 60, plannedSec: null, mode: 'stopwatch',
        scene: 'life', module: life[Math.floor(Math.random() * life.length)],
        status: 'finished', completed: true, phase: null, round: null, updatedAt: start
      };
      await window.gu.upsertRecord(r);
      n++;
    }
  }
  return n;
}
