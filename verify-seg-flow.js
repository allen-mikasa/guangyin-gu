/* 端到端：开始→暂停→继续→结束，检查持久化 segments 打标 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { initBackend } = require('./backend');

app.setPath('userData', path.join(__dirname, 'test-seg-flow'));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  initBackend(() => win);
  await win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.on('console-message', (e, level, message) => console.log('[page]', message));

  const r = await win.webContents.executeJavaScript(`(async function () {
    try {
      console.log('step select');
      selectModule('study', '资料分析');
      console.log('step start');
      await start();
      const id1 = timer.recordId;
      console.log('started id=' + id1);
      await pause();
      console.log('paused');
      const paused = await window.gu.getRecords();
      const pr = paused.find(x => x.id === id1);
      await resume();
      console.log('resumed');
      await stop(false);
      console.log('stopped');
      const all = await window.gu.getRecords();
      const fr = all.find(x => x.id === id1);
      return {
        pausedSegs: pr.segments ? pr.segments.length : -1,
        pausedEnd: pr.segments && pr.segments[0].end ? 1 : 0,
        pausedOneOpen: pr.segments && pr.segments.length === 1 ? 1 : 0,
        finalSegs: fr.segments ? fr.segments.length : -1,
        allClosed: fr.segments && fr.segments.every(s => !!s.end) ? 1 : 0,
        status: fr.status
      };
    } catch (err) { return { error: String(err && err.stack || err) }; }
  })()`);
  if (r.error) { console.log('页面异常：', r.error); app.quit(); return; }

  const fails = [];
  function check(name, cond, extra) {
    if (cond) console.log('PASS', name);
    else { fails.push(name); console.log('FAIL', name, extra || ''); }
  }
  check('暂停后仅 1 个片段', r.pausedSegs === 1, String(r.pausedSegs));
  check('暂停后首片段已闭合', r.pausedEnd === 1);
  check('继续结束后共 2 个片段', r.finalSegs === 2, String(r.finalSegs));
  check('结束后所有片段均闭合', r.allClosed === 1);
  check('记录状态 finished', r.status === 'finished', r.status);

  console.log('\n' + (fails.length ? ('X ' + fails.length + ' 项失败') : '端到端打标验证通过'));
  app.quit();
});
