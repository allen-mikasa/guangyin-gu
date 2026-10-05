/* ========== 光阴蛊 · 后端：本地记录存储 / IPC / 计时兜底 / 通知 ========== */
const { app, ipcMain, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

let dataDir = null;
let dataFile = null;
let getMainWindow = () => null;
let deadlineTimer = null;

function ensureDataFile() {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, JSON.stringify({ records: [] }, null, 2), 'utf-8');
  } catch (e) {
    console.error('初始化数据文件失败', e);
  }
}

function readAll() {
  try {
    ensureDataFile();
    const raw = fs.readFileSync(dataFile, 'utf-8');
    const obj = JSON.parse(raw);
    if (!Array.isArray(obj.records)) return [];
    return obj.records;
  } catch (e) {
    console.error('读取记录失败', e);
    return [];
  }
}

function writeAll(records) {
  try {
    ensureDataFile();
    const tmp = dataFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ records }, null, 2), 'utf-8');
    fs.renameSync(tmp, dataFile);
    return true;
  } catch (e) {
    console.error('写入记录失败', e);
    return false;
  }
}

function clearDeadline() {
  if (deadlineTimer) {
    clearTimeout(deadlineTimer);
    deadlineTimer = null;
  }
}

function scheduleDeadline(deadlineTs, payload) {
  clearDeadline();
  const delay = Math.max(0, deadlineTs - Date.now());
  if (delay > 2_000_000_000) {
    deadlineTimer = setTimeout(() => scheduleDeadline(deadlineTs, payload), 1_800_000_000);
    return;
  }
  deadlineTimer = setTimeout(() => {
    deadlineTimer = null;
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('timer:ended', payload || {});
      if (!win.isFocused()) {
        win.flashFrame(true);
        setTimeout(() => { try { win.flashFrame(false); } catch (e) {} }, 8000);
      }
    }
    if (Notification.isSupported()) {
      const n = new Notification({
        title: payload && payload.title ? payload.title : '时辰已到',
        body: (payload && payload.body) || '一段光阴已尽',
        silent: true,
        icon: path.join(__dirname, 'build', 'icon.ico')
      });
      n.on('click', () => { const w = getMainWindow(); if (w) w.show(); });
      n.show();
    }
  }, delay);
}

function handle(channel, fn) {
  try { ipcMain.removeHandler(channel); } catch (e) {}
  ipcMain.handle(channel, fn);
}

function initBackend(getWindow) {
  getMainWindow = getWindow || getMainWindow;
  dataDir = app.getPath('userData');
  dataFile = path.join(dataDir, 'guangyin-records.json');
  ensureDataFile();

  handle('records:get', () => readAll());
  handle('records:upsert', (_evt, record) => {
    if (!record || !record.id) return { ok: false, error: '缺少 id' };
    const records = readAll();
    const idx = records.findIndex(r => r.id === record.id);
    if (idx >= 0) records[idx] = { ...records[idx], ...record };
    else records.push(record);
    return { ok: writeAll(records) };
  });
  handle('records:delete', (_evt, id) => ({ ok: writeAll(readAll().filter(r => r.id !== id)) }));
  handle('records:clear', () => ({ ok: writeAll([]) }));
  handle('records:import', (_evt, list) => {
    if (!Array.isArray(list)) return { ok: false, error: '数据格式错误' };
    return { ok: writeAll(list) };
  });

  handle('timer:schedule', (_evt, deadlineTs, payload) => {
    scheduleDeadline(deadlineTs, payload);
    return { ok: true };
  });
  handle('timer:cancel', () => { clearDeadline(); return { ok: true }; });

  handle('app:notify', (_evt, title, body) => {
    if (Notification.isSupported()) {
      new Notification({ title: title || '光阴蛊', body: body || '', silent: true }).show();
      return { ok: true };
    }
    return { ok: false };
  });
  handle('app:dataPath', () => dataFile);
}

module.exports = { initBackend, clearDeadline };
