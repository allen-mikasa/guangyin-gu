const { app, BrowserWindow, shell, Tray, Menu, nativeImage, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { initBackend, clearDeadline } = require('./backend');
const { registerPip, forceRestore, flushCapPos } = require('./pip');
const store = require('./window-state');

let mainWindow = null;
let tray = null;
let saveTimer = null;

/** 窗口位置/大小落盘（防抖，避免拖动时频繁写文件） */
function persistMain() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) return;
    if (mainWindow.isMaximized()) store.save({ mainMaximized: true });
    else store.save({ main: mainWindow.getBounds(), mainMaximized: false });
  }, 400);
}

function createWindow() {
  const st = store.load();
  const saved = st.main;
  const useSaved = !!(saved && store.isOnScreen(saved));
  const bounds = useSaved ? store.clampToDisplay(saved) : null;

  mainWindow = new BrowserWindow({
    width: bounds ? bounds.width : 1200,
    height: bounds ? bounds.height : 820,
    x: bounds ? bounds.x : undefined,
    y: bounds ? bounds.y : undefined,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: '#0c1119',
    title: '光阴蛊',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true
    }
  });
  mainWindow.setMenuBarVisibility(false);
  if (useSaved && st.mainMaximized) mainWindow.maximize();
  if (st.pinned) mainWindow.setAlwaysOnTop(true, 'screen-saver');   // 恢复上次的置顶开关
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('resize', persistMain);
  mainWindow.on('move', persistMain);
  mainWindow.on('maximize', persistMain);
  mainWindow.on('unmaximize', persistMain);
  mainWindow.on('close', () => {
    if (!mainWindow.isDestroyed() && !mainWindow.isMinimized()) {
      if (mainWindow.isMaximized()) store.save({ mainMaximized: true });
      else store.save({ main: mainWindow.getBounds(), mainMaximized: false });
    }
  });

  registerPip(() => mainWindow);
}

/** 托盘：窗口被隐藏 / 缩进胶囊后仍能一键召回 */
function createTray() {
  try {
    const icoPath = path.join(__dirname, 'build', 'icon.ico');
    let img = fs.existsSync(icoPath) ? nativeImage.createFromPath(icoPath) : nativeImage.createEmpty();
    if (img.isEmpty()) img = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));
    tray = new Tray(img);
    tray.setToolTip('光阴蛊 · 光阴滚滚，寸阴是竞');
    const menu = Menu.buildFromTemplate([
      { label: '显示主窗', click: () => { if (mainWindow) { forceRestore(mainWindow); mainWindow.show(); mainWindow.focus(); } } },
      { label: '退出置顶 / 恢复主窗', click: () => { if (mainWindow) forceRestore(mainWindow); } },
      { type: 'separator' },
      { label: '退出光阴蛊', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(menu);
    tray.on('double-click', () => { if (mainWindow) { forceRestore(mainWindow); mainWindow.show(); mainWindow.focus(); } });
    tray.on('click', () => { if (mainWindow && !mainWindow.isVisible()) { mainWindow.show(); mainWindow.focus(); } });
  } catch (e) {
    console.error('创建托盘失败', e);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      forceRestore(mainWindow);
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    initBackend(() => mainWindow);
    createWindow();
    createTray();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    clearDeadline();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    try { flushCapPos(); } catch (e) {}
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized()) {
      if (mainWindow.isMaximized()) store.save({ mainMaximized: true });
      else store.save({ main: mainWindow.getBounds(), mainMaximized: false });
    }
    try { globalShortcut.unregisterAll(); } catch (e) {}
    if (tray) { tray.destroy(); tray = null; }
  });
}
