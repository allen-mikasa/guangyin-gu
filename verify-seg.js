/* 片段打标 & 时间桶交集分摊验证（临时 userData，不碰真实数据） */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { initBackend } = require('./backend');

app.setPath('userData', path.join(__dirname, 'test-seg'));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  initBackend(() => win);
  await win.loadFile(path.join(__dirname, 'src', 'index.html'));

  const result = await win.webContents.executeJavaScript(`(function () {
    const out = {};
    function rec(o) {
      return Object.assign({
        id: 'r' + Math.random(), date: '', startAt: '', endAt: '', durationSec: 0, plannedSec: null,
        mode: 'stopwatch', scene: 'study', module: '资料分析',
        status: 'finished', completed: true, phase: null, round: null, updatedAt: Date.now()
      }, o);
    }
    function iso(y, mo, d, h, mi) { return new Date(y, mo, d, h, mi).toISOString(); }

    // 用例1：跨小时 9:50-12:50（180 分钟）
    const r1 = rec({ startAt: iso(2026, 8, 26, 9, 50), endAt: iso(2026, 8, 26, 12, 50), durationSec: 10800, date: '2026-09-26' });
    const b1 = buildBuckets('day', new Date(2026, 8, 26), new Date(2026, 8, 27), [r1]).buckets;
    out.c1 = b1.map(b => Math.round(b.sec));
    out.c1sum = b1.reduce((s, b) => s + b.sec, 0);
    out.c1max = Math.max.apply(null, b1.map(b => b.sec));

    // 用例2：跨天 9/25 22:00 - 9/26 02:00（4 小时）
    const r2 = rec({ startAt: iso(2026, 8, 25, 22, 0), endAt: iso(2026, 8, 26, 2, 0), durationSec: 14400, date: '2026-09-25' });
    const b2 = buildBuckets('day', new Date(2026, 8, 26), new Date(2026, 8, 27), [r2]).buckets;
    out.c2 = b2.slice(0, 3).map(b => Math.round(b.sec));
    const bw = buildBuckets('week', new Date(2026, 8, 21), new Date(2026, 8, 28), [r2]).buckets;
    out.c2week = bw.map(b => Math.round(b.sec));

    // 用例3：跨月 1/31 22:00 - 2/1 02:00
    const r3 = rec({ startAt: iso(2026, 0, 31, 22, 0), endAt: iso(2026, 1, 1, 2, 0), durationSec: 14400, date: '2026-01-31' });
    const b3 = buildBuckets('year', new Date(2026, 0, 1), new Date(2027, 0, 1), [r3]).buckets;
    out.c3 = [Math.round(b3[0].sec), Math.round(b3[1].sec)];

    // 用例4：含暂停 9:00-9:30, 9:40-10:10（共 60 分钟）
    const r4 = rec({
      startAt: iso(2026, 8, 26, 9, 0), endAt: iso(2026, 8, 26, 10, 10), durationSec: 3600, date: '2026-09-26',
      segments: [
        { start: iso(2026, 8, 26, 9, 0), end: iso(2026, 8, 26, 9, 30) },
        { start: iso(2026, 8, 26, 9, 40), end: iso(2026, 8, 26, 10, 10) }
      ]
    });
    const b4 = buildBuckets('day', new Date(2026, 8, 26), new Date(2026, 8, 27), [r4]).buckets;
    out.c4 = [Math.round(b4[9].sec), Math.round(b4[10].sec)];

    // 用例5：旧数据无 segments，9:50-11:20（90 分钟）
    const r5 = rec({ startAt: iso(2026, 8, 26, 9, 50), endAt: iso(2026, 8, 26, 11, 20), durationSec: 5400, date: '2026-09-26' });
    const b5 = buildBuckets('day', new Date(2026, 8, 26), new Date(2026, 8, 27), [r5]).buckets;
    out.c5 = [Math.round(b5[9].sec), Math.round(b5[10].sec), Math.round(b5[11].sec)];

    // 打标函数
    const t = { startAt: iso(2026, 8, 26, 9, 0), segments: [{ start: iso(2026, 8, 26, 9, 0), end: null }] };
    const closed = closeLastSegment(t, new Date(2026, 8, 26, 9, 30).getTime());
    out.tag1 = closed[0].end ? 1 : 0;
    const again = appendSegment({ segments: closed }, new Date(2026, 8, 26, 9, 40).getTime());
    out.tag2 = (again.length === 2 && again[1].end === null) ? 1 : 0;

    // recordSecInRange
    out.range1 = Math.round(recordSecInRange(r4, new Date(2026, 8, 26).getTime(), new Date(2026, 8, 27).getTime()));
    out.range2 = Math.round(recordSecInRange(r4, new Date(2026, 8, 26, 10, 0).getTime(), new Date(2026, 8, 26, 11, 0).getTime()));

    return out;
  })()`);

  const fails = [];
  function check(name, cond, extra) {
    if (cond) { console.log('PASS', name); }
    else { fails.push(name); console.log('FAIL', name, extra || ''); }
  }

  check('跨小时 9点桶=600秒', result.c1[9] === 600, JSON.stringify(result.c1));
  check('跨小时 10点桶=3600', result.c1[10] === 3600);
  check('跨小时 11点桶=3600', result.c1[11] === 3600);
  check('跨小时 12点桶=3000', result.c1[12] === 3000);
  check('跨小时 桶总和=10800', Math.round(result.c1sum) === 10800, String(result.c1sum));
  check('跨小时 无桶超过3600', result.c1max <= 3600, String(result.c1max));
  check('跨天 当日0点桶=3600', result.c2[0] === 3600, JSON.stringify(result.c2));
  check('跨天 当日1点桶=3600', result.c2[1] === 3600);
  check('跨天 当日2点桶=0', result.c2[2] === 0);
  check('跨天周视图 周五=7200', result.c2week[4] === 7200, JSON.stringify(result.c2week));
  check('跨天周视图 周六=7200', result.c2week[5] === 7200);
  check('跨月 1月桶=7200', result.c3[0] === 7200, JSON.stringify(result.c3));
  check('跨月 2月桶=7200', result.c3[1] === 7200);
  check('含暂停 9点桶=3000', result.c4[0] === 3000, JSON.stringify(result.c4));
  check('含暂停 10点桶=600', result.c4[1] === 600);
  check('旧数据 9/10/11点=600/3600/1200', result.c5[0] === 600 && result.c5[1] === 3600 && result.c5[2] === 1200, JSON.stringify(result.c5));
  check('打标 暂停闭段', result.tag1 === 1);
  check('打标 继续开新段', result.tag2 === 1);
  check('交集 整日=3600', result.range1 === 3600, String(result.range1));
  check('交集 10:00-11:00=600', result.c4 && result.range2 === 600, String(result.range2));

  console.log('\n' + (fails.length ? ('X ' + fails.length + ' 项失败') : '全部断言通过'));
  app.quit();
});
