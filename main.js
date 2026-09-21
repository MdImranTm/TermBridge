const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const crossSpawn = require('cross-spawn');
const pty = require('node-pty');

let mainWindow = null;
let terminal = null;
let chatProcess = null;
let providerController = null;
let projectRoot = null;
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
    execFile(
      file,
      args,
      {
        windowsHide: true,
        cwd: opts.cwd || currentCwd || os.homedir(),
        timeout: opts.timeout || 8000,
        maxBuffer: opts.maxBuffer || 4 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          code: error?.code ?? 0
        });
      }
    );
  });
}

async function commandExists(command) {
  const result = await execCapture('where.exe', [command], {
    cwd: os.homedir(),
    timeout: 5000
  });
  return result.ok && result.stdout.trim().length > 0;
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
  if (!tool) return { models: [], agents: [], commands: [], options: [] };

  if (tool.kind === 'ai' && !(await commandExists(tool.command))) {
    return {
      models: tool.models || ['Default'],
      agents: tool.agents || ['Default'],
      commands: [],
      options: []
    };
  }

  const help = await execCapture(tool.command, ['--help'], { timeout: 9000 });
  const parsed = parseHelpCapabilities(help.stdout || help.stderr);

  if (agent === 'opencode') {
    const [modelsResult, agentsResult] = await Promise.all([
      execCapture('opencode', ['models'], { timeout: 15000 }),
      execCapture('opencode', ['debug', 'agents'], { timeout: 10000 })
    ]);

    const models = modelsResult.ok
      ? modelsResult.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => /[a-z0-9][/:_-][a-z0-9]/i.test(line))
          .slice(0, 200)
      : [];

    const agents = agentsResult.ok
      ? agentsResult.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.split(/\s+/)[0])
          .filter((line) => /^[\w.-]+$/.test(line))
          .slice(0, 80)
      : [];

    return {
      models: ['Default', ...models.filter((x) => x !== 'Default')],
      agents: ['Default', ...agents.filter((x) => x !== 'Default')],
      commands: parsed.commands,
      options: parsed.options
    };
  }

  return {
    models: tool.models || ['Default'],
    agents: tool.agents || ['Default'],
    commands: parsed.commands,
    options: parsed.options
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

    const text = extractProviderText(data).trim();
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
    initial: [commandName, ...cliArgs].map(psQuote).join(' ')
  };
}

async function startTerminal(agent = currentAgent, cwd = currentCwd, options = {}) {
  stopTerminal();
  currentAgent = agent || 'powershell';
  currentCwd = cwd || projectRoot || os.homedir();

  const tool = TOOLS[currentAgent] || TOOLS.powershell;
  if (tool.kind === 'ai' && !(await commandExists(tool.command))) {
    send('terminal:status', {
      status: 'not-installed',
      agent: currentAgent,
      cwd: currentCwd
    });
    return { ok: false, reason: 'not-installed' };
  }

  const launch = buildLaunch(currentAgent, options);
  terminalLaunch = { ...launch, options };

  try {
    terminal = pty.spawn(launch.shell, launch.args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 34,
      cwd: currentCwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor'
      }
    });
  } catch (error) {
    send('terminal:status', {
      status: 'error',
      error: error.message,
      agent: currentAgent,
      cwd: currentCwd
    });
    return { ok: false, reason: error.message };
  }

  terminal.onData((raw) => {
    send('terminal:data', { raw, agent: currentAgent, source: 'terminal' });
  });

  terminal.onExit(({ exitCode, signal }) => {
    send('terminal:exit', { exitCode, signal, agent: currentAgent });
    terminal = null;
  });

  if (launch.initial) {
    setTimeout(() => {
      if (terminal) terminal.write(launch.initial + '\r');
    }, 250);
  }

  send('terminal:status', {
    status: 'ready',
    agent: currentAgent,
    cwd: currentCwd,
    launch
  });

  return { ok: true, agent: currentAgent, cwd: currentCwd, launch };
}

function extractJsonText(obj) {
  const values = [];

  const walk = (value, key = '') => {
    if (value == null) return;
    if (typeof value === 'string') {
      if (
        ['text', 'message', 'content', 'output_text', 'final_output', 'assistant_message'].includes(key) &&
        value.trim()
      ) {
        values.push(value.trim());
      }
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

function buildChatCommand(agent, prompt, options = {}) {
  const model = options.model && options.model !== 'Default' ? String(options.model) : '';
  const subagent = options.subagent && options.subagent !== 'Default' ? String(options.subagent) : '';

  if (agent === 'codex') {
    const args = ['exec', '--json'];
    if (model) args.push('--model', model);
    if (options.effort && options.effort !== 'default') {
      args.push('-c', 'model_reasoning_effort="' + options.effort + '"');
    }
    args.push(prompt);
    return { command: 'codex', args, json: true };
  }

  if (agent === 'claude') {
    const args = ['-p', prompt, '--output-format', 'stream-json'];
    if (model) args.push('--model', model);
    return { command: 'claude', args, json: true };
  }

  if (agent === 'opencode') {
    const args = ['run'];
    if (model) args.push('--model', model);
    if (subagent) args.push('--agent', subagent);
    args.push(prompt);
    return { command: 'opencode', args, json: false };
  }

  return null;
}

async function runChatPrompt(agent, prompt, options = {}) {
  const spec = buildChatCommand(agent, prompt, options);
  if (!spec) return { ok: false, reason: 'not-ai' };
  if (!(await commandExists(spec.command))) return { ok: false, reason: 'not-installed' };

  if (chatProcess) {
    try {
      chatProcess.kill();
    } catch {}
    chatProcess = null;
  }

  send('chat:status', { status: 'running', agent });

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

  let lineBuffer = '';
  let plainBuffer = '';
  const finalParts = [];

  const processChunk = (chunk, isError = false) => {
    const text = String(chunk || '');
    send('terminal:data', {
      raw: text,
      agent,
      source: 'chat-runner',
      isError
    });

    if (!spec.json) {
      plainBuffer += text;
      send('chat:stream', { agent, text });
      return;
    }

    lineBuffer += text;
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed);
        const extracted = extractJsonText(parsed);
        if (extracted) {
          finalParts.push(extracted);
          send('chat:stream', { agent, text: extracted + '\n' });
        }
      } catch {
        if (!/^\s*[\{\[]/.test(trimmed)) {
          finalParts.push(trimmed);
          send('chat:stream', { agent, text: trimmed + '\n' });
        }
      }
    }
  };

  proc.stdout.on('data', (data) => processChunk(data, false));
  proc.stderr.on('data', (data) => processChunk(data, true));

  proc.on('error', (error) => {
    send('chat:complete', {
      ok: false,
      agent,
      error: error.message,
      text: ''
    });
    chatProcess = null;
  });

  proc.on('close', (code) => {
    if (lineBuffer.trim()) {
      try {
        const parsed = JSON.parse(lineBuffer.trim());
        const extracted = extractJsonText(parsed);
        if (extracted) finalParts.push(extracted);
      } catch {
        if (!spec.json) plainBuffer += lineBuffer;
      }
    }

    const combined = spec.json
      ? [...new Set(finalParts)].join('\n\n').trim()
      : plainBuffer.trim();

    send('chat:complete', {
      ok: code === 0,
      agent,
      code,
      text: combined
    });

    chatProcess = null;
  });

  return { ok: true };
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
    return { ok: true };
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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
