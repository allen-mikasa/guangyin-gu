/* 浮窗置顶验证：进入 -> 浮窗内计时 -> 退出恢复 */
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

    // 择一科目
    await js(`selectModule('study','言语理解'); 1`);
    await sleep(300);

    // 进入浮窗
    await js(`document.querySelector('#btn-pip').click(); 1`);
    await sleep(1200);
    const [w, h] = win.getSize();
    const pipState = await js(`({
      bodyPip: document.body.classList.contains('pip'),
      barShown: !document.querySelector('#pip-bar').hidden,
      sceneHidden: getComputedStyle(document.querySelector('.scene-panel')).display === 'none',
      sideHidden: getComputedStyle(document.querySelector('.side-panel')).display === 'none',
      modeHidden: getComputedStyle(document.querySelector('.mode-switch')).display === 'none',
      title: document.querySelector('#pip-title').textContent
    })`);
    assert(pipState.bodyPip, 'body 进入 pip 模式');
    assert(pipState.barShown, '浮窗迷你顶栏显示');
    assert(pipState.sceneHidden && pipState.sideHidden, '左右侧栏隐藏');
    assert(pipState.modeHidden, '模式切换条隐藏');
    assert(pipState.title === '言语理解', '浮窗标题显示当前科目：' + pipState.title);
    assert(win.isAlwaysOnTop(), '窗口已置顶');
    assert(Math.abs(w - 340) <= 20 && Math.abs(h - 580) <= 30, '窗口缩为小窗：' + w + 'x' + h);
    fs.writeFileSync(path.join(shotDir, 'pip-idle.png'), (await win.webContents.capturePage()).toPNG());

    // 浮窗内开始计时
    await js(`document.querySelector('#btn-start').click(); 1`);
    await sleep(2500);
    const runningUI = await js(`({
      status: timer.status,
      pauseVisible: !document.querySelector('#btn-pause').hidden,
      timeText: document.querySelector('#dial-time').textContent
    })`);
    assert(runningUI.status === 'running' && runningUI.pauseVisible, '浮窗内计时正常运行，时间 ' + runningUI.timeText);
    fs.writeFileSync(path.join(shotDir, 'pip-running.png'), (await win.webContents.capturePage()).toPNG());

    // 浮窗内暂停
    await js(`document.querySelector('#btn-pause').click(); 1`);
    await sleep(800);
    const paused = await js(`timer.status`);
    assert(paused === 'paused', '浮窗内可暂停');
    fs.writeFileSync(path.join(shotDir, 'pip-paused.png'), (await win.webContents.capturePage()).toPNG());

    // 退出浮窗（计时暂停态保留）
    await js(`document.querySelector('#btn-pip-exit').click(); 1`);
    await sleep(1200);
    const [w2, h2] = win.getSize();
    const after = await js(`({
      bodyPip: document.body.classList.contains('pip'),
      barHidden: document.querySelector('#pip-bar').hidden,
      status: timer.status,
      topbar: getComputedStyle(document.querySelector('.topbar')).display !== 'none'
    })`);
    assert(!after.bodyPip && after.barHidden, '退出后 body 恢复');
    assert(after.topbar, '顶栏恢复显示');
    assert(!win.isAlwaysOnTop(), '置顶已取消');
    assert(w2 >= 1000 && h2 >= 700, '主窗尺寸恢复：' + w2 + 'x' + h2);
    assert(after.status === 'paused', '退出浮窗后暂停态计时保留：' + after.status);
    fs.writeFileSync(path.join(shotDir, 'pip-exit.png'), (await win.webContents.capturePage()).toPNG());

    // 收尾：结束计时
    await js(`document.querySelector('#btn-stop').click(); 1`);
    await sleep(600);
    console.log('ERRORS=' + (errors.length ? errors.join(' | ') : 'NONE'));
  } catch (e) {
    console.log('FATAL ' + e.stack);
  } finally {
    app.quit();
  }
});
