/* 只读验证：用真实数据副本截图长河/卷宗页，不修改任何数据 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { initBackend } = require('./backend');

const shotDir = path.join(__dirname, 'verify-shots');
if (!fs.existsSync(shotDir)) fs.mkdirSync(shotDir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let win;
app.setPath('userData', path.join(app.getPath('appData'), '光阴蛊'));
app.whenReady().then(async () => {
  initBackend(() => win);
  win = new BrowserWindow({
    show: true, width: 1200, height: 820, backgroundColor: '#0c1119',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  await win.loadFile(path.join(__dirname, 'src', 'index.html'));
  await sleep(2500);
  const n0 = await win.webContents.executeJavaScript(`window.gu.getRecords().then(r=>r.length)`);
  console.log('LOADED_RECORDS=' + n0);
  await win.webContents.executeJavaScript(`document.querySelector('.tab[data-page="river"]').click(); 1`);
  await sleep(1500);
  fs.writeFileSync(path.join(shotDir, 'real-river.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('.tab[data-page="scroll"]').click(); 1`);
  await sleep(1500);
  fs.writeFileSync(path.join(shotDir, 'real-scroll.png'), (await win.webContents.capturePage()).toPNG());
  const n1 = await win.webContents.executeJavaScript(`window.gu.getRecords().then(r=>r.length)`);
  console.log('AFTER_RECORDS=' + n1);
  app.quit();
});
