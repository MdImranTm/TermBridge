const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('termbridge', {
  getState: () => ipcRenderer.invoke('app:state'),
  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  startAgent: (agent) => ipcRenderer.invoke('agent:start', agent),
  send: (text) => ipcRenderer.invoke('terminal:write', text),
  resize: (cols, rows) => ipcRenderer.invoke('terminal:resize', { cols, rows }),
  restart: () => ipcRenderer.invoke('terminal:restart'),
  onData: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('terminal:data', handler);
    return () => ipcRenderer.removeListener('terminal:data', handler);
  },
  onStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('terminal:status', handler);
    return () => ipcRenderer.removeListener('terminal:status', handler);
  },
  onExit: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('terminal:exit', handler);
    return () => ipcRenderer.removeListener('terminal:exit', handler);
  }
});
