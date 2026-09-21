const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('termbridge', {
  getState: () => ipcRenderer.invoke('app:state'),
  detectTools: () => ipcRenderer.invoke('tools:detect'),
  getCapabilities: (agent) => ipcRenderer.invoke('tools:capabilities', agent),
  installTool: (agent) => ipcRenderer.invoke('tools:install', agent),
  configureTool: (agent) => ipcRenderer.invoke('tools:configure', agent),
  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  refreshProject: () => ipcRenderer.invoke('project:refresh'),
  startAgent: (agent, options = {}) => ipcRenderer.invoke('agent:start', { agent, options }),
  send: (text) => ipcRenderer.invoke('terminal:write', text),
  resize: (cols, rows) => ipcRenderer.invoke('terminal:resize', { cols, rows }),
  restart: () => ipcRenderer.invoke('terminal:restart'),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
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
  },
  onSetupComplete: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('setup:complete', handler);
    return () => ipcRenderer.removeListener('setup:complete', handler);
  },
  onProjectChanged: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('project:changed', handler);
    return () => ipcRenderer.removeListener('project:changed', handler);
  }
});