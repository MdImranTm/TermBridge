const api = window.termbridge;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const TOOL_NAMES = {
  powershell: 'PowerShell',
  cmd: 'CMD',
  codex: 'Codex',
  claude: 'Claude Code',
  opencode: 'OpenCode',
  provider: 'Custom API'
};

const CLI_AI_TOOLS = ['codex', 'claude', 'opencode'];
const TOOL_SLASH_COMMANDS = {
  codex: [
    { name: '/init', description: 'Create project instructions', source: 'Codex' },
    { name: '/status', description: 'Show current session configuration', source: 'Codex' },
    { name: '/permissions', description: 'Open permission controls', source: 'Codex' },
    { name: '/model', description: 'Choose model and reasoning effort', source: 'Codex' },
    { name: '/review', description: 'Review changes or project work', source: 'Codex' }
  ],
  claude: [
    { name: '/help', description: 'Open Claude Code help', source: 'Claude Code' },
    { name: '/model', description: 'Choose the active model', source: 'Claude Code' },
    { name: '/permissions', description: 'Open permission controls', source: 'Claude Code' },
    { name: '/mcp', description: 'Manage MCP integrations', source: 'Claude Code' },
    { name: '/compact', description: 'Compact conversation context', source: 'Claude Code' },
    { name: '/clear', description: 'Start with a clean conversation', source: 'Claude Code' }
  ],
  opencode: [
    { name: '/help', description: 'Open OpenCode help', source: 'OpenCode' },
    { name: '/new', description: 'Start a new OpenCode session', source: 'OpenCode' },
    { name: '/sessions', description: 'List and switch sessions', source: 'OpenCode' },
    { name: '/models', description: 'Choose an available model', source: 'OpenCode' },
    { name: '/agents', description: 'Choose an available agent', source: 'OpenCode' },
    { name: '/undo', description: 'Undo the latest work', source: 'OpenCode' },
    { name: '/redo', description: 'Restore reverted work', source: 'OpenCode' },
    { name: '/editor', description: 'Open the external prompt editor', source: 'OpenCode' },
    { name: '/btw', description: 'Ask a side question without changing context', source: 'OpenCode' }
  ]
};

const BUILTIN_COMMANDS = [
  { name: '/review', description: 'Review the selected project without making changes', source: 'TermBridge' },
  { name: '/new', description: 'Create a new chat', source: 'TermBridge' },
  { name: '/clear', description: 'Clear messages in the current chat', source: 'TermBridge' },
  { name: '/providers', description: 'Open custom provider settings', source: 'TermBridge' },
  { name: '/setup', description: 'Open CLI setup', source: 'TermBridge' },
  { name: '/terminal', description: 'Open the Terminal panel', source: 'TermBridge' }
];

const els = {
  newChat: $('#newChat'),
  projectsNav: $('#projectsNav'),
  providersNav: $('#providersNav'),
  chatSearchBtn: $('#chatSearchBtn'),
  chatSearchWrap: $('#chatSearchWrap'),
  chatSearch: $('#chatSearch'),
  sessionList: $('#sessionList'),
  setupBtn: $('#setupBtn'),
  setupSummary: $('#setupSummary'),

  projectBtn: $('#projectBtn'),
  openFolderBtn: $('#openFolderBtn'),
  projectName: $('#projectName'),
  projectPath: $('#projectPath'),
  projectMeta: $('#projectMeta'),
  refreshProjectBtn: $('#refreshProjectBtn'),
  fileTools: $('#fileTools'),
  fileSearch: $('#fileSearch'),
  fileCount: $('#fileCount'),
  fileTree: $('#fileTree'),

  commandPaletteBtn: $('#commandPaletteBtn'),
  reviewBtn: $('#reviewBtn'),
  statusDot: $('#statusDot'),
  statusText: $('#statusText'),
  settingsBtn: $('#settingsBtn'),

  toolTabs: $('#toolTabs'),
  modelSelect: $('#modelSelect'),
  customModelInput: $('#customModelInput'),
  agentSelect: $('#agentSelect'),
  effortSelect: $('#effortSelect'),
  capabilitiesBtn: $('#capabilitiesBtn'),
  applyConfigBtn: $('#applyConfigBtn'),

  chatTitle: $('#chatTitle'),
  chatSubtitle: $('#chatSubtitle'),
  activeAgentLabel: $('#activeAgentLabel'),
  welcome: $('#welcome'),
  messages: $('#messages'),
  jumpBottom: $('#jumpBottom'),
  missingToolBanner: $('#missingToolBanner'),
  missingToolTitle: $('#missingToolTitle'),
  missingToolText: $('#missingToolText'),
  missingToolAction: $('#missingToolAction'),
  commandSuggest: $('#commandSuggest'),
  composer: $('#composer'),
  stopBtn: $('#stopBtn'),
  sendBtn: $('#sendBtn'),

  terminalOutput: $('#terminalOutput'),
  terminalInput: $('#terminalInput'),
  terminalSend: $('#terminalSend'),
  launchCliBtn: $('#launchCliBtn'),
  clearTerminal: $('#clearTerminal'),
  activityList: $('#activityList'),
  capabilitiesList: $('#capabilitiesList'),

  sessionMenu: $('#sessionMenu'),

  settingsModal: $('#settingsModal'),
  closeSettings: $('#closeSettings'),
  clisTab: $('#clisTab'),
  providersTab: $('#providersTab'),
  setupList: $('#setupList'),

  newProviderBtn: $('#newProviderBtn'),
  providerList: $('#providerList'),
  providerEmpty: $('#providerEmpty'),
  providerForm: $('#providerForm'),
  providerId: $('#providerId'),
  providerName: $('#providerName'),
  providerType: $('#providerType'),
  providerBaseUrl: $('#providerBaseUrl'),
  providerSecretSource: $('#providerSecretSource'),
  providerSecretRef: $('#providerSecretRef'),
  apiKeyField: $('#apiKeyField'),
  providerApiKey: $('#providerApiKey'),
  providerModelsPath: $('#providerModelsPath'),
  providerChatPath: $('#providerChatPath'),
  providerDefaultModel: $('#providerDefaultModel'),
  providerHeaders: $('#providerHeaders'),
  providerBodyTemplate: $('#providerBodyTemplate'),
  providerResponsePath: $('#providerResponsePath'),
  testProviderBtn: $('#testProviderBtn'),
  useProviderBtn: $('#useProviderBtn'),
  deleteProviderBtn: $('#deleteProviderBtn'),
  providerResult: $('#providerResult'),

  paletteModal: $('#paletteModal'),
  paletteSearch: $('#paletteSearch'),
  paletteList: $('#paletteList')
};

let state = {
  cwd: '',
  agent: 'powershell',
  tools: {},
  project: null,
  providers: []
};

let options = {
  model: 'Default',
  subagent: 'Default',
  effort: 'default',
  providerId: ''
};

let currentCapabilities = { models: [], agents: [], commands: [], options: [] };
let sessions = loadSessions();
let activeId = localStorage.getItem('termbridge.activeId') || sessions[0]?.id || null;
let terminalText = '';
let activities = [];
let menuSessionId = null;
let expandedFolders = new Set();
let renderedProjectPath = null;
let pendingResponse = false;
let streamingAssistantId = null;
let streamingText = '';
let selectedProviderId = '';

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random())
    .replace(/-/g, '')
    .slice(0, 18);
}

function loadSessions() {
  try {
    const parsed = JSON.parse(localStorage.getItem('termbridge.sessions') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSessions() {
  localStorage.setItem('termbridge.sessions', JSON.stringify(sessions.slice(0, 80)));
  if (activeId) localStorage.setItem('termbridge.activeId', activeId);
  else localStorage.removeItem('termbridge.activeId');
}

function activeSession() {
  return sessions.find((session) => session.id === activeId) || null;
}

function setStatus(text, kind = 'ok') {
  els.statusText.textContent = text;
  els.statusDot.style.background =
    kind === 'error' ? '#e65f76' :
    kind === 'busy' ? '#dca72a' :
    '#20b879';
}

function addActivity(title, detail = '') {
  activities.unshift({ title, detail, at: Date.now() });
  activities = activities.slice(0, 120);
  renderActivity();
}

function newSession() {
  const session = {
    id: uid(),
    title: 'New chat',
    agent: state.agent || 'powershell',
    providerId: state.agent === 'provider' ? selectedProviderId : '',
    cwd: state.project?.path || '',
    hasProject: Boolean(state.project?.path),
    options: { ...options },
    engineSessionIds: {},
    createdAt: Date.now(),
    messages: []
  };

  sessions.unshift(session);
  activeId = session.id;
  saveSessions();
  renderAll(true);
  els.composer.focus();
  addActivity('New chat created', engineDisplayName());
}

async function selectSession(id) {
  activeId = id;
  const session = activeSession();
  if (!session) return;

  if (session.hasProject && session.cwd && session.cwd !== state.project?.path) {
    const project = await api.openProjectPath(session.cwd);
    if (project) renderProject(project);
  }

  state.agent = session.agent || 'powershell';
  selectedProviderId = session.providerId || selectedProviderId;
  options = {
    model: 'Default',
    subagent: 'Default',
    effort: 'default',
    providerId: selectedProviderId,
    ...(session.options || {})
  };

  saveSessions();
  await loadEngineCapabilities(false);
  renderAll(true);
}

function showSessionMenu(event, id) {
  event.stopPropagation();
  menuSessionId = id;
  els.sessionMenu.style.left = Math.min(event.clientX, innerWidth - 180) + 'px';
  els.sessionMenu.style.top = Math.min(event.clientY, innerHeight - 190) + 'px';
  els.sessionMenu.classList.remove('hidden');
}

function hideSessionMenu() {
  els.sessionMenu.classList.add('hidden');
  menuSessionId = null;
}

function sessionAction(action) {
  const session = sessions.find((item) => item.id === menuSessionId);
  if (!session) return;

  if (action === 'rename') {
    const value = prompt('Rename chat', session.title || 'New chat');
    if (value?.trim()) session.title = value.trim().slice(0, 90);
  }

  if (action === 'duplicate') {
    const copy = JSON.parse(JSON.stringify(session));
    copy.id = uid();
    copy.title = (session.title || 'Chat') + ' copy';
    copy.createdAt = Date.now();
    sessions.unshift(copy);
    activeId = copy.id;
  }

  if (action === 'clear' && confirm('Clear all messages in this chat?')) {
    session.messages = [];
  }

  if (action === 'export') {
    const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = (session.title || 'termbridge-chat').replace(/[^a-z0-9-_]+/gi, '_') + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 250);
  }

  if (action === 'delete' && confirm('Delete this chat?')) {
    sessions = sessions.filter((item) => item.id !== session.id);
    if (activeId === session.id) activeId = sessions[0]?.id || null;
    if (!activeId) {
      saveSessions();
      hideSessionMenu();
      newSession();
      return;
    }
  }

  saveSessions();
  hideSessionMenu();
  renderAll(true);
}

function renderSessions() {
  const query = (els.chatSearch.value || '').trim().toLowerCase();
  els.sessionList.innerHTML = '';

  const visible = sessions.filter((session) => {
    if (!query) return true;
    const provider = state.providers.find((item) => item.id === session.providerId);
    return [
      session.title,
      TOOL_NAMES[session.agent],
      provider?.name
    ].some((value) => String(value || '').toLowerCase().includes(query));
  });

  if (!visible.length) {
    els.sessionList.innerHTML =
      '<div class="empty-panel compact"><b>No chats found</b><span>Create a new chat or change the search.</span></div>';
    return;
  }

  for (const session of visible) {
    const row = document.createElement('div');
    row.className = 'session-item' + (session.id === activeId ? ' active' : '');

    const main = document.createElement('button');
    main.className = 'session-main';

    const title = document.createElement('b');
    title.textContent = session.title || 'New chat';

    const meta = document.createElement('small');
    const provider = state.providers.find((item) => item.id === session.providerId);
    const engine =
      session.agent === 'provider'
        ? provider?.name || 'Custom API'
        : TOOL_NAMES[session.agent] || session.agent || 'Terminal';
    meta.textContent = engine + ' · ' + new Date(session.createdAt).toLocaleDateString();

    main.append(title, meta);
    main.addEventListener('click', () => selectSession(session.id));

    const more = document.createElement('button');
    more.className = 'session-more';
    more.textContent = '⋯';
    more.title = 'Chat options';
    more.addEventListener('click', (event) => showSessionMenu(event, session.id));

    row.append(main, more);
    els.sessionList.appendChild(row);
  }
}

function engineDisplayName() {
  if (state.agent === 'provider') {
    return state.providers.find((item) => item.id === selectedProviderId)?.name || 'Custom API';
  }
  return TOOL_NAMES[state.agent] || state.agent;
}

function renderChatHeader() {
  const session = activeSession();
  els.chatTitle.textContent = session?.title || 'New chat';

  const projectText = state.project?.name ? ' · ' + state.project.name : '';
  const modelText = options.model && options.model !== 'Default' ? ' · ' + options.model : '';
  els.chatSubtitle.textContent = engineDisplayName() + modelText + projectText;
  els.activeAgentLabel.textContent = engineDisplayName();
}

function renderMessages(forceBottom = false) {
  const session = activeSession();
  const messages = session?.messages || [];
  const oldTop = els.messages.scrollTop;
  const oldHeight = els.messages.scrollHeight;
  const distance = oldHeight - (oldTop + els.messages.clientHeight);
  const shouldFollow = forceBottom || distance < 75;

  els.welcome.style.display = messages.length ? 'none' : 'flex';
  els.messages.style.display = messages.length ? 'block' : 'none';
  els.messages.innerHTML = '';

  for (const message of messages) {
    const row = document.createElement('div');
    row.className = 'message ' + message.role;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = message.role === 'user' ? 'YOU' : '>_';

    const body = document.createElement('div');
    body.className = 'message-body';

    const head = document.createElement('div');
    head.className = 'message-head';

    const who = document.createElement('strong');
    who.textContent = message.role === 'user' ? 'You' : engineDisplayName();

    const time = document.createElement('span');
    time.textContent = new Date(message.at).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });

    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = message.text || (message.streaming ? 'Working…' : '');

    head.append(who, time);

    if (message.delivery) {
      const delivery = document.createElement('span');
      delivery.className = 'message-delivery';
      delivery.textContent = message.delivery;
      head.appendChild(delivery);
    }
    body.append(head, text);
    row.append(avatar, body);
    els.messages.appendChild(row);
  }

  requestAnimationFrame(() => {
    if (shouldFollow) {
      els.messages.scrollTop = els.messages.scrollHeight;
      els.jumpBottom.classList.add('hidden');
    } else {
      els.messages.scrollTop = oldTop + Math.max(0, els.messages.scrollHeight - oldHeight);
      els.jumpBottom.classList.remove('hidden');
    }
  });
}

function addMessage(role, text, forceBottom = false, delivery = '') {
  if (!activeId) newSession();
  const session = activeSession();
  const id = uid();

  session.messages.push({
    id,
    role,
    text: String(text || ''),
    at: Date.now(),
    delivery
  });

  if (role === 'user' && (!session.title || session.title === 'New chat')) {
    session.title = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 52) || 'New chat';
  }

  saveSessions();
  renderSessions();
  renderChatHeader();
  renderMessages(forceBottom);
  return id;
}

function renderToolTabs() {
  els.toolTabs.innerHTML = '';

  for (const id of ['powershell', 'cmd', 'codex', 'claude', 'opencode']) {
    const tool = state.tools[id] || { installed: id === 'powershell' || id === 'cmd' };
    const button = document.createElement('button');
    button.className =
      'tool-tab ' +
      (tool.installed ? 'installed' : 'missing') +
      (state.agent === id ? ' active' : '');
    button.innerHTML = '<span class="tool-dot"></span><span>' + TOOL_NAMES[id] + '</span>';
    button.title = tool.installed ? (tool.version || 'Installed') : 'Not installed';
    button.addEventListener('click', () => setEngine(id));
    els.toolTabs.appendChild(button);
  }

  const providerButton = document.createElement('button');
  providerButton.className =
    'tool-tab ' +
    (state.providers.length ? 'installed' : 'missing') +
    (state.agent === 'provider' ? ' active' : '');
  providerButton.innerHTML = '<span class="tool-dot"></span><span>API</span>';
  providerButton.title = state.providers.length
    ? state.providers.length + ' custom provider(s)'
    : 'No custom providers configured';
  providerButton.addEventListener('click', () => setEngine('provider'));
  els.toolTabs.appendChild(providerButton);

  const tool = state.tools[state.agent];
  const missing = CLI_AI_TOOLS.includes(state.agent) && tool && !tool.installed;
  els.missingToolBanner.classList.toggle('hidden', !missing);

  if (missing) {
    els.missingToolTitle.textContent = TOOL_NAMES[state.agent] + ' is not installed';
    els.missingToolText.textContent = 'Open CLI setup to install it or complete configuration.';
  }

  renderChatHeader();
}

function fillSelect(select, values, selected) {
  select.innerHTML = '';
  const unique = [...new Set(values.filter(Boolean))];
  for (const value of unique) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
  select.value = unique.includes(selected) ? selected : unique[0] || '';
}

function updateCustomModelVisibility() {
  const show = els.modelSelect.value === '__custom__';
  els.customModelInput.classList.toggle('hidden', !show);
}

async function loadEngineCapabilities(applyAfter = false) {
  els.customModelInput.classList.add('hidden');

  if (state.agent === 'provider') {
    const provider =
      state.providers.find((item) => item.id === selectedProviderId) ||
      state.providers[0];

    if (!provider) {
      selectedProviderId = '';
      currentCapabilities = { models: [], agents: [], commands: [], options: [] };
      fillSelect(els.modelSelect, ['No provider configured'], 'No provider configured');
      fillSelect(els.agentSelect, ['Default'], 'Default');
      els.modelSelect.disabled = true;
      els.agentSelect.disabled = true;
      els.effortSelect.disabled = true;
      renderCapabilities();
      return;
    }

    selectedProviderId = provider.id;
    options.providerId = provider.id;
    let models = [];
    const result = await api.providerModels(provider.id);
    if (result?.ok) models = result.models || [];

    const desired = options.model && options.model !== 'Default'
      ? options.model
      : provider.defaultModel || 'Default';

    const choices = ['Default', ...models.filter((x) => x !== 'Default'), '__custom__'];
    fillSelect(els.modelSelect, choices, choices.includes(desired) ? desired : (desired === 'Default' ? 'Default' : '__custom__'));
    [...els.modelSelect.options].forEach((option) => {
      if (option.value === '__custom__') option.textContent = 'Custom model…';
    });

    if (desired !== 'Default' && !choices.includes(desired)) {
      els.customModelInput.value = desired;
      els.modelSelect.value = '__custom__';
      els.customModelInput.classList.remove('hidden');
    }

    fillSelect(els.agentSelect, ['Default'], 'Default');
    els.modelSelect.disabled = false;
    els.agentSelect.disabled = true;
    els.effortSelect.disabled = true;

    currentCapabilities = {
      models,
      agents: [],
      commands: [],
      options: [
        { name: 'Provider', description: provider.name },
        { name: 'Base URL', description: provider.baseURL },
        { name: 'Adapter', description: provider.type }
      ]
    };

    renderCapabilities();
    if (applyAfter) await applyConfiguration();
    return;
  }

  if (!CLI_AI_TOOLS.includes(state.agent)) {
    currentCapabilities = { models: [], agents: [], commands: [], options: [] };
    fillSelect(els.modelSelect, ['Default'], 'Default');
    fillSelect(els.agentSelect, ['Default'], 'Default');
    els.modelSelect.disabled = true;
    els.agentSelect.disabled = true;
    els.effortSelect.disabled = true;
    renderCapabilities();
    if (applyAfter) await applyConfiguration();
    return;
  }

  currentCapabilities = await api.getCapabilities(state.agent);

  const models = ['Default', ...(currentCapabilities.models || []).filter((x) => x !== 'Default'), '__custom__'];
  const knownModel = models.includes(options.model);

  fillSelect(
    els.modelSelect,
    models,
    knownModel ? options.model : (options.model === 'Default' ? 'Default' : '__custom__')
  );

  [...els.modelSelect.options].forEach((option) => {
    if (option.value === '__custom__') option.textContent = 'Custom model…';
  });

  if (options.model && options.model !== 'Default' && !knownModel) {
    els.customModelInput.value = options.model;
    els.modelSelect.value = '__custom__';
    els.customModelInput.classList.remove('hidden');
  }

  fillSelect(
    els.agentSelect,
    ['Default', ...(currentCapabilities.agents || []).filter((x) => x !== 'Default')],
    options.subagent || 'Default'
  );

  els.effortSelect.value = options.effort || 'default';
  els.modelSelect.disabled = false;
  els.agentSelect.disabled = state.agent !== 'opencode';
  els.effortSelect.disabled = state.agent !== 'codex';

  renderCapabilities();
  if (applyAfter) await applyConfiguration();
}

async function setEngine(agent) {
  if (agent === 'provider' && !state.providers.length) {
    openSettings('providers');
    return;
  }

  state.agent = agent;
  if (agent === 'provider' && !selectedProviderId) {
    selectedProviderId = state.providers[0]?.id || '';
  }

  const session = activeSession();
  if (session) {
    session.agent = agent;
    session.providerId = agent === 'provider' ? selectedProviderId : '';
    saveSessions();
  }

  await loadEngineCapabilities(false);
  renderToolTabs();

  if (CLI_AI_TOOLS.includes(agent)) {
    const tool = state.tools[agent];
    if (tool && !tool.installed) {
      setStatus('Not installed', 'error');
      openSettings('clis');
      return;
    }

    switchRightView('terminal');
    setStatus('Opening ' + engineDisplayName() + '…', 'busy');
    const result = await api.startAgent(agent, options);

    if (result?.ok) {
      setStatus(engineDisplayName() + ' ready', 'ok');
      addActivity('Interactive CLI auto-opened', engineDisplayName());
    } else {
      setStatus('CLI launch failed', 'error');
      addActivity('CLI launch failed', engineDisplayName());
    }
  } else if (agent === 'provider') {
    setStatus('API ready', 'ok');
  } else {
    switchRightView('terminal');
    setStatus('Starting terminal…', 'busy');
    const result = await api.startAgent(agent, {});
    setStatus(result?.ok ? 'Ready' : 'Terminal error', result?.ok ? 'ok' : 'error');
  }

  addActivity('Engine selected', engineDisplayName());
}

function selectedModel() {
  if (els.modelSelect.value === '__custom__') {
    return els.customModelInput.value.trim() || 'Default';
  }
  if (els.modelSelect.value === 'No provider configured') return 'Default';
  return els.modelSelect.value || 'Default';
}

async function applyConfiguration() {
  options = {
    model: selectedModel(),
    subagent: els.agentSelect.value || 'Default',
    effort: els.effortSelect.value || 'default',
    providerId: state.agent === 'provider' ? selectedProviderId : ''
  };

  const session = activeSession();
  if (session) {
    session.agent = state.agent;
    session.providerId = options.providerId;
    session.options = { ...options };
    saveSessions();
  }

  renderChatHeader();

  if (state.agent === 'provider') {
    setStatus('Configuration applied', 'ok');
    addActivity('Provider configuration applied', engineDisplayName() + ' · ' + options.model);
    return;
  }

  if (CLI_AI_TOOLS.includes(state.agent)) {
    const tool = state.tools[state.agent];
    if (tool && !tool.installed) {
      setStatus('Not installed', 'error');
      openSettings('clis');
      return;
    }

    setStatus('Applying configuration…', 'busy');
    const result = await api.startAgent(state.agent, options);
    setStatus(result?.ok ? 'Configuration applied' : 'CLI launch failed', result?.ok ? 'ok' : 'error');
    addActivity('AI configuration applied', engineDisplayName() + (options.model !== 'Default' ? ' · ' + options.model : ''));
    return;
  }

  setStatus('Restarting terminal…', 'busy');
  const result = await api.startAgent(state.agent, options);
  setStatus(result?.ok ? 'Ready' : 'Terminal error', result?.ok ? 'ok' : 'error');
}

function renderCapabilities() {
  els.capabilitiesList.innerHTML = '';

  const addSection = (title, items) => {
    if (!items?.length) return;

    const section = document.createElement('section');
    section.className = 'capability-section';

    const heading = document.createElement('h4');
    heading.textContent = title;

    const row = document.createElement('div');
    row.className = 'capability-chip-row';

    for (const item of items) {
      const button = document.createElement('button');
      button.className = 'capability-chip';
      button.textContent = item.name || item;
      button.title = item.description || '';
      row.appendChild(button);
    }

    section.append(heading, row);
    els.capabilitiesList.appendChild(section);
  };

  addSection(
    'MODELS',
    (currentCapabilities.models || []).map((name) => ({ name }))
  );
  addSection(
    'AGENTS / MODES',
    (currentCapabilities.agents || []).map((name) => ({ name }))
  );
  addSection('COMMANDS', currentCapabilities.commands || []);
  addSection('OPTIONS', currentCapabilities.options || []);

  if (!els.capabilitiesList.children.length) {
    els.capabilitiesList.innerHTML =
      '<div class="empty-panel compact"><b>No extra options detected</b><span>This engine may not expose discoverable CLI capabilities.</span></div>';
  }
}

function normalizeRel(rel) {
  return String(rel || '').replace(/\\/g, '/');
}

function parentFolders(rel) {
  const parts = normalizeRel(rel).split('/');
  parts.pop();
  const parents = [];
  for (let i = 1; i <= parts.length; i++) {
    parents.push(parts.slice(0, i).join('/'));
  }
  return parents;
}

function renderFileTree() {
  els.fileTree.innerHTML = '';

  if (!state.project) {
    els.fileTools.classList.add('hidden');
    return;
  }

  els.fileTools.classList.remove('hidden');
  const query = (els.fileSearch.value || '').trim().toLowerCase();
  const entries = state.project.entries || [];
  let shown = 0;

  for (const entry of entries) {
    const rel = normalizeRel(entry.rel);

    if (!query) {
      const parents = parentFolders(rel);
      if (parents.some((parent) => !expandedFolders.has(parent))) continue;
    } else if (!rel.toLowerCase().includes(query) && !entry.name.toLowerCase().includes(query)) {
      continue;
    }

    const row = document.createElement('div');
    row.className = 'file-entry ' + entry.type;
    row.style.paddingLeft = (7 + Math.min(entry.depth, 6) * 12) + 'px';
    row.title = rel;

    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.textContent =
      entry.type === 'folder'
        ? (expandedFolders.has(rel) ? '⌄' : '›')
        : '·';

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = entry.name;

    row.append(icon, name);

    if (entry.type === 'folder') {
      row.addEventListener('click', () => {
        if (expandedFolders.has(rel)) expandedFolders.delete(rel);
        else expandedFolders.add(rel);
        renderFileTree();
      });
    } else {
      row.addEventListener('dblclick', () => {
        const prefix = els.composer.value.trim();
        els.composer.value = (prefix ? prefix + ' ' : '') + '@' + rel;
        resizeComposer();
        els.composer.focus();
      });
    }

    els.fileTree.appendChild(row);
    shown++;
  }

  els.fileCount.textContent = shown + ' / ' + entries.length;

  if (!shown) {
    els.fileTree.innerHTML =
      '<div class="empty-panel compact"><b>No matching files</b><span>Try another filter.</span></div>';
  }
}

function renderProject(project) {
  const changed = project?.path !== renderedProjectPath;
  state.project = project;
  if (project?.path) state.cwd = project.path;

  if (changed) {
    renderedProjectPath = project?.path || null;
    expandedFolders = new Set();
    els.fileSearch.value = '';
  }

  els.projectName.textContent = project?.name || 'No project selected';
  els.projectPath.textContent = project?.path || 'Choose a folder to start';
  els.projectMeta.innerHTML = '';

  if (!project) {
    els.projectMeta.innerHTML =
      '<div class="empty-panel"><b>No project open</b><span>Select a folder. Nothing is reviewed or modified automatically.</span></div>';
    els.fileTree.innerHTML = '';
    els.fileTools.classList.add('hidden');
    renderChatHeader();
    return;
  }

  const card = document.createElement('div');
  card.className = 'project-card';

  const title = document.createElement('b');
  title.textContent = project.package?.name || project.name;

  const markers = document.createElement('div');
  markers.className = 'marker-row';

  const markerValues = project.markers?.length
    ? project.markers
    : [(project.entries || []).length + ' items indexed'];

  for (const value of markerValues) {
    const marker = document.createElement('span');
    marker.className = 'marker';
    marker.textContent = value;
    markers.appendChild(marker);
  }

  card.append(title, markers);
  els.projectMeta.appendChild(card);
  renderFileTree();
  renderChatHeader();

  const session = activeSession();
  if (session) {
    session.cwd = project.path;
    session.hasProject = true;
    saveSessions();
  }
}

async function pickProject() {
  const project = await api.pickFolder();
  if (!project) return;
  renderProject(project);
  addActivity('Project opened', project.path);
  setStatus('Project ready', 'ok');
}

function buildReviewPrompt() {
  return [
    'Review the currently selected project thoroughly before making any changes.',
    'Inspect its architecture, dependencies, configuration, likely bugs, security and reliability issues, missing pieces, and implementation quality.',
    'Summarize findings clearly, prioritize important issues, and propose a practical next-work plan.',
    'Do not edit, delete, install, or modify files until I explicitly ask after the review.'
  ].join(' ');
}

async function reviewProject() {
  if (!state.project?.path) {
    await pickProject();
    if (!state.project?.path) return;
  }

  if (state.agent === 'powershell' || state.agent === 'cmd') {
    alert('Select Codex, Claude Code, OpenCode, or a custom API provider for project review.');
    return;
  }

  await sendMessage(buildReviewPrompt(), true);
}

function sessionMessagesForProvider(session) {
  return (session?.messages || [])
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .filter((item) => !item.streaming)
    .map((item) => ({
      role: item.role,
      content: String(item.text || '')
    }));
}

async function sendMessage(override, review = false) {
  const text = String(override ?? els.composer.value).trim();
  if (!text || pendingResponse) return;

  if (text.startsWith('/') && await runBuiltinCommand(text)) return;

  if (CLI_AI_TOOLS.includes(state.agent)) {
    const tool = state.tools[state.agent];
    if (tool && !tool.installed) {
      openSettings('clis');
      return;
    }
  }

  if (state.agent === 'provider' && !selectedProviderId) {
    openSettings('providers');
    return;
  }

  const isAI = CLI_AI_TOOLS.includes(state.agent) || state.agent === 'provider';
  const destination = engineDisplayName();
  const userMessageId = addMessage(
    'user',
    text,
    true,
    isAI ? ('Sending to ' + destination + '…') : ('Sending to ' + destination + ' terminal…')
  );

  els.composer.value = '';
  resizeComposer();
  hideCommandSuggestions();

  pendingResponse = isAI;
  setStatus(isAI ? ('Sending to ' + destination + '…') : 'Running…', 'busy');

  if (isAI) {
    els.stopBtn.classList.remove('hidden');
    els.sendBtn.classList.add('hidden');

    let result;
    const session = activeSession();
    const engineKey = state.agent === 'provider'
      ? ('provider:' + selectedProviderId)
      : state.agent;
    const engineSessionId = session?.engineSessionIds?.[engineKey] || '';

    if (state.agent === 'provider') {
      result = await api.sendProviderChat(
        selectedProviderId,
        options.model === 'Default' ? '' : options.model,
        sessionMessagesForProvider(session)
      );
    } else {
      result = await api.sendChat(state.agent, text, {
        ...options,
        engineSessionId
      });
    }

    const sentMessage = session?.messages.find((item) => item.id === userMessageId);
    if (sentMessage) {
      sentMessage.delivery = result?.ok
        ? ('Sent to ' + destination + (state.project?.name ? ' · ' + state.project.name : ''))
        : ('Failed to send to ' + destination);
      saveSessions();
      renderMessages(false);
    }

    if (!result?.ok) {
      pendingResponse = false;
      els.stopBtn.classList.add('hidden');
      els.sendBtn.classList.remove('hidden');
      addMessage(
        'assistant',
        result?.reason || 'The selected AI engine could not start. Check setup and authentication.',
        true
      );
      setStatus('Engine error', 'error');
    }
  } else {
    const ok = await api.send(text + '\r');
    setStatus(ok ? 'Ready' : 'Terminal error', ok ? 'ok' : 'error');
  }

  if (review) addActivity('Project review requested', engineDisplayName());
}

async function runBuiltinCommand(input) {
  const command = input.trim().split(/\s+/)[0].toLowerCase();

  if (command === '/review') {
    await reviewProject();
    return true;
  }

  if (command === '/new') {
    newSession();
    return true;
  }

  if (command === '/clear') {
    const session = activeSession();
    if (session) {
      session.messages = [];
      saveSessions();
      renderMessages(true);
    }
    return true;
  }

  if (command === '/providers') {
    openSettings('providers');
    return true;
  }

  if (command === '/setup') {
    openSettings('clis');
    return true;
  }

  if (command === '/terminal') {
    switchRightView('terminal');
    return true;
  }

  return false;
}

function allCommands() {
  const runtime = (currentCapabilities.commands || []).map((item) => ({
    name: item.name,
    description: item.description || 'Runtime CLI command',
    source: engineDisplayName()
  }));

  const slash = TOOL_SLASH_COMMANDS[state.agent] || [];

  return [...BUILTIN_COMMANDS, ...slash, ...runtime].filter((item, index, array) => {
    return array.findIndex((candidate) => candidate.name === item.name) === index;
  });
}

function renderCommandSuggestions() {
  const value = els.composer.value.trim();
  if (!value.startsWith('/')) {
    hideCommandSuggestions();
    return;
  }

  const query = value.toLowerCase();
  const commands = allCommands()
    .filter((item) =>
      item.name.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query)
    )
    .slice(0, 12);

  els.commandSuggest.innerHTML = '';

  for (const item of commands) {
    const button = document.createElement('button');
    button.className = 'command-item';

    const code = document.createElement('code');
    code.textContent = item.name;
    const description = document.createElement('span');
    description.textContent = item.description;
    const source = document.createElement('em');
    source.textContent = item.source;

    button.append(code, description, source);
    button.addEventListener('click', () => {
      els.composer.value = item.name + ' ';
      resizeComposer();
      hideCommandSuggestions();
      els.composer.focus();
    });

    els.commandSuggest.appendChild(button);
  }

  els.commandSuggest.classList.toggle('hidden', !commands.length);
}

function hideCommandSuggestions() {
  els.commandSuggest.classList.add('hidden');
  els.commandSuggest.innerHTML = '';
}

function openPalette() {
  els.paletteModal.classList.remove('hidden');
  els.paletteSearch.value = '';
  renderPalette('');
  setTimeout(() => els.paletteSearch.focus(), 20);
}

function closePalette() {
  els.paletteModal.classList.add('hidden');
}

function paletteEntries() {
  const entries = allCommands().map((item) => ({
    title: item.name,
    description: item.description,
    source: item.source,
    action: () => {
      if (item.source === 'TermBridge') {
        els.composer.value = item.name;
        sendMessage();
      } else {
        els.composer.value = item.name + ' ';
        els.composer.focus();
      }
    }
  }));

  entries.push(
    {
      title: 'Open project',
      description: 'Choose a project folder',
      source: 'Workspace',
      action: pickProject
    },
    {
      title: 'Review project',
      description: 'Review the project without making changes',
      source: 'Workspace',
      action: reviewProject
    },
    {
      title: 'CLI setup',
      description: 'Detect, install, and configure coding CLIs',
      source: 'Settings',
      action: () => openSettings('clis')
    },
    {
      title: 'Providers & APIs',
      description: 'Configure custom API providers',
      source: 'Settings',
      action: () => openSettings('providers')
    },
    {
      title: 'Refresh detected options',
      description: 'Probe the selected CLI again',
      source: 'Runtime',
      action: async () => {
        await loadEngineCapabilities(false);
        setStatus('Options refreshed', 'ok');
      }
    }
  );

  return entries;
}

function renderPalette(query = '') {
  const value = query.trim().toLowerCase();
  const entries = paletteEntries().filter((item) => {
    if (!value) return true;
    return (item.title + ' ' + item.description + ' ' + item.source)
      .toLowerCase()
      .includes(value);
  });

  els.paletteList.innerHTML = '';

  for (const entry of entries.slice(0, 80)) {
    const button = document.createElement('button');
    button.className = 'palette-item';

    const code = document.createElement('code');
    code.textContent = entry.title;
    const description = document.createElement('span');
    description.textContent = entry.description;
    const source = document.createElement('em');
    source.textContent = entry.source;

    button.append(code, description, source);
    button.addEventListener('click', async () => {
      closePalette();
      await entry.action();
    });

    els.paletteList.appendChild(button);
  }
}

function cleanTerminalRaw(raw) {
  return String(raw || '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '')
    .replace(/\x1b[=>]/g, '')
    .replace(/\r(?!\n)/g, '\n')
    .replace(/[\u0000\u0008]/g, '');
}

function appendTerminal(raw) {
  const nearBottom =
    els.terminalOutput.scrollHeight -
      (els.terminalOutput.scrollTop + els.terminalOutput.clientHeight) <
    70;

  terminalText += cleanTerminalRaw(raw);
  if (terminalText.length > 240000) terminalText = terminalText.slice(-180000);
  els.terminalOutput.textContent = terminalText;

  requestAnimationFrame(() => {
    if (nearBottom) els.terminalOutput.scrollTop = els.terminalOutput.scrollHeight;
  });
}

function renderActivity() {
  els.activityList.innerHTML = '';

  if (!activities.length) {
    els.activityList.innerHTML =
      '<div class="empty-panel compact"><b>No activity yet</b><span>Engine, project, setup, and provider actions appear here.</span></div>';
    return;
  }

  for (const item of activities) {
    const row = document.createElement('div');
    row.className = 'activity-item';

    const title = document.createElement('b');
    title.textContent = item.title;
    const meta = document.createElement('span');
    meta.textContent =
      (item.detail ? item.detail + ' · ' : '') +
      new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    row.append(title, meta);
    els.activityList.appendChild(row);
  }
}

function switchRightView(view) {
  $$('.right-tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });

  $$('.right-view').forEach((panel) => {
    panel.classList.toggle('active', panel.id === view + 'View');
  });
}

function renderAll(forceBottom = false) {
  renderSessions();
  renderToolTabs();
  renderChatHeader();
  renderMessages(forceBottom);
  renderActivity();
  renderCapabilities();
}

function openSettings(tab = 'clis') {
  els.settingsModal.classList.remove('hidden');
  switchSettingsTab(tab);
  renderSetup();
  renderProviders();
}

function closeSettings() {
  els.settingsModal.classList.add('hidden');
}

function switchSettingsTab(tab) {
  $$('.modal-tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
  els.clisTab.classList.toggle('hidden', tab !== 'clis');
  els.providersTab.classList.toggle('hidden', tab !== 'providers');
}

function renderSetup() {
  els.setupList.innerHTML = '';
  let installed = 0;

  for (const id of CLI_AI_TOOLS) {
    const tool = state.tools[id] || { installed: false };
    if (tool.installed) installed++;

    const card = document.createElement('div');
    card.className = 'setup-card';

    const info = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = TOOL_NAMES[id];

    const badge = document.createElement('span');
    badge.className = 'badge ' + (tool.installed ? 'ok' : 'no');
    badge.textContent = tool.installed ? 'Installed' : 'Not installed';
    title.appendChild(badge);

    const description = document.createElement('p');
    description.textContent = tool.installed
      ? (tool.version || 'Detected on PATH. Open it to complete login/configuration if needed.')
      : 'Not found on PATH. TermBridge can install the supported npm CLI when Node.js/npm is available.';

    info.append(title, description);

    const actions = document.createElement('div');
    actions.className = 'setup-actions';

    if (tool.installed) {
      const open = document.createElement('button');
      open.textContent = 'Open / Configure';
      open.addEventListener('click', async () => {
        closeSettings();
        await setEngine(id);
        await launchActiveCli();
      });

      const refresh = document.createElement('button');
      refresh.textContent = 'Refresh options';
      refresh.addEventListener('click', async () => {
        await setEngine(id);
        await loadEngineCapabilities(false);
        renderCapabilities();
        setStatus('Options refreshed', 'ok');
      });

      actions.append(open, refresh);
    } else {
      const install = document.createElement('button');
      install.textContent = 'Install';
      install.addEventListener('click', () => installTool(id));
      actions.appendChild(install);
    }

    if (tool.docs) {
      const docs = document.createElement('button');
      docs.textContent = 'Docs';
      docs.addEventListener('click', () => api.openExternal(tool.docs));
      actions.appendChild(docs);
    }

    card.append(info, actions);
    els.setupList.appendChild(card);
  }

  els.setupSummary.textContent = installed + ' of ' + CLI_AI_TOOLS.length + ' AI CLIs ready';
}

async function installTool(id) {
  closeSettings();
  switchRightView('terminal');
  setStatus('Installing ' + TOOL_NAMES[id] + '…', 'busy');
  addActivity('Installing CLI', TOOL_NAMES[id]);

  const result = await api.installTool(id);
  if (!result?.ok) {
    setStatus('Setup required', 'error');
    alert(result?.reason || 'Installation could not start.');
    openSettings('clis');
  }
}

async function launchActiveCli() {
  if (state.agent === 'provider') {
    openSettings('providers');
    return;
  }

  const tool = state.tools[state.agent];
  if (CLI_AI_TOOLS.includes(state.agent) && tool && !tool.installed) {
    openSettings('clis');
    return;
  }

  switchRightView('terminal');
  setStatus('Opening CLI…', 'busy');
  const result = await api.startAgent(state.agent, options);

  if (result?.ok) {
    setStatus('CLI open', 'ok');
    addActivity('Interactive CLI opened', engineDisplayName());
  } else {
    setStatus('CLI error', 'error');
    if (result?.reason === 'not-installed') openSettings('clis');
  }
}

async function refreshProviders() {
  state.providers = await api.listProviders();
  if (selectedProviderId && !state.providers.some((item) => item.id === selectedProviderId)) {
    selectedProviderId = state.providers[0]?.id || '';
  }
  renderProviders();
  renderToolTabs();
}

function renderProviders() {
  els.providerList.innerHTML = '';

  if (!state.providers.length) {
    els.providerList.innerHTML =
      '<div class="empty-panel compact"><b>No providers</b><span>Add an API provider to use it as a chat engine.</span></div>';
    if (!els.providerId.value) showProviderEditor(null);
    return;
  }

  for (const provider of state.providers) {
    const button = document.createElement('button');
    button.className =
      'provider-item' +
      (provider.id === els.providerId.value ? ' active' : '');

    const title = document.createElement('b');
    title.textContent = provider.name;
    const meta = document.createElement('span');
    meta.textContent = provider.type + ' · ' + provider.baseURL;

    button.append(title, meta);
    button.addEventListener('click', () => showProviderEditor(provider));
    els.providerList.appendChild(button);
  }
}

function resetProviderResult() {
  els.providerResult.classList.add('hidden');
  els.providerResult.textContent = '';
}

function showProviderEditor(provider) {
  resetProviderResult();
  els.providerEmpty.classList.toggle('hidden', Boolean(provider));
  els.providerForm.classList.toggle('hidden', !provider);

  if (!provider) return;

  els.providerId.value = provider.id || '';
  els.providerName.value = provider.name || '';
  els.providerType.value = provider.type || 'openai';
  els.providerBaseUrl.value = provider.baseURL || '';
  els.providerSecretSource.value = provider.secretSource || 'vault';
  els.providerSecretRef.value = provider.secretRef || '';
  els.providerApiKey.value = '';
  els.providerModelsPath.value = provider.modelsPath || '/models';
  els.providerChatPath.value = provider.chatPath || '/chat/completions';
  els.providerDefaultModel.value = provider.defaultModel || '';
  els.providerHeaders.value = JSON.stringify(provider.headers || {}, null, 2);
  els.providerBodyTemplate.value = JSON.stringify(provider.bodyTemplate || { model: '{{model}}', messages: '{{messages}}' }, null, 2);
  els.providerResponsePath.value = provider.responsePath || '';
  updateSecretFields();
  updateProviderTypeFields();
  renderProviders();
}

function newProviderDraft() {
  const draft = {
    id: '',
    name: 'New Provider',
    type: 'openai',
    baseURL: '',
    secretSource: 'vault',
    secretRef: '',
    modelsPath: '/models',
    chatPath: '/chat/completions',
    defaultModel: '',
    headers: {}
  };

  els.providerEmpty.classList.add('hidden');
  els.providerForm.classList.remove('hidden');
  els.providerId.value = '';
  els.providerName.value = draft.name;
  els.providerType.value = draft.type;
  els.providerBaseUrl.value = draft.baseURL;
  els.providerSecretSource.value = draft.secretSource;
  els.providerSecretRef.value = '';
  els.providerApiKey.value = '';
  els.providerModelsPath.value = draft.modelsPath;
  els.providerChatPath.value = draft.chatPath;
  els.providerDefaultModel.value = '';
  els.providerHeaders.value = '{}';
  els.providerBodyTemplate.value = JSON.stringify({ model: '{{model}}', messages: '{{messages}}' }, null, 2);
  els.providerResponsePath.value = '';
  resetProviderResult();
  updateSecretFields();
  updateProviderTypeFields();
}

function updateSecretFields() {
  const source = els.providerSecretSource.value;
  els.apiKeyField.classList.toggle('hidden', source !== 'vault');
  els.providerSecretRef.disabled = source !== 'env';
}

function updateProviderTypeFields() {
  const custom = els.providerType.value === 'custom';
  document.querySelectorAll('.custom-only').forEach((element) => element.classList.toggle('hidden', !custom));
}

function providerFormValue() {
  let headers = {};
  try {
    headers = JSON.parse(els.providerHeaders.value || '{}');
    if (!headers || Array.isArray(headers) || typeof headers !== 'object') {
      throw new Error('Headers must be a JSON object.');
    }
  } catch (error) {
    throw new Error('Extra headers JSON is invalid: ' + error.message);
  }

  let bodyTemplate = {};
  if (els.providerType.value === 'custom') {
    try {
      bodyTemplate = JSON.parse(els.providerBodyTemplate.value || '{}');
      if (!bodyTemplate || Array.isArray(bodyTemplate) || typeof bodyTemplate !== 'object') {
        throw new Error('Body template must be a JSON object.');
      }
    } catch (error) {
      throw new Error('Custom REST body template is invalid: ' + error.message);
    }
  }

  return {
    id: els.providerId.value || undefined,
    name: els.providerName.value.trim(),
    type: els.providerType.value,
    baseURL: els.providerBaseUrl.value.trim(),
    secretSource: els.providerSecretSource.value,
    secretRef: els.providerSecretRef.value.trim(),
    apiKey: els.providerApiKey.value,
    modelsPath: els.providerModelsPath.value.trim() || '/models',
    chatPath: els.providerChatPath.value.trim() || '/chat/completions',
    defaultModel: els.providerDefaultModel.value.trim(),
    headers,
    bodyTemplate,
    responsePath: els.providerResponsePath.value.trim()
  };
}

function showProviderResult(message, kind = 'ok') {
  els.providerResult.classList.remove('hidden');
  els.providerResult.textContent = message;
  els.providerResult.style.color = kind === 'error' ? '#c8475d' : '#566173';
}

async function saveProviderFromForm(event) {
  event.preventDefault();

  try {
    const value = providerFormValue();
    if (!value.name) throw new Error('Provider name is required.');
    if (!value.baseURL) throw new Error('Base URL is required.');

    const saved = await api.saveProvider(value);
    selectedProviderId = saved.id;
    await refreshProviders();
    showProviderEditor(saved);
    showProviderResult('Provider saved securely.');
    addActivity('Provider saved', saved.name);
  } catch (error) {
    showProviderResult(error.message, 'error');
  }
}

async function testSelectedProvider() {
  const id = els.providerId.value;
  if (!id) {
    showProviderResult('Save the provider first, then test it.', 'error');
    return;
  }

  showProviderResult('Testing connection…');
  const result = await api.testProvider(id);

  if (result?.ok) {
    const suffix = result.models?.length
      ? '\nModels: ' + result.models.slice(0, 20).join(', ')
      : '';
    showProviderResult((result.message || 'Connection successful.') + suffix);
    addActivity('Provider connection tested', els.providerName.value);
  } else {
    showProviderResult(result?.error || 'Connection failed.', 'error');
  }
}

async function useSelectedProvider() {
  const id = els.providerId.value;
  if (!id) {
    showProviderResult('Save the provider first.', 'error');
    return;
  }

  selectedProviderId = id;
  closeSettings();
  await setEngine('provider');
  const provider = state.providers.find((item) => item.id === id);
  if (provider?.defaultModel) options.model = provider.defaultModel;
  await loadEngineCapabilities(false);
  renderAll(false);
  addActivity('Provider selected for chat', provider?.name || 'Custom API');
}

async function deleteSelectedProvider() {
  const id = els.providerId.value;
  if (!id) return;
  if (!confirm('Delete this provider configuration?')) return;

  await api.deleteProvider(id);
  if (selectedProviderId === id) selectedProviderId = '';
  await refreshProviders();
  showProviderEditor(null);

  if (state.agent === 'provider' && !state.providers.length) {
    await setEngine('powershell');
  }

  addActivity('Provider deleted', '');
}

function resizeComposer() {
  els.composer.style.height = 'auto';
  els.composer.style.height = Math.min(145, els.composer.scrollHeight) + 'px';
}

els.newChat.addEventListener('click', newSession);
els.projectsNav.addEventListener('click', pickProject);
els.providersNav.addEventListener('click', () => openSettings('providers'));

els.chatSearchBtn.addEventListener('click', () => {
  els.chatSearchWrap.classList.toggle('hidden');
  if (!els.chatSearchWrap.classList.contains('hidden')) els.chatSearch.focus();
});
els.chatSearch.addEventListener('input', renderSessions);

els.projectBtn.addEventListener('click', pickProject);
els.openFolderBtn.addEventListener('click', pickProject);
els.refreshProjectBtn.addEventListener('click', async () => {
  const project = await api.refreshProject();
  renderProject(project);
  addActivity('Project refreshed', project?.path || '');
});
els.fileSearch.addEventListener('input', renderFileTree);

els.commandPaletteBtn.addEventListener('click', openPalette);
els.reviewBtn.addEventListener('click', reviewProject);
els.settingsBtn.addEventListener('click', () => openSettings('clis'));
els.setupBtn.addEventListener('click', () => openSettings('clis'));
els.missingToolAction.addEventListener('click', () => openSettings('clis'));

els.modelSelect.addEventListener('change', updateCustomModelVisibility);
els.applyConfigBtn.addEventListener('click', applyConfiguration);
els.capabilitiesBtn.addEventListener('click', () => switchRightView('capabilities'));

els.sendBtn.addEventListener('click', () => sendMessage());
els.stopBtn.addEventListener('click', async () => {
  await api.stopChat();
  setStatus('Stopping…', 'busy');
});
els.composer.addEventListener('input', () => {
  resizeComposer();
  renderCommandSuggestions();
});
els.composer.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

els.jumpBottom.addEventListener('click', () => {
  els.messages.scrollTop = els.messages.scrollHeight;
  els.jumpBottom.classList.add('hidden');
});
els.messages.addEventListener('scroll', () => {
  const distance =
    els.messages.scrollHeight - (els.messages.scrollTop + els.messages.clientHeight);
  if (distance < 60) els.jumpBottom.classList.add('hidden');
});

$$('.welcome-card').forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action === 'folder') pickProject();
    if (action === 'commands') openPalette();
    if (action === 'providers') openSettings('providers');
  });
});

els.launchCliBtn.addEventListener('click', launchActiveCli);
els.clearTerminal.addEventListener('click', () => {
  terminalText = '';
  els.terminalOutput.textContent = '';
});
els.terminalSend.addEventListener('click', async () => {
  const value = els.terminalInput.value;
  if (!value) return;
  const ok = await api.send(value + '\r');
  if (ok) {
    addActivity('Raw terminal input', value.slice(0, 80));
    els.terminalInput.value = '';
  }
});
els.terminalInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') els.terminalSend.click();
});

$$('.right-tab').forEach((button) => {
  button.addEventListener('click', () => switchRightView(button.dataset.view));
});

$$('[data-session-action]').forEach((button) => {
  button.addEventListener('click', () => sessionAction(button.dataset.sessionAction));
});

document.addEventListener('click', (event) => {
  if (!els.sessionMenu.contains(event.target) && !event.target.closest('.session-more')) {
    hideSessionMenu();
  }
});

els.closeSettings.addEventListener('click', closeSettings);
els.settingsModal.addEventListener('click', (event) => {
  if (event.target === els.settingsModal) closeSettings();
});
$$('.modal-tab').forEach((button) => {
  button.addEventListener('click', () => switchSettingsTab(button.dataset.tab));
});

els.newProviderBtn.addEventListener('click', newProviderDraft);
els.providerForm.addEventListener('submit', saveProviderFromForm);
els.providerSecretSource.addEventListener('change', updateSecretFields);
els.providerType.addEventListener('change', () => {
  updateProviderTypeFields();
  if (els.providerType.value === 'anthropic' && els.providerChatPath.value === '/chat/completions') {
    els.providerChatPath.value = '/messages';
  }
  if (els.providerType.value !== 'anthropic' && els.providerChatPath.value === '/messages') {
    els.providerChatPath.value = '/chat/completions';
  }
});
els.testProviderBtn.addEventListener('click', testSelectedProvider);
els.useProviderBtn.addEventListener('click', useSelectedProvider);
els.deleteProviderBtn.addEventListener('click', deleteSelectedProvider);

els.paletteSearch.addEventListener('input', () => renderPalette(els.paletteSearch.value));
els.paletteModal.addEventListener('click', (event) => {
  if (event.target === els.paletteModal) closePalette();
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openPalette();
  }

  if (event.key === 'Escape') {
    closePalette();
    closeSettings();
    hideCommandSuggestions();
  }
});

api.onData(({ raw, agent }) => {
  appendTerminal(raw);
  if (agent === 'setup') setStatus('Installing…', 'busy');
});

api.onStatus((status) => {
  if (status.status === 'ready') setStatus('Ready', 'ok');
  if (status.status === 'not-installed') setStatus('Not installed', 'error');
  if (status.status === 'error') setStatus('Terminal error', 'error');
});

api.onExit(({ exitCode }) => {
  setStatus('Terminal exited', exitCode === 0 ? 'ok' : 'error');
  addActivity('Terminal exited', 'Exit ' + exitCode);
});

api.onSetupComplete(async ({ agent, exitCode, tools }) => {
  state.tools = tools;
  renderSetup();
  renderToolTabs();

  if (exitCode === 0) {
    setStatus('Installed', 'ok');
    addActivity('CLI installed', TOOL_NAMES[agent]);
    await setEngine(agent);
  } else {
    setStatus('Install failed', 'error');
    addActivity('CLI install failed', TOOL_NAMES[agent] + ' · exit ' + exitCode);
  }
});

api.onProjectChanged((project) => renderProject(project));

api.onChatStatus(({ status, destination, cwd }) => {
  if (status !== 'running') return;

  pendingResponse = true;
  els.stopBtn.classList.remove('hidden');
  els.sendBtn.classList.add('hidden');
  setStatus('Working in ' + (destination || engineDisplayName()) + '…', 'busy');

  streamingText = '';
  streamingAssistantId = uid();

  const session = activeSession();
  if (!session) return;

  const lastUser = [...session.messages].reverse().find((item) => item.role === 'user');
  if (lastUser && String(lastUser.delivery || '').startsWith('Sending')) {
    lastUser.delivery =
      'Sent to ' + (destination || engineDisplayName()) +
      (cwd ? ' · ' + cwd : '');
  }

  session.messages.push({
    id: streamingAssistantId,
    role: 'assistant',
    text: '',
    at: Date.now(),
    streaming: true
  });

  saveSessions();
  renderMessages(false);
});

api.onChatSession(({ agent, sessionId }) => {
  const session = activeSession();
  if (!session || !sessionId) return;
  session.engineSessionIds = session.engineSessionIds || {};
  session.engineSessionIds[agent] = sessionId;
  saveSessions();
  addActivity('AI session linked', (TOOL_NAMES[agent] || agent) + ' · ' + sessionId);
});

api.onChatStream(({ text }) => {
  if (!streamingAssistantId) return;

  streamingText += String(text || '');
  const session = activeSession();
  const message = session?.messages.find((item) => item.id === streamingAssistantId);
  if (!message) return;

  message.text = streamingText.trimStart();
  saveSessions();
  renderMessages(false);
});

api.onChatComplete(({ ok, text, error, code, sessionId, agent }) => {
  const session = activeSession();
  const message = session?.messages.find((item) => item.id === streamingAssistantId);
  const finalText = String(text || streamingText || '').trim();

  if (session && sessionId && agent) {
    session.engineSessionIds = session.engineSessionIds || {};
    session.engineSessionIds[agent] = sessionId;
  }

  if (message) {
    message.streaming = false;
    message.text =
      finalText ||
      (error
        ? error
        : (ok
          ? 'The engine completed but did not return a visible reply.'
          : 'Command failed' + (code != null ? ' (exit ' + code + ')' : '.')));
  } else if (finalText) {
    addMessage('assistant', finalText, false);
  }

  streamingAssistantId = null;
  streamingText = '';
  pendingResponse = false;
  els.stopBtn.classList.add('hidden');
  els.sendBtn.classList.remove('hidden');

  saveSessions();
  renderMessages(false);
  setStatus(ok ? 'Ready' : 'AI error', ok ? 'ok' : 'error');
  addActivity(ok ? 'AI response completed' : 'AI request failed', engineDisplayName());
});

(async function init() {
  state = await api.getState();
  state.providers = Array.isArray(state.providers) ? state.providers : [];

  if (!activeId && !sessions.length) {
    newSession();
  } else if (!activeId && sessions.length) {
    activeId = sessions[0].id;
  }

  const session = activeSession();

  if (session?.agent) state.agent = session.agent;
  if (session?.providerId) selectedProviderId = session.providerId;
  if (session?.options) {
    options = {
      ...options,
      ...session.options
    };
  }

  if (!selectedProviderId && state.providers.length) {
    selectedProviderId = state.providers[0].id;
  }

  if (
    session?.hasProject === true &&
    session.cwd &&
    session.cwd !== state.project?.path
  ) {
    const restored = await api.openProjectPath(session.cwd);
    if (restored) state.project = restored;
  }

  renderProject(state.project || null);
  renderProviders();
  renderSetup();
  await loadEngineCapabilities(false);
  renderAll(true);

  if (state.agent === 'provider') {
    setStatus('API ready', 'ok');
  } else {
    const tool = state.tools[state.agent];
    if (!CLI_AI_TOOLS.includes(state.agent) || tool?.installed) {
      switchRightView('terminal');
      const result = await api.startAgent(state.agent, options);
      setStatus(result?.ok ? (engineDisplayName() + ' ready') : 'Terminal error', result?.ok ? 'ok' : 'error');
    }
  }

  els.composer.focus();
})();
