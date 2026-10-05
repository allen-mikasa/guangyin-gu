/* 胶囊端到端验证（临时 profile，不碰真实数据） */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { initBackend } = require('./backend');
const { registerPip, forceRestore } = require('./pip');

app.setPath('userData', path.join(__dirname, 'test-cap'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let win;
const fails = [];
function step(m) { fs.appendFileSync(path.join(__dirname, 'cap-debug.txt'), m + '\n'); }
function check(n, c, e) {
  if (c) { console.log('PASS', n); step('PASS ' + n); }
  else { fails.push(n); console.log('FAIL', n, e || ''); step('FAIL ' + n + ' ' + (e || '')); }
}
function getCap() {
  return BrowserWindow.getAllWindows().find(w => w !== win && w.getBounds().height <= 60);
}

app.whenReady().then(async () => {
 try {
  fs.writeFileSync(path.join(__dirname, 'cap-debug.txt'), 'start\n');
  initBackend(() => win);
  registerPip(() => win);
  win = new BrowserWindow({
    width: 1200, height: 820, backgroundColor: '#0c1119',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  await win.loadFile(path.join(__dirname, 'src', 'index.html'));
  await sleep(2200);
  step('loaded');

  // 进入浮窗（idle，主窗仍显示）
  await win.webContents.executeJavaScript(`enterPip()`);
  await sleep(800);
  let s1 = await win.webContents.executeJavaScript(`({p:pipMode,c:capShown})`);
  check('进入浮窗 pipMode', s1.p === true, JSON.stringify(s1));
  check('idle 态不显示胶囊', s1.c === false);
  check('idle 态无胶囊窗口', !getCap());

  // 开始计时 → 自动胶囊
  await win.webContents.executeJavaScript(`selectModule('study','资料分析'); start()`);
  await sleep(1500);
  let cap = getCap();
  check('开始后 capShown', await win.webContents.executeJavaScript(`capShown`) === true);
  check('胶囊窗口已创建', !!cap);
  check('主窗口已隐藏', !win.isVisible());
  check('胶囊可见且置顶', cap && cap.isVisible() && cap.isAlwaysOnTop());
  const capText = await cap.webContents.executeJavaScript(`$('#cap-mod').textContent+'|'+$('#cap-time').textContent`);
  check('胶囊显示科目与时间', capText.indexOf('资料分析') === 0 && capText.indexOf('00:') > 0, capText);
  step('cap shown');

  // 暂停 → 展开
  await win.webContents.executeJavaScript(`pause()`);
  await sleep(800);
  cap = getCap();
  check('暂停后主窗展开', win.isVisible());
  check('暂停后胶囊隐藏', !cap || !cap.isVisible());
  const s3 = await win.webContents.executeJavaScript(`({c:capShown,s:timer.status})`);
  check('暂停态 capShown=false', s3.c === false && s3.s === 'paused', JSON.stringify(s3));

  // 继续 → 缩回
  await win.webContents.executeJavaScript(`resume()`);
  await sleep(800);
  cap = getCap();
  check('继续后胶囊显示', cap && cap.isVisible() && !win.isVisible());

  // 点击胶囊 → 展开
  await cap.webContents.executeJavaScript(`window.cap.expand()`);
  await sleep(800);
  check('点击胶囊后主窗展开', win.isVisible());
  check('展开后 capShown=false', await win.webContents.executeJavaScript(`capShown`) === false);

  // 迷你栏按钮缩回
  await win.webContents.executeJavaScript(`showCapsule()`);
  await sleep(600);
  cap = getCap();
  check('按钮缩回胶囊', cap && cap.isVisible());

  // 拖动
  const b0 = cap.getBounds();
  await cap.webContents.executeJavaScript(`window.cap.drag(12,-9)`);
  await sleep(200);
  const b1 = cap.getBounds();
  check('拖动改变位置', Math.abs(b1.x - b0.x - 12) <= 1 && Math.abs(b1.y - b0.y + 9) <= 1, `${b0.x},${b0.y}->${b1.x},${b1.y}`);

  // 胶囊 ✕ 退出
  await cap.webContents.executeJavaScript(`window.cap.exit()`);
  await sleep(1000);
  check('✕ 后胶囊销毁', !getCap());
  check('✕ 后主窗显示', win.isVisible());
  const s5 = await win.webContents.executeJavaScript(`({p:pipMode,c:capShown})`);
  check('✕ 后置顶态复位', s5.p === false && s5.c === false, JSON.stringify(s5));

  // idle 自动隐藏 + 第二实例唤起
  await win.webContents.executeJavaScript(`enterPip()`);
  await sleep(600);
  await win.webContents.executeJavaScript(`scheduleIdleHide()`);
  await sleep(4600);
  check('空闲 4 秒后主窗隐藏', !win.isVisible());
  forceRestore(win);
  await sleep(800);
  check('第二实例唤起恢复显示', win.isVisible());
  const s6 = await win.webContents.executeJavaScript(`({p:pipMode,c:capShown})`);
  check('唤起后置顶态复位', s6.p === false && s6.c === false, JSON.stringify(s6));
  check('恢复后窗口宽度正常', win.getBounds().width >= 1040);

  console.log('\n' + (fails.length ? ('X ' + fails.length + ' 项失败') : '胶囊全部断言通过'));
 } catch (err) {
  const m = String(err && err.stack || err);
  console.log('验证异常: ' + m); step('EXC ' + m);
 }
 app.quit();
});
