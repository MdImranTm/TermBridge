const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('termbridge', {
  getState: () => ipcRenderer.invoke('app:state'),

  detectTools: () => ipcRenderer.invoke('tools:detect'),
  getCapabilities: (agent) => ipcRenderer.invoke('tools:capabilities', agent),
  installTool: (agent) => ipcRenderer.invoke('tools:install', agent),

  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  refreshProject: () => ipcRenderer.invoke('project:refresh'),
  openProjectPath: (folder) => ipcRenderer.invoke('project:open-path', folder),

  startAgent: (agent, options = {}) =>
    ipcRenderer.invoke('agent:start', { agent, options }),

  send: (text) => ipcRenderer.invoke('terminal:write', text),
  resize: (cols, rows) => ipcRenderer.invoke('terminal:resize', { cols, rows }),
  restart: () => ipcRenderer.invoke('terminal:restart'),

  sendChat: (agent, prompt, options = {}) =>
    ipcRenderer.invoke('chat:send', { agent, prompt, options }),
  sendProviderChat: (providerId, model, messages, options = {}) =>
    ipcRenderer.invoke('chat:provider-send', {
      providerId,
      model,
      messages,
      ...options
    }),
  stopChat: () => ipcRenderer.invoke('chat:stop'),

  listProviders: () => ipcRenderer.invoke('providers:list'),
  saveProvider: (provider) => ipcRenderer.invoke('providers:save', provider),
  deleteProvider: (id) => ipcRenderer.invoke('providers:delete', id),
  testProvider: (id) => ipcRenderer.invoke('providers:test', id),
  providerModels: (id) => ipcRenderer.invoke('providers:models', id),

  openExternal: (url) => ipcRenderer.invoke('external:open', url),

  onChatStream: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('chat:stream', handler);
    return () => ipcRenderer.removeListener('chat:stream', handler);
  },

  onChatComplete: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('chat:complete', handler);
    return () => ipcRenderer.removeListener('chat:complete', handler);
  },

  onChatStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('chat:status', handler);
    return () => ipcRenderer.removeListener('chat:status', handler);
  },

  onChatSession: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('chat:session', handler);
    return () => ipcRenderer.removeListener('chat:session', handler);
  },

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
