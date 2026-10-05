/* 柱图生长动画验证 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { initBackend } = require('./backend');
const { registerPip } = require('./pip');

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
    registerPip(() => win);
    win.webContents.on('console-message', (e, level, message) => { if (level >= 2) errors.push('[console] ' + message); });
    await win.loadFile(path.join(__dirname, 'src', 'index.html'));
    await sleep(2000);

    // 注入今天与本周数据
    await js(`(async () => {
      const pad = n => String(n).padStart(2,'0');
      const dk = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
      const recs = []; let seq = 0;
      const mk = (d, h, dur, mod) => {
        const s = new Date(d); s.setHours(h,0,0,0);
        const e = new Date(s.getTime()+dur*1000);
        recs.push({ id:'a_'+(seq++), date:dk(d), startAt:s.toISOString(), endAt:e.toISOString(),
          durationSec:dur, plannedSec:null, mode:'stopwatch', scene:'study', module:mod,
          status:'finished', completed:true, phase:null, round:null, updatedAt:e.getTime() });
      };
      const now = new Date();
      mk(now, 9, 3600, '言语理解');
      mk(now, 14, 5400, '资料分析');
      const mon = new Date(now); mon.setDate(now.getDate()-((now.getDay()+6)%7));
      mk(mon, 20, 1800, '申论');
      for (const r of recs) await window.gu.upsertRecord(r);
      records = await window.gu.getRecords();
      refreshAll();
      return records.length;
    })()`);
    await sleep(400);

    await js(`document.querySelector('.tab[data-page="river"]').click(); 1`);
    await sleep(700);

    // 切换到周视图：click 同步返回后，双 rAF 尚未触发 -> 柱高应为初始空值
    const before = await js(`(function(){
      document.querySelector('#river-range button[data-range="week"]').click();
      return Array.from(document.querySelectorAll('#river-chart .rc-bar')).map(b => b.style.height);
    })()`);
    assert(before.length > 0 && before.every(v => v === ''), '动画起点柱高为 0（' + before.length + ' 根待生长）');

    // transition 配置
    const css = await js(`(function(){
      const b = document.querySelector('#river-chart .rc-bar');
      const cs = getComputedStyle(b);
      return { prop: cs.transitionProperty, dur: cs.transitionDuration };
    })()`);
    assert(css.prop.indexOf('height') >= 0, 'transition 包含 height：' + css.prop);
    assert(css.dur.indexOf('0.45') >= 0, '动画时长 0.45s：' + css.dur);

    // 动画结束后到达目标高度
    await sleep(700);
    const after = await js(`Array.from(document.querySelectorAll('#river-chart .rc-bar')).map(b => Math.abs(parseFloat(b.style.height) - parseFloat(b.dataset.h)) < 0.01)`);
    assert(after.length > 0 && after.every(Boolean), '生长结束后柱高等于目标值（' + after.length + ' 根）');
    fs.writeFileSync(path.join(shotDir, 'anim-week.png'), (await win.webContents.capturePage()).toPNG());

    // 月、年视图切换同样有动画，截图确认最终态
    await js(`document.querySelector('#river-range button[data-range="month"]').click(); 1`);
    await sleep(750);
    const monthOk = await js(`Array.from(document.querySelectorAll('#river-chart .rc-bar')).map(b => Math.abs(parseFloat(b.style.height) - parseFloat(b.dataset.h)) < 0.01).every(Boolean)`);
    assert(monthOk, '月视图动画正常');
    fs.writeFileSync(path.join(shotDir, 'anim-month.png'), (await win.webContents.capturePage()).toPNG());

    await js(`document.querySelector('#river-range button[data-range="year"]').click(); 1`);
    await sleep(750);
    fs.writeFileSync(path.join(shotDir, 'anim-year.png'), (await win.webContents.capturePage()).toPNG());

    console.log('ERRORS=' + (errors.length ? errors.join(' | ') : 'NONE'));
  } catch (e) {
    console.log('FATAL ' + e.stack);
  } finally {
    app.quit();
  }
});
