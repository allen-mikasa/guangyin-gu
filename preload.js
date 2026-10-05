const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gu', {
  // 记录
  getRecords: () => ipcRenderer.invoke('records:get'),
  upsertRecord: (record) => ipcRenderer.invoke('records:upsert', record),
  deleteRecord: (id) => ipcRenderer.invoke('records:delete', id),
  clearRecords: () => ipcRenderer.invoke('records:clear'),
  importRecords: (list) => ipcRenderer.invoke('records:import', list),
  // 通知 / 兜底计时
  scheduleDeadline: (deadlineTs, payload) => ipcRenderer.invoke('timer:schedule', deadlineTs, payload),
  cancelDeadline: () => ipcRenderer.invoke('timer:cancel'),
  notify: (title, body) => ipcRenderer.invoke('app:notify', title, body),
  dataPath: () => ipcRenderer.invoke('app:dataPath'),
  enterPip: () => ipcRenderer.invoke('win:enter-pip'),
  exitPip: () => ipcRenderer.invoke('win:exit-pip'),
  setPinned: (on) => ipcRenderer.invoke('win:set-pinned', on),
  hideSelf: () => ipcRenderer.invoke('win:hide-self'),
  capShow: () => ipcRenderer.invoke('cap:show'),
  capHide: () => ipcRenderer.invoke('cap:hide'),
  capClose: () => ipcRenderer.invoke('cap:close'),
  capState: (s) => ipcRenderer.send('cap:state', s),
  capDiag: (msg) => ipcRenderer.invoke('cap:diag', msg),
  onCapRequestExit: (cb) => {
    ipcRenderer.on('cap:request-exit', (_evt, p) => cb(p));
  },
  onPipExited: (cb) => {
    ipcRenderer.on('pip:exited', () => cb());
  },
  onCapExpanded: (cb) => {
    ipcRenderer.on('cap:expanded', () => cb());
  },
  onTimerEnded: (cb) => {
    const handler = (_evt, payload) => cb(payload);
    ipcRenderer.on('timer:ended', handler);
  }
});
