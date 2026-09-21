const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const crossSpawn = require('cross-spawn');
const pty = require('node-pty');
const net = require('net');

let mainWindow = null;
let terminal = null;
let chatProcess = null;
let providerController = null;
let projectRoot = null;
let currentCwd = os.homedir();
let currentAgent = 'powershell';
let terminalLaunch = null;
let opencodeService = null;
let opencodeController = null;
let opencodeActiveSessionId = '';
let opencodeSyncTimer = null;
let opencodeLastSyncKey = '';

const TOOLS = {
  powershell: { label: 'PowerShell', command: 'powershell.exe', kind: 'shell' },
  cmd: { label: 'CMD', command: 'cmd.exe', kind: 'shell' },
  codex: {
    label: 'Codex',
    command: 'codex',
    kind: 'ai',
    install: 'npm install -g @openai/codex',
    docs: 'https://developers.openai.com/codex/cli',
    models: ['Default'],
    agents: ['Default']
  },
  claude: {
    label: 'Claude Code',
    command: 'claude',
    kind: 'ai',
    install: 'npm install -g @anthropic-ai/claude-code',
    docs: 'https://docs.anthropic.com/en/docs/claude-code',
    models: ['Default'],
    agents: ['Default']
  },
  opencode: {
    label: 'OpenCode',
    command: 'opencode',
    kind: 'ai',
    install: 'npm install -g @opencode/cli',
    docs: 'https://opencode.ai/v2/docs',
    models: ['Default'],
    agents: ['Default', 'build', 'plan']
  }
};

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function execCapture(file, args = [], opts = {}) {
  return new Promise((resolve) => {
    const proc = crossSpawn(file, args, {
      cwd: opts.cwd || currentCwd || os.homedir(),
      windowsHide: true,
      shell: false,
      env: { ...process.env, ...(opts.env || {}) }
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const maxBuffer = opts.maxBuffer || 4 * 1024 * 1024;
    const append = (current, chunk) => {
      const next = current + String(chunk || '');
      return next.length > maxBuffer ? next.slice(-maxBuffer) : next;
    };

    proc.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk); });
    proc.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk); });

    proc.on('error', (error) => {
      finish({ ok: false, stdout, stderr: stderr || error.message, code: error.code || 1 });
    });

    proc.on('close', (code) => {
      finish({ ok: code === 0, stdout, stderr, code: code ?? 0 });
    });

    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      finish({ ok: false, stdout, stderr: stderr || 'Command timed out.', code: 'ETIMEDOUT' });
    }, opts.timeout || 8000);
  });
}

async function commandExists(command) {
  const result = await execCapture('where.exe', [command], {
    cwd: os.homedir(),
    timeout: 5000
  });
  return result.ok && result.stdout.trim().length > 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function stopOpenCodeSync() {
  if (opencodeSyncTimer) clearInterval(opencodeSyncTimer);
  opencodeSyncTimer = null;
  opencodeLastSyncKey = '';
}

function stopOpenCodeService() {
  stopOpenCodeSync();
  if (opencodeService?.process) {
    try { opencodeService.process.kill(); } catch {}
  }
  opencodeService = null;
  opencodeActiveSessionId = '';
}

async function openCodeHealth(url) {
  try {
    const response = await fetch(url + '/global/health');
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureOpenCodeService(cwd) {
  const targetCwd = cwd || projectRoot || currentCwd || os.homedir();

  if (
    opencodeService?.url &&
    opencodeService.cwd === targetCwd &&
    await openCodeHealth(opencodeService.url)
  ) {
    return opencodeService;
  }

  stopOpenCodeService();

  const port = await getFreePort();
  const url = 'http://127.0.0.1:' + port;
  const proc = crossSpawn(
    'opencode',
    ['serve', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      cwd: targetCwd,
      windowsHide: true,
      shell: false,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
    }
  );

  opencodeService = { process: proc, url, port, cwd: targetCwd };

  proc.stderr?.on('data', (chunk) => {
    const text = String(chunk || '');
    if (/error|failed|fatal/i.test(text)) {
      send('terminal:data', {
        raw: '\r\n[OpenCode service] ' + text,
        agent: 'opencode',
        source: 'service',
        isError: true
      });
    }
  });

  proc.on('exit', () => {
    if (opencodeService?.process === proc) {
      opencodeService = null;
      opencodeActiveSessionId = '';
      stopOpenCodeSync();
    }
  });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await openCodeHealth(url)) return opencodeService;
    await sleep(250);
  }

  try { proc.kill(); } catch {}
  opencodeService = null;
  throw new Error('OpenCode local service did not become ready.');
}

async function ensureOpenCodeSession(cwd, requestedSessionId = '') {
  const service = await ensureOpenCodeService(cwd);
  const wanted = String(requestedSessionId || '').trim();

  if (wanted) {
    try {
      const session = await fetchJson(
        service.url + '/session/' + encodeURIComponent(wanted),
        { method: 'GET' },
        8000
      );
      if (session?.id) {
        opencodeActiveSessionId = session.id;
        return { service, sessionId: session.id };
      }
    } catch {}
  }

  const created = await fetchJson(
    service.url + '/session',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'TermBridge' })
    },
    10000
  );

  const sessionId = String(created?.id || created?.sessionID || '').trim();
  if (!sessionId) throw new Error('OpenCode did not return a session ID.');

  opencodeActiveSessionId = sessionId;
  return { service, sessionId };
}

function openCodeModelObject(model) {
  const value = String(model || '').trim();
  if (!value || value === 'Default' || !value.includes('/')) return undefined;
  const slash = value.indexOf('/');
  return {
    providerID: value.slice(0, slash),
    modelID: value.slice(slash + 1)
  };
}

function extractOpenCodeMessageText(message) {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  return parts
    .filter((part) => part?.type === 'text' && !part?.synthetic)
    .map((part) => String(part.text || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

function syncOpenCodeMessageState(sessionId, message) {
  const info = message?.info || {};
  const providerID = String(info.providerID || info.provider?.id || '').trim();
  const modelID = String(info.modelID || info.model?.id || '').trim();
  const model = providerID && modelID ? providerID + '/' + modelID : '';
  const subagent = String(info.agent || info.agentName || '').trim();
  const key = [sessionId, model, subagent].join('|');

  if (key && key !== opencodeLastSyncKey) {
    opencodeLastSyncKey = key;
    send('engine:sync', {
      agent: 'opencode',
      sessionId,
      model,
      subagent
    });
  }
}

async function pollOpenCodeSession(sessionId) {
  if (!opencodeService?.url || !sessionId) return;
  try {
    const messages = await fetchJson(
      opencodeService.url + '/session/' + encodeURIComponent(sessionId) + '/message?limit=6',
      { method: 'GET' },
      5000
    );
    if (!Array.isArray(messages) || !messages.length) return;
    const latest = [...messages].reverse().find((item) => item?.info);
    if (latest) syncOpenCodeMessageState(sessionId, latest);
  } catch {}
}

function startOpenCodeSync(sessionId) {
  stopOpenCodeSync();
  if (!sessionId) return;
  pollOpenCodeSession(sessionId);
  opencodeSyncTimer = setInterval(() => pollOpenCodeSession(sessionId), 1800);
}

async function runOpenCodeSharedPrompt(prompt, options = {}) {
  const cwd = currentCwd || projectRoot || os.homedir();
  let shared;

  try {
    shared = await ensureOpenCodeSession(cwd, options.engineSessionId || opencodeActiveSessionId);
  } catch (error) {
    send('chat:complete', {
      ok: false,
      agent: 'opencode',
      error: error.message,
      text: ''
    });
    return;
  }

  const { service, sessionId } = shared;
  opencodeActiveSessionId = sessionId;
  startOpenCodeSync(sessionId);

  send('chat:session', { agent: 'opencode', sessionId });
  send('chat:status', {
    status: 'running',
    agent: 'opencode',
    destination: 'OpenCode',
    cwd,
    sessionId
  });

  send('terminal:data', {
    raw: '\r\n[TermBridge] Sending prompt to the shared OpenCode session…\r\n',
    agent: 'opencode',
    source: 'chat-runner'
  });

  const body = {
    parts: [{ type: 'text', text: String(prompt || '') }]
  };

  const model = openCodeModelObject(options.model);
  if (model) body.model = model;
  if (options.subagent && options.subagent !== 'Default') {
    body.agent = String(options.subagent);
  }

  opencodeController = new AbortController();

  try {
    const response = await fetchJson(
      service.url + '/session/' + encodeURIComponent(sessionId) + '/message',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: opencodeController.signal
      },
      15 * 60 * 1000
    );

    const text = extractOpenCodeMessageText(response).trim();
    syncOpenCodeMessageState(sessionId, response);

    send('chat:complete', {
      ok: Boolean(text),
      agent: 'opencode',
      code: 0,
      sessionId,
      error: text ? '' : 'OpenCode completed but returned no visible text.',
      text
    });

    send('terminal:data', {
      raw: '[TermBridge] OpenCode reply received in the shared session.\r\n',
      agent: 'opencode',
      source: 'chat-runner'
    });
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    send('chat:complete', {
      ok: false,
      agent: 'opencode',
      sessionId,
      error: aborted ? 'OpenCode request stopped.' : error.message,
      text: ''
    });
  } finally {
    opencodeController = null;
  }
}

function parseHelpCapabilities(text) {
  const commands = [];
  const options = [];
  const lines = String(text || '').split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const optionMatch = line.match(/^(-{1,2}[\w-]+(?:,\s*-{1,2}[\w-]+)?)(?:\s+[<\[].*?[>\]])?\s{2,}(.+)$/);
    if (optionMatch) {
      options.push({ name: optionMatch[1], description: optionMatch[2].trim() });
      continue;
    }

    const commandMatch = line.match(/^([a-z][\w:-]{1,30})\s{2,}(.+)$/i);
    if (commandMatch && !commandMatch[1].startsWith('-')) {
      commands.push({ name: commandMatch[1], description: commandMatch[2].trim() });
    }
  }

  const unique = (arr) => {
    const seen = new Set();
    return arr.filter((item) => {
      const key = item.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  return {
    commands: unique(commands).slice(0, 80),
    options: unique(options).slice(0, 100)
  };
}

async function detectTools() {
  const result = {};
  for (const [id, tool] of Object.entries(TOOLS)) {
    const installed = tool.kind === 'shell' ? true : await commandExists(tool.command);
    let version = '';
    if (installed && tool.kind === 'ai') {
      const v = await execCapture(tool.command, ['--version'], { timeout: 6000 });
      version = (v.stdout || v.stderr).trim().split(/\r?\n/)[0] || 'Installed';
    }
    result[id] = { id, ...tool, installed, version };
  }
  return result;
}

async function discoverCapabilities(agent) {
  const tool = TOOLS[agent];
  if (!tool) return { models: [], agents: [], commands: [], options: [], meta: {} };

  if (tool.kind === 'ai' && !(await commandExists(tool.command))) {
    return {
      models: tool.models || ['Default'],
      agents: tool.agents || ['Default'],
      commands: [],
      options: [],
      meta: { installed: false }
    };
  }

  const rootHelp = await execCapture(tool.command, ['--help'], { timeout: 10000 });
  const rootParsed = parseHelpCapabilities(rootHelp.stdout || rootHelp.stderr);
  const commands = [...rootParsed.commands];
  const options = [...rootParsed.options];

  // Probe discovered subcommands so the UI follows the installed CLI version
  // instead of relying on a fixed hard-coded settings list.
  const rootNames = rootParsed.commands
    .map((item) => item.name)
    .filter((name) => /^[a-z][\w:-]*$/i.test(name))
    .slice(0, 24);

  const nestedResults = await Promise.all(
    rootNames.map(async (name) => {
      const help = await execCapture(tool.command, [name, '--help'], { timeout: 7000 });
      return { name, parsed: parseHelpCapabilities(help.stdout || help.stderr) };
    })
  );

  for (const entry of nestedResults) {
    for (const sub of entry.parsed.commands || []) {
      commands.push({
        name: entry.name + ' ' + sub.name,
        description: sub.description || ('Subcommand of ' + entry.name)
      });
    }
    for (const option of entry.parsed.options || []) {
      options.push({
        name: entry.name + ' ' + option.name,
        description: option.description || ''
      });
    }
  }

  const unique = (items) => {
    const seen = new Set();
    return items.filter((item) => {
      const key = item.name;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  let models = tool.models || ['Default'];
  let agents = tool.agents || ['Default'];
  const meta = { installed: true };

  if (agent === 'opencode') {
    const [modelsResult, agentsResult, authResult] = await Promise.all([
      execCapture('opencode', ['models'], { timeout: 20000 }),
      execCapture('opencode', ['agent', 'list'], { timeout: 12000 }),
      execCapture('opencode', ['auth', 'list', '--format', 'json'], { timeout: 10000 })
    ]);

    const detectedModels = modelsResult.ok
      ? modelsResult.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => /^[^\s]+\/[^\s]+$/.test(line))
          .slice(0, 300)
      : [];

    let detectedAgents = agentsResult.ok
      ? agentsResult.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.split(/\s{2,}|\t/)[0].trim())
          .filter((line) => /^[\w.-][\w. -]{0,79}$/.test(line))
          .slice(0, 100)
      : [];

    const liveCommands = [];
    if (opencodeService?.url && await openCodeHealth(opencodeService.url)) {
      try {
        const [serverAgents, serverCommands] = await Promise.all([
          fetchJson(opencodeService.url + '/agent', { method: 'GET' }, 7000),
          fetchJson(opencodeService.url + '/command', { method: 'GET' }, 7000)
        ]);

        if (Array.isArray(serverAgents)) {
          const names = serverAgents
            .map((item) => String(item?.name || item?.id || '').trim())
            .filter(Boolean);
          if (names.length) detectedAgents = names;
        }

        if (Array.isArray(serverCommands)) {
          for (const item of serverCommands) {
            const rawName = String(item?.name || item?.command || '').trim();
            if (!rawName) continue;
            liveCommands.push({
              name: rawName.startsWith('/') ? rawName : '/' + rawName,
              description: String(item?.description || item?.title || 'OpenCode command')
            });
          }
        }
      } catch {}
    }

    models = ['Default', ...detectedModels.filter((x) => x !== 'Default')];
    agents = ['Default', ...detectedAgents.filter((x) => x !== 'Default')];
    commands.push(...liveCommands);

    if (authResult.ok) {
      try {
        const parsedAuth = JSON.parse(authResult.stdout || '[]');
        meta.authenticatedProviders = Array.isArray(parsedAuth) ? parsedAuth.length : undefined;
      } catch {}
    }

    meta.sharedSession = Boolean(opencodeService?.url);
    meta.sessionId = opencodeActiveSessionId || '';
  }

  if (agent === 'codex') {
    const features = await execCapture('codex', ['features', 'list'], { timeout: 10000 });
    if (features.ok) meta.features = features.stdout.trim().split(/\r?\n/).filter(Boolean).slice(0, 100);
  }

  return {
    models: [...new Set(models)],
    agents: [...new Set(agents)],
    commands: unique(commands).slice(0, 180),
    options: unique(options).slice(0, 260),
    meta
  };
}

function safeProjectEntries(root, dir = root, depth = 0, acc = []) {
  if (depth > 6 || acc.length >= 1200) return acc;

  let items = [];
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }

  const ignored = new Set([
    'node_modules', '.git', '.next', 'dist', 'build', 'release', 'out', 'target',
    'coverage', '.idea', '.cache', '.gradle', '.dart_tool', '.flutter-plugins',
    '.pytest_cache', '__pycache__', '.venv', 'venv', 'Pods', '.turbo',
    '.parcel-cache', '.nuxt', '.output', '.expo', '.angular', '.serverless',
    '.terraform'
  ]);

  items = items
    .filter((item) => !ignored.has(item.name) && item.name !== 'Thumbs.db' && item.name !== '.DS_Store')
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

  for (const item of items) {
    if (acc.length >= 1200) break;
    if (item.isSymbolicLink()) continue;

    const full = path.join(dir, item.name);
    const rel = path.relative(root, full);
    acc.push({
      name: item.name,
      rel,
      type: item.isDirectory() ? 'folder' : 'file',
      depth
    });

    if (item.isDirectory()) safeProjectEntries(root, full, depth + 1, acc);
  }

  return acc;
}

function projectInfo(folder = projectRoot) {
  if (!folder || !fs.existsSync(folder)) return null;

  const info = {
    path: folder,
    name: path.basename(folder) || folder,
    entries: safeProjectEntries(folder),
    markers: [],
    package: null
  };

  const markers = [
    'package.json', 'pubspec.yaml', 'requirements.txt', 'pyproject.toml',
    'Cargo.toml', 'go.mod', 'composer.json', 'README.md', 'vite.config.ts',
    'vite.config.js', 'next.config.js', 'next.config.mjs'
  ];
  info.markers = markers.filter((name) => fs.existsSync(path.join(folder, name)));

  const packagePath = path.join(folder, 'package.json');
  if (fs.existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      info.package = {
        name: pkg.name || '',
        version: pkg.version || '',
        scripts: pkg.scripts || {}
      };
    } catch {}
  }

  return info;
}

function statePath(name) {
  return path.join(app.getPath('userData'), name);
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function loadWorkspaceState() {
  const saved = loadJson(statePath('workspace-state.json'), {});
  if (
    saved?.projectRoot &&
    fs.existsSync(saved.projectRoot) &&
    fs.statSync(saved.projectRoot).isDirectory()
  ) {
    projectRoot = saved.projectRoot;
    currentCwd = projectRoot;
  }
}

function saveWorkspaceState() {
  writeJson(statePath('workspace-state.json'), { projectRoot });
}

function providerFile() {
  return statePath('providers.json');
}

function providerId() {
  return 'provider_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function normalizeProvider(input = {}) {
  return {
    id: String(input.id || providerId()),
    name: String(input.name || 'Custom Provider').trim(),
    type: ['openai', 'anthropic', 'custom'].includes(input.type) ? input.type : 'openai',
    baseURL: String(input.baseURL || '').trim().replace(/\/+$/, ''),
    modelsPath: String(input.modelsPath || '/models').trim(),
    chatPath: String(input.chatPath || (input.type === 'anthropic' ? '/messages' : '/chat/completions')).trim(),
    secretSource: ['vault', 'env', 'none'].includes(input.secretSource) ? input.secretSource : 'vault',
    secretRef: String(input.secretRef || '').trim(),
    encryptedSecret: String(input.encryptedSecret || ''),
    defaultModel: String(input.defaultModel || '').trim(),
    headers: input.headers && typeof input.headers === 'object' ? input.headers : {},
    bodyTemplate: input.bodyTemplate && typeof input.bodyTemplate === 'object' ? input.bodyTemplate : {},
    responsePath: String(input.responsePath || '').trim(),
    createdAt: Number(input.createdAt || Date.now()),
    updatedAt: Date.now()
  };
}

function loadProvidersRaw() {
  const list = loadJson(providerFile(), []);
  return Array.isArray(list) ? list.map(normalizeProvider) : [];
}

function publicProvider(provider) {
  const { encryptedSecret, ...safe } = provider;
  return {
    ...safe,
    hasSecret: Boolean(encryptedSecret || (safe.secretSource === 'env' && safe.secretRef))
  };
}

function listProviders() {
  return loadProvidersRaw().map(publicProvider);
}

function getProvider(id) {
  return loadProvidersRaw().find((item) => item.id === id) || null;
}

function encryptSecret(value) {
  if (!value) return '';
  if (!safeStorage.isEncryptionAvailable()) return '';
  return safeStorage.encryptString(String(value)).toString('base64');
}

function decryptSecret(value) {
  if (!value || !safeStorage.isEncryptionAvailable()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  } catch {
    return '';
  }
}

function providerSecret(provider) {
  if (!provider) return '';
  if (provider.secretSource === 'env') {
    return provider.secretRef ? String(process.env[provider.secretRef] || '') : '';
  }
  if (provider.secretSource === 'vault') {
    return decryptSecret(provider.encryptedSecret);
  }
  return '';
}

function saveProvider(input = {}) {
  const providers = loadProvidersRaw();
  const existingIndex = providers.findIndex((item) => item.id === input.id);
  const previous = existingIndex >= 0 ? providers[existingIndex] : {};

  const provider = normalizeProvider({
    ...previous,
    ...input,
    createdAt: previous.createdAt || Date.now()
  });

  if (input.apiKey) {
    provider.encryptedSecret = encryptSecret(input.apiKey);
  } else if (previous.encryptedSecret) {
    provider.encryptedSecret = previous.encryptedSecret;
  }

  if (provider.secretSource !== 'vault') {
    provider.encryptedSecret = '';
  }

  if (existingIndex >= 0) providers[existingIndex] = provider;
  else providers.push(provider);

  writeJson(providerFile(), providers);
  return publicProvider(provider);
}

function deleteProvider(id) {
  const next = loadProvidersRaw().filter((item) => item.id !== id);
  writeJson(providerFile(), next);
  return true;
}

function joinUrl(base, endpoint) {
  if (!base) return endpoint;
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return base.replace(/\/+$/, '') + '/' + String(endpoint || '').replace(/^\/+/, '');
}

function providerHeaders(provider, secret) {
  const headers = {
    'Content-Type': 'application/json',
    ...(provider.headers || {})
  };

  if (secret) {
    if (provider.type === 'anthropic') {
      if (!headers['x-api-key'] && !headers['X-Api-Key']) headers['x-api-key'] = secret;
      if (!headers['anthropic-version']) headers['anthropic-version'] = '2023-06-01';
    } else if (!headers.Authorization && !headers.authorization) {
      headers.Authorization = 'Bearer ' + secret;
    }
  }

  return headers;
}

async function fetchJson(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const requestOptions = { ...options };
    delete requestOptions.signal;
    const response = await fetch(url, { ...requestOptions, signal: externalSignal || controller.signal });
    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = raw;
    }
    if (!response.ok) {
      const message =
        typeof data === 'string'
          ? data.slice(0, 600)
          : data?.error?.message || data?.message || response.statusText;
      throw new Error(response.status + ' ' + message);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function valueAtPath(value, dottedPath) {
  if (!dottedPath) return undefined;
  return String(dottedPath)
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => {
      if (current == null) return undefined;
      const numeric = /^\d+$/.test(key) ? Number(key) : key;
      return current[numeric];
    }, value);
}

function applyTemplate(value, context) {
  if (Array.isArray(value)) return value.map((item) => applyTemplate(item, context));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = applyTemplate(item, context);
    return out;
  }
  if (typeof value !== 'string') return value;

  if (value === '{{model}}') return context.model;
  if (value === '{{messages}}') return context.messages;
  if (value === '{{prompt}}') return context.prompt;

  return value
    .replaceAll('{{model}}', String(context.model || ''))
    .replaceAll('{{prompt}}', String(context.prompt || ''));
}

function extractProviderText(data) {
  if (data == null) return '';
  if (typeof data === 'string') return data;

  const openAI = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text;
  if (typeof openAI === 'string') return openAI;
  if (Array.isArray(openAI)) {
    const text = openAI
      .map((item) => (typeof item === 'string' ? item : item?.text || item?.content || ''))
      .filter(Boolean)
      .join('\n');
    if (text) return text;
  }

  if (Array.isArray(data?.content)) {
    const text = data.content
      .map((item) => (typeof item === 'string' ? item : item?.text || ''))
      .filter(Boolean)
      .join('\n');
    if (text) return text;
  }

  for (const key of ['output_text', 'text', 'message', 'content', 'response', 'result']) {
    const value = data?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') {
      const nested = extractProviderText(value);
      if (nested) return nested;
    }
  }

  return JSON.stringify(data, null, 2);
}

async function providerModels(id) {
  const provider = getProvider(id);
  if (!provider) throw new Error('Provider not found.');
  if (!provider.baseURL) throw new Error('Base URL is required.');

  const secret = providerSecret(provider);
  if (provider.secretSource !== 'none' && !secret) {
    throw new Error(
      provider.secretSource === 'env'
        ? 'Environment variable "' + provider.secretRef + '" is not set.'
        : 'No saved API key is available for this provider.'
    );
  }

  const endpoint = joinUrl(provider.baseURL, provider.modelsPath || '/models');
  const data = await fetchJson(endpoint, {
    method: 'GET',
    headers: providerHeaders(provider, secret)
  });

  const raw =
    Array.isArray(data) ? data :
    Array.isArray(data?.data) ? data.data :
    Array.isArray(data?.models) ? data.models :
    [];

  return raw
    .map((item) => {
      if (typeof item === 'string') return item;
      return item?.id || item?.name || item?.model || '';
    })
    .filter(Boolean)
    .slice(0, 300);
}

async function providerTest(id) {
  const provider = getProvider(id);
  if (!provider) return { ok: false, error: 'Provider not found.' };

  try {
    const models = await providerModels(id);
    return { ok: true, models, message: models.length ? 'Connection successful.' : 'Connected. No models were returned.' };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function runProviderChat(payload = {}) {
  const provider = getProvider(payload.providerId);
  if (!provider) return { ok: false, reason: 'provider-not-found' };

  send('chat:status', { status: 'running', agent: 'provider', providerId: provider.id });
  providerController = new AbortController();

  try {
    const secret = providerSecret(provider);
    if (provider.secretSource !== 'none' && !secret) {
      throw new Error(
        provider.secretSource === 'env'
          ? 'Environment variable "' + provider.secretRef + '" is not set.'
          : 'No API key is saved for this provider.'
      );
    }

    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const model = String(payload.model || provider.defaultModel || '').trim();

    let body;
    if (provider.type === 'anthropic') {
      const system = messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n');
      body = {
        model,
        max_tokens: Number(payload.maxTokens || 4096),
        messages: messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }))
      };
      if (system) body.system = system;
    } else if (provider.type === 'custom' && Object.keys(provider.bodyTemplate || {}).length) {
      const prompt = messages.filter((m) => m.role === 'user').slice(-1)[0]?.content || '';
      body = applyTemplate(provider.bodyTemplate, { model, messages, prompt });
    } else {
      body = { model, messages };
    }

    const url = joinUrl(provider.baseURL, provider.chatPath);
    const data = await fetchJson(
      url,
      {
        method: 'POST',
        headers: providerHeaders(provider, secret),
        body: JSON.stringify(body),
        signal: providerController.signal
      },
      120000
    );

    const configuredResponse = provider.responsePath ? valueAtPath(data, provider.responsePath) : undefined;
    const text = (
      configuredResponse !== undefined
        ? extractProviderText(configuredResponse)
        : extractProviderText(data)
    ).trim();
    send('terminal:data', {
      raw: '[provider] ' + provider.name + ' request completed.\r\n',
      agent: 'provider',
      source: 'provider'
    });
    send('chat:complete', {
      ok: true,
      agent: 'provider',
      providerId: provider.id,
      text: text || 'The provider returned an empty response.'
    });
    providerController = null;
    return { ok: true };
  } catch (error) {
    providerController = null;
    const aborted = error?.name === 'AbortError';
    send('chat:complete', {
      ok: false,
      agent: 'provider',
      providerId: provider.id,
      error: aborted ? 'Request stopped.' : error.message,
      text: ''
    });
    return { ok: false, reason: aborted ? 'Request stopped.' : error.message };
  }
}

function stopTerminal() {
  if (!terminal) return;
  try {
    terminal.kill();
  } catch {}
  terminal = null;
}

function psQuote(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function buildLaunch(agent, options = {}) {
  const model = options.model && options.model !== 'Default' ? String(options.model) : '';
  const subagent = options.subagent && options.subagent !== 'Default' ? String(options.subagent) : '';

  if (agent === 'cmd') return { shell: 'cmd.exe', args: [], title: 'CMD', initial: '' };
  if (agent === 'powershell') {
    return {
      shell: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NoExit'],
      title: 'PowerShell',
      initial: ''
    };
  }

  const cliArgs = [];
  if (agent === 'codex') {
    if (model) cliArgs.push('--model', model);
    if (options.effort && options.effort !== 'default') {
      cliArgs.push('-c', 'model_reasoning_effort="' + options.effort + '"');
    }
  } else if (agent === 'claude') {
    if (model) cliArgs.push('--model', model);
  } else if (agent === 'opencode') {
    if (options.opencodeAttachUrl && options.engineSessionId) {
      const attachArgs = [
        'attach',
        options.opencodeAttachUrl,
        '--dir',
        options.opencodeDir || currentCwd || os.homedir(),
        '--session',
        options.engineSessionId
      ];
      return {
        shell: 'powershell.exe',
        args: ['-NoLogo', '-NoProfile', '-NoExit'],
        title: TOOLS[agent]?.label || agent,
        initial: '& ' + ['opencode', ...attachArgs].map(psQuote).join(' ')
      };
    }
    if (model) cliArgs.push('--model', model);
    if (subagent) cliArgs.push('--agent', subagent);
  }

  const commandName =
    agent === 'codex' ? 'codex' :
    agent === 'claude' ? 'claude' :
    agent === 'opencode' ? 'opencode' :
    'powershell';

  return {
    shell: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-NoExit'],
    title: TOOLS[agent]?.label || agent,
    initial: '& ' + [commandName, ...cliArgs].map(psQuote).join(' ')
  };
}

async function startTerminal(agent = currentAgent, cwd = currentCwd, options = {}) {
  stopTerminal();

  const selectedAgent = agent || 'powershell';
  const selectedCwd = cwd || projectRoot || os.homedir();
  currentAgent = selectedAgent;
  currentCwd = selectedCwd;

  const tool = TOOLS[selectedAgent] || TOOLS.powershell;
  if (tool.kind === 'ai' && !(await commandExists(tool.command))) {
    send('terminal:status', {
      status: 'not-installed',
      agent: selectedAgent,
      cwd: selectedCwd
    });
    return { ok: false, reason: 'not-installed' };
  }

  let effectiveOptions = { ...options };

  if (selectedAgent === 'opencode') {
    try {
      const shared = await ensureOpenCodeSession(
        selectedCwd,
        options.engineSessionId || opencodeActiveSessionId
      );
      effectiveOptions = {
        ...options,
        engineSessionId: shared.sessionId,
        opencodeAttachUrl: shared.service.url,
        opencodeDir: selectedCwd
      };
      opencodeActiveSessionId = shared.sessionId;
      startOpenCodeSync(shared.sessionId);
      send('chat:session', { agent: 'opencode', sessionId: shared.sessionId });
    } catch (error) {
      send('terminal:status', {
        status: 'error',
        error: error.message,
        agent: selectedAgent,
        cwd: selectedCwd
      });
      return { ok: false, reason: error.message };
    }
  } else {
    stopOpenCodeSync();
  }

  const launch = buildLaunch(selectedAgent, effectiveOptions);
  terminalLaunch = { ...launch, options: effectiveOptions };

  send('terminal:status', {
    status: 'starting',
    agent: selectedAgent,
    cwd: selectedCwd,
    launch,
    sessionId: effectiveOptions.engineSessionId || ''
  });

  let instance;
  try {
    instance = pty.spawn(launch.shell, launch.args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 34,
      cwd: selectedCwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor'
      }
    });
    terminal = instance;
  } catch (error) {
    send('terminal:status', {
      status: 'error',
      error: error.message,
      agent: selectedAgent,
      cwd: selectedCwd
    });
    return { ok: false, reason: error.message };
  }

  let readySent = false;
  let initialSent = !launch.initial;

  const markReady = () => {
    if (readySent || terminal !== instance) return;
    readySent = true;
    send('terminal:status', {
      status: 'ready',
      agent: selectedAgent,
      cwd: selectedCwd,
      launch,
      sessionId: effectiveOptions.engineSessionId || ''
    });
  };

  instance.onData((raw) => {
    send('terminal:data', { raw, agent: selectedAgent, source: 'terminal' });

    // For AI CLIs, ignore the wrapper PowerShell prompt and only mark ready
    // after the actual CLI command has been sent.
    if (initialSent) markReady();
  });

  instance.onExit(({ exitCode, signal }) => {
    send('terminal:exit', { exitCode, signal, agent: selectedAgent });
    if (terminal === instance) terminal = null;
  });

  if (launch.initial) {
    setTimeout(() => {
      if (terminal === instance) {
        initialSent = true;
        instance.write(launch.initial + '\r');
      }
    }, 220);
  }

  // Some CLIs may wait silently for authentication/input.
  setTimeout(markReady, launch.initial ? 2200 : 700);

  return {
    ok: true,
    agent: selectedAgent,
    cwd: selectedCwd,
    launch,
    status: 'starting',
    sessionId: effectiveOptions.engineSessionId || ''
  };
}

function extractJsonText(obj) {
  const values = [];
  const walk = (value, key = '') => {
    if (value == null) return;
    if (typeof value === 'string') {
      if (
        ['text', 'message', 'content', 'output_text', 'final_output', 'assistant_message', 'result'].includes(key) &&
        value.trim()
      ) values.push(value.trim());
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, key));
      return;
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, k);
    }
  };
  walk(obj);
  return [...new Set(values)].join('\n');
}

function extractSessionId(value) {
  if (!value || typeof value !== 'object') return '';
  return String(
    value.thread_id ||
    value.sessionID ||
    value.session_id ||
    value.sessionId ||
    value?.part?.sessionID ||
    value?.info?.sessionID ||
    ''
  ).trim();
}

function extractOpenCodeExportText(data) {
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const assistants = messages.filter((message) => {
    const role = message?.info?.role || message?.role;
    return role === 'assistant';
  });

  for (let i = assistants.length - 1; i >= 0; i--) {
    const message = assistants[i];
    const parts = Array.isArray(message?.parts) ? message.parts : [];
    const texts = parts
      .filter((part) => part?.type === 'text' && !part?.synthetic)
      .map((part) => String(part.text || '').trim())
      .filter(Boolean);
    if (texts.length) return texts.join('\n\n');
  }
  return '';
}

function describeStructuredEvent(agent, event) {
  if (!event || typeof event !== 'object') return '';

  if (agent === 'codex') {
    if (event.type === 'thread.started') return '[Codex] session ' + (event.thread_id || '') + '\r\n';
    if (event.type === 'turn.started') return '[Codex] working…\r\n';
    if (event.type === 'turn.failed') return '[Codex] turn failed: ' + JSON.stringify(event.error || event) + '\r\n';

    const item = event.item;
    if (item?.type === 'command_execution') {
      return '[Codex] command: ' + (item.command || '') + (item.status ? ' [' + item.status + ']' : '') + '\r\n';
    }
    if (item?.type === 'file_change') {
      return '[Codex] file change: ' + JSON.stringify(item, null, 2) + '\r\n';
    }
    if (item?.type === 'mcp_tool_call') {
      return '[Codex] MCP: ' + JSON.stringify(item, null, 2) + '\r\n';
    }
    return '';
  }

  if (agent === 'opencode') {
    if (event.type === 'step_start') return '[OpenCode] step started\r\n';
    if (event.type === 'tool_use') {
      const part = event.part || {};
      const state = part.state || {};
      const input = state.input || {};
      const label = part.tool || input.description || input.command || 'tool';
      return '[OpenCode] tool: ' + label + '\r\n' +
        (input.command ? '  $ ' + input.command + '\r\n' : '') +
        (state.output ? String(state.output) + '\r\n' : '');
    }
    if (event.type === 'step_finish') {
      return '[OpenCode] step finished\r\n';
    }
    if (event.type === 'error') {
      return '[OpenCode] error: ' + JSON.stringify(event.error || event) + '\r\n';
    }
    return '';
  }

  return '';
}

function extractAssistantEventText(agent, event) {
  if (!event || typeof event !== 'object') return '';

  if (agent === 'codex') {
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
      return String(event.item.text || '').trim();
    }
    return '';
  }

  if (agent === 'opencode') {
    if (event.type === 'text' && event.part?.type === 'text' && !event.part?.synthetic) {
      return String(event.part.text || '').trim();
    }
    return '';
  }

  return '';
}

function buildChatCommand(agent, prompt, options = {}) {
  const model = options.model && options.model !== 'Default' ? String(options.model) : '';
  const subagent = options.subagent && options.subagent !== 'Default' ? String(options.subagent) : '';
  const sessionId = String(options.engineSessionId || '').trim();

  if (agent === 'codex') {
    const args = ['exec'];
    if (model) args.push('--model', model);
    if (options.effort && options.effort !== 'default') {
      args.push('-c', 'model_reasoning_effort="' + options.effort + '"');
    }
    args.push('--json');
    if (sessionId) args.push('resume', sessionId);
    args.push(prompt);
    return { command: 'codex', args, format: 'jsonl' };
  }

  if (agent === 'claude') {
    const args = ['-p', prompt, '--output-format', 'json'];
    if (sessionId) args.push('--resume', sessionId);
    if (model) args.push('--model', model);
    return { command: 'claude', args, format: 'json' };
  }

  if (agent === 'opencode') {
    const args = ['run', '--format', 'json'];
    if (sessionId) args.push('--session', sessionId);
    if (model) args.push('--model', model);
    if (subagent) args.push('--agent', subagent);
    args.push(prompt);
    return { command: 'opencode', args, format: 'jsonl' };
  }

  return null;
}

async function runChatPrompt(agent, prompt, options = {}) {
  if (agent === 'opencode') {
    if (!(await commandExists('opencode'))) return { ok: false, reason: 'not-installed' };
    runOpenCodeSharedPrompt(prompt, options);
    return { ok: true, accepted: true, agent: 'opencode', destination: 'OpenCode' };
  }

  const spec = buildChatCommand(agent, prompt, options);
  if (!spec) return { ok: false, reason: 'not-ai' };
  if (!(await commandExists(spec.command))) return { ok: false, reason: 'not-installed' };

  if (chatProcess) {
    try { chatProcess.kill(); } catch {}
    chatProcess = null;
  }

  send('chat:status', {
    status: 'running',
    agent,
    destination: TOOLS[agent]?.label || agent,
    cwd: currentCwd || projectRoot || os.homedir()
  });

  send('terminal:data', {
    raw: '\r\n[TermBridge] Sending message to ' + (TOOLS[agent]?.label || agent) +
      ' in ' + (currentCwd || projectRoot || os.homedir()) + '\r\n',
    agent,
    source: 'chat-runner'
  });

  const proc = crossSpawn(spec.command, spec.args, {
    cwd: currentCwd || projectRoot || os.homedir(),
    windowsHide: true,
    shell: false,
    env: {
      ...process.env,
      TERM: 'dumb',
      NO_COLOR: '1',
      FORCE_COLOR: '0'
    }
  });
  chatProcess = proc;

  let stdoutBuffer = '';
  let stderrBuffer = '';
  let lineBuffer = '';
  const assistantParts = [];
  let detectedSessionId = String(options.engineSessionId || '').trim();
  let completed = false;

  const notifySession = (id) => {
    if (!id || id === detectedSessionId) return;
    detectedSessionId = id;
    send('chat:session', { agent, sessionId: id });
  };

  const consumeJsonLine = (line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;

    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      send('terminal:data', { raw: trimmed + '\r\n', agent, source: 'chat-runner' });
      return;
    }

    const sid = extractSessionId(event);
    if (sid && sid !== detectedSessionId) notifySession(sid);

    const terminalSummary = describeStructuredEvent(agent, event);
    if (terminalSummary) {
      send('terminal:data', { raw: terminalSummary, agent, source: 'chat-runner' });
    }

    const text = extractAssistantEventText(agent, event);
    if (text) {
      assistantParts.push(text);
      send('chat:stream', { agent, text: text + '\n' });
    }
  };

  proc.stdout.on('data', (chunk) => {
    const text = String(chunk || '');
    stdoutBuffer += text;

    if (spec.format === 'jsonl') {
      lineBuffer += text;
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() || '';
      for (const line of lines) consumeJsonLine(line);
    }
  });

  proc.stderr.on('data', (chunk) => {
    const text = String(chunk || '');
    stderrBuffer += text;
    send('terminal:data', { raw: text, agent, source: 'chat-runner', isError: true });
  });

  proc.on('error', (error) => {
    if (completed) return;
    completed = true;
    send('chat:complete', {
      ok: false,
      agent,
      error: error.message,
      text: ''
    });
    chatProcess = null;
  });

  proc.on('close', async (code) => {
    if (completed) return;
    completed = true;

    if (spec.format === 'jsonl' && lineBuffer.trim()) {
      consumeJsonLine(lineBuffer);
    }

    let finalText = [...new Set(assistantParts)].join('\n\n').trim();

    if (agent === 'claude' && stdoutBuffer.trim()) {
      try {
        const parsed = JSON.parse(stdoutBuffer.trim());
        const sid = extractSessionId(parsed);
        if (sid && sid !== detectedSessionId) notifySession(sid);
        finalText = String(parsed.result || extractJsonText(parsed) || '').trim();
      } catch {
        finalText = stdoutBuffer.trim();
      }

      send('terminal:data', {
        raw: '[Claude Code] response completed\r\n',
        agent,
        source: 'chat-runner'
      });
    }

    // OpenCode has had versions where a run succeeds and persists the assistant
    // message but stdout omits the text event. Recover from the session export.
    if (agent === 'opencode' && !finalText && detectedSessionId) {
      const exported = await execCapture(
        'opencode',
        ['session', 'export', detectedSessionId],
        { cwd: currentCwd || projectRoot || os.homedir(), timeout: 20000, maxBuffer: 12 * 1024 * 1024 }
      );
      if (exported.ok && exported.stdout.trim()) {
        try {
          finalText = extractOpenCodeExportText(JSON.parse(exported.stdout.trim())).trim();
          if (finalText) {
            send('terminal:data', {
              raw: '[OpenCode] recovered final reply from session export\r\n',
              agent,
              source: 'chat-runner'
            });
          }
        } catch {}
      }
    }

    if (!finalText && code === 0 && stdoutBuffer.trim() && spec.format !== 'jsonl') {
      finalText = stdoutBuffer.trim();
    }

    const errorText = stderrBuffer.trim();
    send('chat:complete', {
      ok: code === 0 && Boolean(finalText),
      agent,
      code,
      sessionId: detectedSessionId,
      error:
        code !== 0
          ? (errorText || 'The CLI exited with code ' + code + '.')
          : (!finalText ? 'The CLI completed but no assistant reply was returned.' : ''),
      text: finalText
    });

    send('terminal:data', {
      raw: '[TermBridge] ' + (finalText ? 'Reply received.' : 'No reply text received.') + '\r\n',
      agent,
      source: 'chat-runner'
    });

    chatProcess = null;
  });

  return { ok: true, accepted: true, agent, destination: TOOLS[agent]?.label || agent };
}


function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#f7f8fa',
    title: 'TermBridge',
    icon: path.join(__dirname, 'assets', 'icon.png'),
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
  loadWorkspaceState();

  ipcMain.handle('app:state', async () => ({
    cwd: currentCwd,
    agent: currentAgent,
    platform: process.platform,
    version: app.getVersion(),
    tools: await detectTools(),
    project: projectRoot ? projectInfo(projectRoot) : null,
    providers: listProviders()
  }));

  ipcMain.handle('tools:detect', () => detectTools());
  ipcMain.handle('tools:capabilities', (_event, agent) => discoverCapabilities(agent));

  ipcMain.handle('tools:install', async (_event, agent) => {
    const tool = TOOLS[agent];
    if (!tool?.install) return { ok: false, reason: 'No installer is configured for this tool.' };

    if (!(await commandExists('npm'))) {
      return {
        ok: false,
        reason: 'Node.js/npm is required. Install Node.js LTS, then retry.'
      };
    }

    stopTerminal();
    terminal = pty.spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-Command', tool.install],
      {
        name: 'xterm-256color',
        cols: 120,
        rows: 34,
        cwd: currentCwd || os.homedir(),
        env: { ...process.env, TERM: 'xterm-256color' }
      }
    );

    terminal.onData((raw) => send('terminal:data', { raw, agent: 'setup', source: 'setup' }));
    terminal.onExit(async ({ exitCode }) => {
      send('setup:complete', {
        agent,
        exitCode,
        tools: await detectTools()
      });
      terminal = null;
    });

    return { ok: true };
  });

  ipcMain.handle('folder:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open project folder',
      properties: ['openDirectory']
    });

    if (result.canceled || !result.filePaths[0]) return null;

    projectRoot = result.filePaths[0];
    currentCwd = projectRoot;
    saveWorkspaceState();
    stopTerminal();

    const project = projectInfo(projectRoot);
    send('project:changed', project);
    return project;
  });

  ipcMain.handle('project:refresh', () => (projectRoot ? projectInfo(projectRoot) : null));

  ipcMain.handle('project:open-path', (_event, folder) => {
    try {
      const resolved = path.resolve(String(folder || ''));
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return null;

      projectRoot = resolved;
      currentCwd = projectRoot;
      saveWorkspaceState();
      stopTerminal();

      const project = projectInfo(projectRoot);
      send('project:changed', project);
      return project;
    } catch {
      return null;
    }
  });

  ipcMain.handle('agent:start', (_event, payload) =>
    startTerminal(payload?.agent || currentAgent, currentCwd, payload?.options || {})
  );

  ipcMain.handle('chat:send', (_event, payload) =>
    runChatPrompt(
      payload?.agent || currentAgent,
      String(payload?.prompt || ''),
      payload?.options || {}
    )
  );

  ipcMain.handle('chat:provider-send', (_event, payload) => {
    runProviderChat(payload);
    return { ok: true, accepted: true };
  });

  ipcMain.handle('chat:stop', () => {
    if (chatProcess) {
      try { chatProcess.kill(); } catch {}
      chatProcess = null;
    }
    if (providerController) {
      try { providerController.abort(); } catch {}
      providerController = null;
    }
    if (opencodeController) {
      try { opencodeController.abort(); } catch {}
      opencodeController = null;
    }
    if (opencodeService?.url && opencodeActiveSessionId) {
      fetch(
        opencodeService.url + '/session/' + encodeURIComponent(opencodeActiveSessionId) + '/abort',
        { method: 'POST' }
      ).catch(() => {});
    }
    return true;
  });

  ipcMain.handle('terminal:write', async (_event, text) => {
    if (!terminal) {
      const started = await startTerminal(
        currentAgent,
        currentCwd,
        terminalLaunch?.options || {}
      );
      if (!started.ok) return false;
    }
    terminal.write(String(text || ''));
    return true;
  });

  ipcMain.handle('terminal:resize', (_event, size) => {
    if (terminal && Number(size?.cols) > 10 && Number(size?.rows) > 5) {
      try {
        terminal.resize(Number(size.cols), Number(size.rows));
      } catch {}
    }
    return true;
  });

  ipcMain.handle('terminal:restart', () =>
    startTerminal(currentAgent, currentCwd, terminalLaunch?.options || {})
  );

  ipcMain.handle('providers:list', () => listProviders());
  ipcMain.handle('providers:save', (_event, provider) => saveProvider(provider));
  ipcMain.handle('providers:delete', (_event, id) => deleteProvider(id));
  ipcMain.handle('providers:test', (_event, id) => providerTest(id));
  ipcMain.handle('providers:models', async (_event, id) => {
    try {
      return { ok: true, models: await providerModels(id) };
    } catch (error) {
      return { ok: false, error: error.message, models: [] };
    }
  });

  ipcMain.handle('external:open', (_event, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return true;
  });

  createWindow();
  startTerminal('powershell', currentCwd, {});

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  stopTerminal();
  if (chatProcess) {
    try { chatProcess.kill(); } catch {}
  }
  if (providerController) {
    try { providerController.abort(); } catch {}
  }
  if (opencodeController) {
    try { opencodeController.abort(); } catch {}
  }
  stopOpenCodeService();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
