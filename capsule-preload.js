const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cap', {
  // 拖动由系统接管（.cap 上的 -webkit-app-region: drag），不再向渲染层暴露位移接口
  expand: () => ipcRenderer.send('cap:expand'),
  exit: () => ipcRenderer.send('cap:exit'),
  onState: cb => ipcRenderer.on('cap:state', (_evt, s) => cb(s))
});
