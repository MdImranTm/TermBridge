const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const pty = require('node-pty');

let mainWindow = null;
let terminal = null;
let currentCwd = os.homedir();
let currentAgent = 'powershell';
let terminalLaunch = null;

const TOOLS = {
  powershell: { label: 'PowerShell', command: 'powershell.exe', kind: 'shell' },
  cmd: { label: 'CMD', command: 'cmd.exe', kind: 'shell' },
  codex: {
    label: 'Codex',
    command: 'codex',
    kind: 'ai',
    install: 'npm install -g @openai/codex',
    docs: 'https://developers.openai.com/codex/cli',
    models: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
    agents: ['Default']
  },
  claude: {
    label: 'Claude Code',
    command: 'claude',
    kind: 'ai',
    install: 'npm install -g @anthropic-ai/claude-code',
    docs: 'https://docs.anthropic.com/en/docs/claude-code',
    models: ['Default', 'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5'],
    agents: ['Default']
  },
  opencode: {
    label: 'OpenCode',
    command: 'opencode',
    kind: 'ai',
    install: 'npm install -g @opencode/cli',
    docs: 'https://opencode.ai/v2/docs',
    models: [],
    agents: ['Default', 'build', 'plan']
  }
};

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function execCapture(file, args = [], opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, {
      windowsHide: true,
      cwd: opts.cwd || currentCwd,
      timeout: opts.timeout || 8000,
      maxBuffer: 1024 * 1024 * 4
    }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || ''), stderr: String(stderr || ''), code: error?.code ?? 0 });
    });
  });
}

async function commandExists(command) {
  const where = await execCapture('where.exe', [command], { cwd: os.homedir(), timeout: 4000 });
  return where.ok && where.stdout.trim().length > 0;
}

async function detectTools() {
  const out = {};
  for (const [id, tool] of Object.entries(TOOLS)) {
    const installed = tool.kind === 'shell' ? true : await commandExists(tool.command);
    let version = '';
    if (installed && tool.kind === 'ai') {
      const v = await execCapture(tool.command, ['--version'], { timeout: 5000 });
      version = (v.stdout || v.stderr).trim().split(/\r?\n/)[0] || 'Installed';
    }
    out[id] = { id, ...tool, installed, version };
  }
  return out;
}

async function discoverCapabilities(agent) {
  const tool = TOOLS[agent];
  if (!tool) return { models: [], agents: [] };
  if (tool.kind === 'ai' && !(await commandExists(tool.command))) {
    return { models: tool.models || [], agents: tool.agents || [] };
  }
  if (agent === 'opencode') {
    const [models, agents] = await Promise.all([
      execCapture('opencode', ['models'], { timeout: 12000 }),
      execCapture('opencode', ['agent', 'list'], { timeout: 8000 })
    ]);
    const modelList = models.ok
      ? models.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean).filter(s => /[a-z0-9][/:_-][a-z0-9]/i.test(s)).slice(0, 150)
      : [];
    const agentList = agents.ok
      ? agents.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean).filter(s => /^[\w.-]+/.test(s)).slice(0, 50)
      : [];
    return {
      models: modelList.length ? modelList : (tool.models || []),
      agents: agentList.length ? agentList : (tool.agents || [])
    };
  }
  return { models: tool.models || [], agents: tool.agents || [] };
}

function safeProjectEntries(root, dir = root, depth = 0, acc = []) {
  if (depth > 4 || acc.length > 1200) return acc;
  let items = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  const ignored = new Set(['node_modules','.git','.next','dist','build','release','.idea','.cache','coverage']);
  for (const item of items) {
    if (acc.length > 1200) break;
    if (ignored.has(item.name)) continue;
    const full = path.join(dir, item.name);
    const rel = path.relative(root, full);
    acc.push({ name: item.name, rel, type: item.isDirectory() ? 'folder' : 'file', depth });
    if (item.isDirectory()) safeProjectEntries(root, full, depth + 1, acc);
  }
  return acc;
}

function projectInfo(folder = currentCwd) {
  const info = { path: folder, name: path.basename(folder) || folder, entries: [], markers: [], package: null };
  info.entries = safeProjectEntries(folder);
  const markers = ['package.json','pubspec.yaml','requirements.txt','pyproject.toml','Cargo.toml','go.mod','composer.json','README.md'];
  info.markers = markers.filter(name => fs.existsSync(path.join(folder, name)));
  const packagePath = path.join(folder, 'package.json');
  if (fs.existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      info.package = { name: pkg.name || '', version: pkg.version || '', scripts: pkg.scripts || {} };
    } catch {}
  }
  return info;
}

function stopTerminal() {
  if (!terminal) return;
  try { terminal.kill(); } catch {}
  terminal = null;
}

function buildLaunch(agent, options = {}) {
  const model = options.model && options.model !== 'Default' ? String(options.model) : '';
  const subagent = options.subagent && options.subagent !== 'Default' ? String(options.subagent) : '';
  if (agent === 'codex') {
    const args = [];
    if (model) args.push('--model', model);
    if (options.effort && options.effort !== 'default') args.push('-c', 'model_reasoning_effort="' + options.effort + '"');
    return { shell: 'codex', args, title: 'Codex' };
  }
  if (agent === 'claude') {
    const args = [];
    if (model) args.push('--model', model);
    return { shell: 'claude', args, title: 'Claude Code' };
  }
  if (agent === 'opencode') {
    const args = [];
    if (model) args.push('--model', model);
    if (subagent) args.push('--agent', subagent);
    return { shell: 'opencode', args, title: 'OpenCode' };
  }
  if (agent === 'cmd') return { shell: 'cmd.exe', args: [], title: 'CMD' };
  return { shell: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NoExit'], title: 'PowerShell' };
}

async function startTerminal(agent = currentAgent, cwd = currentCwd, options = {}) {
  stopTerminal();
  currentAgent = agent || 'powershell';
  currentCwd = cwd || os.homedir();

  const tool = TOOLS[currentAgent] || TOOLS.powershell;
  if (tool.kind === 'ai' && !(await commandExists(tool.command))) {
    send('terminal:status', { status: 'not-installed', agent: currentAgent, cwd: currentCwd });
    return { ok: false, reason: 'not-installed', agent: currentAgent, cwd: currentCwd };
  }

  const launch = buildLaunch(currentAgent, options);
  terminalLaunch = { ...launch, options };

  try {
    terminal = pty.spawn(launch.shell, launch.args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 34,
      cwd: currentCwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
    });
  } catch (error) {
    send('terminal:status', { status: 'error', error: error.message, agent: currentAgent, cwd: currentCwd });
    return { ok: false, reason: error.message };
  }

  terminal.onData(raw => send('terminal:data', { raw, agent: currentAgent }));
  terminal.onExit(({ exitCode, signal }) => {
    send('terminal:exit', { exitCode, signal, agent: currentAgent });
    terminal = null;
  });

  send('terminal:status', { status: 'ready', agent: currentAgent, cwd: currentCwd, launch });
  return { ok: true, agent: currentAgent, cwd: currentCwd, launch };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0b1020',
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
  ipcMain.handle('app:state', async () => ({
    cwd: currentCwd,
    agent: currentAgent,
    platform: process.platform,
    version: app.getVersion(),
    tools: await detectTools(),
    project: projectInfo(currentCwd)
  }));

  ipcMain.handle('tools:detect', () => detectTools());
  ipcMain.handle('tools:capabilities', (_event, agent) => discoverCapabilities(agent));

  ipcMain.handle('tools:install', async (_event, agent) => {
    const tool = TOOLS[agent];
    if (!tool?.install) return { ok: false, reason: 'No automatic installer for this tool.' };
    if (!(await commandExists('npm'))) {
      return { ok: false, reason: 'Node.js/npm is required first. Install Node.js LTS, then retry.' };
    }

    stopTerminal();
    terminal = pty.spawn('powershell.exe', ['-NoLogo','-NoProfile','-Command', tool.install], {
      name: 'xterm-256color',
      cols: 120,
      rows: 34,
      cwd: currentCwd,
      env: { ...process.env, TERM: 'xterm-256color' }
    });
    terminal.onData(raw => send('terminal:data', { raw, agent: 'setup' }));
    terminal.onExit(async ({ exitCode }) => {
      send('setup:complete', { agent, exitCode, tools: await detectTools() });
      terminal = null;
    });
    return { ok: true };
  });

  ipcMain.handle('tools:configure', (_event, agent) => startTerminal(agent, currentCwd, {}));

  ipcMain.handle('folder:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open project folder',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    currentCwd = result.filePaths[0];
    stopTerminal();
    const project = projectInfo(currentCwd);
    send('project:changed', project);
    return project;
  });

  ipcMain.handle('project:refresh', () => projectInfo(currentCwd));

  ipcMain.handle('agent:start', (_event, payload) => {
    if (typeof payload === 'string') return startTerminal(payload, currentCwd, {});
    return startTerminal(payload?.agent || currentAgent, currentCwd, payload?.options || {});
  });

  ipcMain.handle('terminal:write', async (_event, text) => {
    if (!terminal) {
      const started = await startTerminal(currentAgent, currentCwd, terminalLaunch?.options || {});
      if (!started.ok) return false;
    }
    terminal.write(String(text || ''));
    return true;
  });

  ipcMain.handle('terminal:resize', (_event, size) => {
    if (terminal && Number(size?.cols) > 10 && Number(size?.rows) > 5) {
      try { terminal.resize(Number(size.cols), Number(size.rows)); } catch {}
    }
    return true;
  });

  ipcMain.handle('terminal:restart', () => startTerminal(currentAgent, currentCwd, terminalLaunch?.options || {}));
  ipcMain.handle('external:open', (_event, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  createWindow();
  startTerminal('powershell', currentCwd, {});
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', stopTerminal);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
