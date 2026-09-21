const fs = require('fs');
const vm = require('vm');

const path = require('path');
const root = process.env.TB_APP_ROOT || '.';
const html = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');
const appCode = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');

class FakeClassList {
  constructor(initial = '') { this.set = new Set(String(initial).split(/\s+/).filter(Boolean)); }
  add(...names) { names.forEach(n => this.set.add(n)); }
  remove(...names) { names.forEach(n => this.set.delete(n)); }
  toggle(name, force) {
    if (force === true) { this.set.add(name); return true; }
    if (force === false) { this.set.delete(name); return false; }
    if (this.set.has(name)) { this.set.delete(name); return false; }
    this.set.add(name); return true;
  }
  contains(name) { return this.set.has(name); }
  toString() { return [...this.set].join(' '); }
}

class FakeElement {
  constructor(tag = 'div', attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.id = attrs.id || '';
    this.dataset = { ...(attrs.dataset || {}) };
    this.classList = new FakeClassList(attrs.className || '');
    this.style = {};
    this.listeners = new Map();
    this.children = [];
    this.parentElement = null;
    this.textContent = '';
    this._innerHTML = '';
    this.value = attrs.value || '';
    this.disabled = false;
    this.options = [];
    this.scrollHeight = 100;
    this.scrollTop = 0;
    this.clientHeight = 100;
    this.files = [];
    this.type = attrs.type || '';
    this.title = '';
  }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList = new FakeClassList(v); }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) {
    this._innerHTML = String(v ?? '');
    this.children = [];
    if (this.tagName === 'SELECT') this.options = [];
  }
  appendChild(child) {
    if (!child) return child;
    child.parentElement = this;
    this.children.push(child);
    if (this.tagName === 'SELECT' && child.tagName === 'OPTION') this.options.push(child);
    return child;
  }
  append(...children) { children.forEach(c => this.appendChild(c)); }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  dispatchEvent(event) {
    const e = typeof event === 'string' ? { type: event } : event;
    e.type ||= 'click';
    e.target ||= this;
    e.currentTarget = this;
    e.preventDefault ||= (() => {});
    e.stopPropagation ||= (() => {});
    const fns = this.listeners.get(e.type) || [];
    for (const fn of fns) fn(e);
    return true;
  }
  click() { return this.dispatchEvent({ type: 'click', target: this }); }
  focus() { document.activeElement = this; }
  contains(node) {
    if (node === this) return true;
    return this.children.some(child => child.contains?.(node));
  }
  closest(selector) {
    if (selector.startsWith('.') && this.classList.contains(selector.slice(1))) return this;
    return this.parentElement?.closest?.(selector) || null;
  }
  querySelector(selector) {
    if (selector === 'span:last-child') {
      let child = this.children.filter(c => c.tagName === 'SPAN').at(-1);
      if (!child) { child = new FakeElement('span'); this.appendChild(child); }
      return child;
    }
    if (selector.startsWith('.')) return this.children.find(c => c.classList.contains(selector.slice(1))) || null;
    return null;
  }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(c => c !== this);
    this.parentElement = null;
  }
}

function parseAttrs(text) {
  const attrs = {};
  const id = text.match(/\bid="([^"]+)"/); if (id) attrs.id = id[1];
  const cls = text.match(/\bclass="([^"]*)"/); if (cls) attrs.className = cls[1];
  const value = text.match(/\bvalue="([^"]*)"/); if (value) attrs.value = value[1];
  const type = text.match(/\btype="([^"]*)"/); if (type) attrs.type = type[1];
  attrs.dataset = {};
  for (const m of text.matchAll(/\bdata-([\w-]+)="([^"]*)"/g)) {
    const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    attrs.dataset[key] = m[2];
  }
  return attrs;
}

const allElements = [];
const byId = new Map();
for (const match of html.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
  const tag = match[1].toLowerCase();
  if (tag.startsWith('!') || tag === 'script' || tag === 'link' || tag === 'meta') continue;
  const attrs = parseAttrs(match[2] || '');
  const el = new FakeElement(tag, attrs);
  allElements.push(el);
  if (el.id) byId.set(el.id, el);
}

function selectorAll(selector) {
  if (selector.startsWith('#')) {
    const el = byId.get(selector.slice(1));
    return el ? [el] : [];
  }
  if (selector.startsWith('.')) {
    const cls = selector.slice(1);
    return allElements.filter(el => el.classList.contains(cls));
  }
  const data = selector.match(/^\[data-([\w-]+)\]$/);
  if (data) {
    const key = data[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return allElements.filter(el => Object.prototype.hasOwnProperty.call(el.dataset, key));
  }
  return [];
}

const document = {
  activeElement: null,
  querySelector: (selector) => selectorAll(selector)[0] || null,
  querySelectorAll: selectorAll,
  createElement: (tag) => new FakeElement(tag),
  addEventListener: () => {},
};

const storage = new Map();
const localStorage = {
  getItem: (k) => storage.has(k) ? storage.get(k) : null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k)
};

const calls = { startAgent: [], sendChat: [], openProject: [], providers: 0 };
const eventHandlers = {};
const api = {
  getState: async () => ({
    cwd: 'C:\\Demo', agent: 'powershell', project: null, providers: [],
    tools: {
      powershell: { installed: true, version: 'Windows PowerShell' },
      cmd: { installed: true, version: 'CMD' },
      codex: { installed: true, version: 'codex 1.0' },
      claude: { installed: true, version: 'claude 1.0' },
      opencode: { installed: true, version: 'opencode 1.0' }
    }
  }),
  detectTools: async () => ({
    powershell: { installed: true }, cmd: { installed: true }, codex: { installed: true },
    claude: { installed: true }, opencode: { installed: true }
  }),
  getCapabilities: async (agent) => ({
    models: agent === 'opencode' ? ['Default', 'openai/test-model'] : ['Default'],
    agents: agent === 'opencode' ? ['Default', 'build'] : ['Default'],
    commands: [{ name: 'help', description: 'Runtime help' }],
    options: [{ name: '--help', description: 'Help option' }], meta: { installed: true }
  }),
  installTool: async () => ({ ok: true }),
  pickFolder: async () => null,
  refreshProject: async () => null,
  openProjectPath: async (p) => { calls.openProject.push(p); return null; },
  startAgent: async (agent, options) => { calls.startAgent.push({ agent, options }); return { ok: true, agent, status: 'starting' }; },
  send: async () => true,
  resize: async () => true,
  restart: async () => ({ ok: true }),
  sendChat: async (agent, prompt, options) => { calls.sendChat.push({ agent, prompt, options }); return { ok: true, accepted: true }; },
  sendProviderChat: async () => ({ ok: true, accepted: true }),
  stopChat: async () => true,
  listProviders: async () => [],
  saveProvider: async () => ({ ok: true }),
  deleteProvider: async () => true,
  testProvider: async () => ({ ok: true }),
  providerModels: async () => ({ ok: true, models: [] }),
  openExternal: async () => true,
};
for (const name of ['onChatStream','onChatComplete','onChatStatus','onChatSession','onData','onStatus','onExit','onSetupComplete','onProjectChanged']) {
  api[name] = (cb) => { eventHandlers[name] = cb; return () => {}; };
}

const context = {
  window: { termbridge: api, Terminal: undefined, FitAddon: undefined },
  document,
  localStorage,
  crypto: { randomUUID: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
  requestAnimationFrame: (fn) => { fn(); return 1; },
  ResizeObserver: class { observe(){} disconnect(){} },
  setTimeout,
  clearTimeout,
  console,
  Blob: global.Blob,
  URL: global.URL,
  prompt: () => null,
  confirm: () => true,
  alert: () => {},
  innerWidth: 1400,
  innerHeight: 900,
};
context.window.window = context.window;
context.window.document = document;
context.globalThis = context;

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

(async () => {
  const script = new vm.Script(appCode, { filename: 'renderer/app.js' });
  script.runInNewContext(context);
  await new Promise(r => setTimeout(r, 30));

  const get = id => byId.get(id);

  const requiredListeners = {
    newChat: 'click', projectsNav: 'click', providersNav: 'click', chatSearchBtn: 'click',
    projectBtn: 'click', openFolderBtn: 'click', refreshProjectBtn: 'click',
    commandPaletteBtn: 'click', reviewBtn: 'click', settingsBtn: 'click', setupBtn: 'click',
    missingToolAction: 'click', engineSelect: 'change', modelSelect: 'change',
    agentSelect: 'change', effortSelect: 'change', applyConfigBtn: 'click',
    capabilitiesBtn: 'click', sendBtn: 'click', stopBtn: 'click',
    launchCliBtn: 'click', clearTerminal: 'click', terminalSend: 'click',
    closeSettings: 'click', newProviderBtn: 'click', providerForm: 'submit',
    providerSecretSource: 'change', providerType: 'change', testProviderBtn: 'click',
    useProviderBtn: 'click', deleteProviderBtn: 'click', paletteSearch: 'input'
  };

  for (const [id, type] of Object.entries(requiredListeners)) {
    assert(get(id), 'Missing UI element #' + id);
    assert(get(id).listeners.get(type)?.length, 'Missing ' + type + ' listener on #' + id);
  }

  for (const selector of ['.right-tab', '.modal-tab', '.welcome-card']) {
    const items = selectorAll(selector);
    assert(items.length, 'No elements found for ' + selector);
    for (const item of items) assert(item.listeners.get('click')?.length, 'Missing click listener for ' + selector);
  }

  assert(get('settingsBtn').listeners.get('click')?.length, 'Settings button click handler missing');
  get('settingsBtn').click();
  assert(!get('settingsModal').classList.contains('hidden'), 'Settings modal did not open');

  get('closeSettings').click();
  assert(get('settingsModal').classList.contains('hidden'), 'Settings modal did not close');

  get('providersNav').click();
  assert(!get('settingsModal').classList.contains('hidden'), 'Providers navigation did not open settings');
  assert(!get('providersTab').classList.contains('hidden'), 'Providers tab did not become visible');

  get('closeSettings').click();
  get('engineSelect').value = 'opencode';
  get('engineSelect').dispatchEvent({ type: 'change', target: get('engineSelect') });
  await new Promise(r => setTimeout(r, 40));
  assert(calls.startAgent.some(call => call.agent === 'opencode'), 'OpenCode selection did not start the engine');

  get('modelSelect').value = 'openai/test-model';
  get('modelSelect').dispatchEvent({ type: 'change', target: get('modelSelect') });
  await new Promise(r => setTimeout(r, 330));
  const opencodeCalls = calls.startAgent.filter(call => call.agent === 'opencode');
  assert(opencodeCalls.length >= 2, 'Model change did not auto-apply/restart OpenCode');

  const before = get('paletteModal').classList.contains('hidden');
  get('commandPaletteBtn').click();
  assert(before && !get('paletteModal').classList.contains('hidden'), 'Command palette did not open');

  get('setupBtn').click();
  assert(!get('settingsModal').classList.contains('hidden'), 'CLI setup button did not open settings');

  assert(eventHandlers.onStatus, 'Terminal status event handler not registered');
  eventHandlers.onStatus({ status: 'starting', agent: 'opencode', cwd: 'C:\\Demo' });
  assert(get('engineBootText').textContent === 'Starting', 'Starting state did not render');
  eventHandlers.onStatus({ status: 'ready', agent: 'opencode', cwd: 'C:\\Demo' });
  assert(get('engineBootText').textContent === 'Ready', 'Ready state did not render');

  console.log('Renderer interaction checks passed.');
  console.log('startAgent calls:', calls.startAgent.length);
  console.log('settings + providers + engine + auto-apply + palette + setup + lifecycle: OK');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
