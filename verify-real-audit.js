/* 真实数据只读审计：检查所有日/周/月桶是否超物理容量（不写入任何数据） */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { initBackend } = require('./backend');

let win;
app.setPath('userData', path.join(app.getPath('appData'), '光阴蛊'));
app.whenReady().then(async () => {
  initBackend(() => win);
  win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  await win.loadFile(path.join(__dirname, 'src', 'index.html'));
  await new Promise(r => setTimeout(r, 1500));

  const audit = await win.webContents.executeJavaScript(`(function () {
    const list = effectiveRecords();
    const issues = [];
    const days = {};
    list.forEach(r => {
      days[r.date] = 1;
      segmentsOf(r).forEach(sg => {
        let cur = startOfDay(new Date(sg.start)).getTime();
        while (cur <= sg.end) { days[dateKey(new Date(cur))] = 1; cur += 86400000; }
      });
    });
    // 日：小时桶容量 3600
    Object.keys(days).sort().forEach(k => {
      const d = new Date(k + 'T00:00:00');
      buildBuckets('day', d, new Date(d.getTime() + 86400000), list).buckets.forEach((x, h) => {
        if (x.sec > 3600.5) issues.push(k + ' ' + h + '时 修习' + Math.round(x.sec) + '秒');
        if (x.lifeSec > 3600.5) issues.push(k + ' ' + h + '时 凡尘' + Math.round(x.lifeSec) + '秒');
      });
    });
    // 周：日桶容量 86400
    const weeks = {};
    list.forEach(r => segmentsOf(r).forEach(sg => {
      const s0 = startOfDay(new Date(sg.start));
      const w = new Date(s0); w.setDate(s0.getDate() - (s0.getDay() + 6) % 7);
      weeks[dateKey(w)] = 1;
    }));
    Object.keys(weeks).sort().forEach(k => {
      const s = new Date(k + 'T00:00:00');
      buildBuckets('week', s, new Date(s.getTime() + 7 * 86400000), list).buckets.forEach((x, i) => {
        if (x.sec > 86400.5 || x.lifeSec > 86400.5) issues.push(k + '周 第' + (i + 1) + '天超86400');
      });
    });
    // 年：月桶容量
    const years = {};
    list.forEach(r => { years[new Date(r.startAt).getFullYear()] = 1; });
    Object.keys(years).sort().forEach(y => {
      buildBuckets('year', new Date(y, 0, 1), new Date(+y + 1, 0, 1), list).buckets.forEach((x, m) => {
        const cap = (new Date(y, m + 1, 1) - new Date(y, m, 1)) / 1000;
        if (x.sec > cap + 0.5 || x.lifeSec > cap + 0.5) issues.push(y + '年' + (m + 1) + '月超容量');
      });
    });
    // 新记录：片段总时长应与 durationSec 一致
    list.forEach(r => {
      if (Array.isArray(r.segments) && r.segments.length) {
        const segSec = segmentsOf(r).reduce((s, sg) => s + (sg.end - sg.start) / 1000, 0);
        if (Math.abs(segSec - r.durationSec) > 3) issues.push(r.id + ' 片段' + Math.round(segSec) + ' vs 记录' + r.durationSec);
      }
    });
    return { n: list.length, days: Object.keys(days).length, weeks: Object.keys(weeks).length, issues: issues };
  })()`);

  console.log('审计记录数=' + audit.n + '，涉及日期=' + audit.days + '，涉及周=' + audit.weeks);
  if (audit.issues.length) {
    console.log('X 发现 ' + audit.issues.length + ' 处超容量：');
    audit.issues.forEach(i => console.log('  - ' + i));
  } else {
    console.log('真实数据审计通过：所有桶均未超物理容量');
  }
  app.quit();
});
