/* ========== 窗口 / 胶囊位置持久化 ==========
 * 单独成文件，避免 main 与 pip 循环依赖。
 * 存 userData/guangyin-window.json；启动恢复时校验是否仍落在可见屏幕上。
 */
const { app, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const FILE = () => path.join(app.getPath('userData'), 'guangyin-window.json');

let state = { main: null, mainMaximized: false, capsule: null, pinned: false, page: 'timer' };

function load() {
  try {
    const raw = fs.readFileSync(FILE(), 'utf-8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') state = { ...state, ...obj };
  } catch (e) { /* 首次运行无文件，忽略 */ }
  return state;
}

function save(patch) {
  if (patch) state = { ...state, ...patch };
  try {
    const p = FILE();
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmp, p);
  } catch (e) {
    console.error('保存窗口状态失败', e);
  }
}

/** 该位置是否仍落在某块屏幕的可见区域内（防拔掉副屏后窗口跑到屏幕外） */
function isOnScreen(bounds) {
  if (!bounds || typeof bounds.x !== 'number' || typeof bounds.width !== 'number') return false;
  return screen.getAllDisplays().some(d => {
    const a = d.workArea;
    const overlapW = Math.min(a.x + a.width, bounds.x + bounds.width) - Math.max(a.x, bounds.x);
    const overlapH = Math.min(a.y + a.height, bounds.y + bounds.height) - Math.max(a.y, bounds.y);
    // 至少露出 200×120 才认为“找得回来”，否则视为跑到屏幕外
    return overlapW >= 200 && overlapH >= 120;
  });
}

/** 把 bounds 完整夹进某块屏幕的工作区 */
function clampToDisplay(bounds, display) {
  const a = (display || screen.getPrimaryDisplay()).workArea;
  const width = Math.min(bounds.width, a.width);
  const height = Math.min(bounds.height, a.height);
  const x = Math.min(Math.max(bounds.x, a.x), a.x + a.width - width);
  const y = Math.min(Math.max(bounds.y, a.y), a.y + a.height - height);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

module.exports = { load, save, isOnScreen, clampToDisplay, get state() { return state; } };
