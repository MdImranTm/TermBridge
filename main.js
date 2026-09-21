const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const pty = require('node-pty');

let mainWindow = null;
let terminal = null;
let currentCwd = os.homedir();
let currentAgent = 'powershell';

function stripAnsi(input = '') {
  return String(input)
    .replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, '')
    .replace(/\x1B[@-_]/g, '')
    .replace(/\r/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function stopTerminal() {
  if (!terminal) return;
  try { terminal.kill(); } catch {}
  terminal = null;
}

function startTerminal(agent = currentAgent, cwd = currentCwd) {
  stopTerminal();
  currentAgent = agent || 'powershell';
  currentCwd = cwd || os.homedir();

  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor'
  };

  terminal = pty.spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NoExit'], {
    name: 'xterm-256color',
    cols: 120,
    rows: 32,
    cwd: currentCwd,
    env
  });

  terminal.onData((raw) => {
    send('terminal:data', { raw, clean: stripAnsi(raw), agent: currentAgent });
  });

  terminal.onExit(({ exitCode, signal }) => {
    send('terminal:exit', { exitCode, signal, agent: currentAgent });
    terminal = null;
  });

  send('terminal:status', {
    status: 'ready',
    agent: currentAgent,
    cwd: currentCwd
  });

  if (currentAgent === 'codex') {
    setTimeout(() => terminal && terminal.write('codex\r'), 450);
  } else if (currentAgent === 'claude') {
    setTimeout(() => terminal && terminal.write('claude\r'), 450);
  } else if (currentAgent === 'cmd') {
    setTimeout(() => terminal && terminal.write('cmd\r'), 250);
  }

  return { agent: currentAgent, cwd: currentCwd };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#0b0d12',
    title: 'TermBridge',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  mainWindow.on('closed', () => {
    stopTerminal();
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  ipcMain.handle('app:state', () => ({
    cwd: currentCwd,
    agent: currentAgent,
    platform: process.platform,
    version: app.getVersion()
  }));

  ipcMain.handle('folder:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose project folder',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    currentCwd = result.filePaths[0];
    startTerminal(currentAgent, currentCwd);
    return currentCwd;
  });

  ipcMain.handle('agent:start', (_event, agent) => startTerminal(agent, currentCwd));

  ipcMain.handle('terminal:write', (_event, text) => {
    if (!terminal) startTerminal(currentAgent, currentCwd);
    terminal.write(String(text || ''));
    return true;
  });

  ipcMain.handle('terminal:resize', (_event, size) => {
    if (terminal && size && Number(size.cols) > 10 && Number(size.rows) > 5) {
      try { terminal.resize(Number(size.cols), Number(size.rows)); } catch {}
    }
    return true;
  });

  ipcMain.handle('terminal:restart', () => startTerminal(currentAgent, currentCwd));

  createWindow();
  startTerminal('powershell', currentCwd);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', stopTerminal);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
