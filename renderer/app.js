const api = window.termbridge;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const TOOL_NAMES = {
  powershell: 'PowerShell',
  cmd: 'CMD',
  codex: 'Codex',
  claude: 'Claude Code',
  opencode: 'OpenCode'
};
const AI_TOOLS = ['codex', 'claude', 'opencode'];

const els = {
  newChat: $('#newChat'),
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

  reviewBtn: $('#reviewBtn'),
  statusDot: $('#statusDot'),
  statusText: $('#statusText'),
  restartBtn: $('#restartBtn'),

  toolTabs: $('#toolTabs'),
  modelSelect: $('#modelSelect'),
  customModelInput: $('#customModelInput'),
  agentSelect: $('#agentSelect'),
  effortSelect: $('#effortSelect'),
  applyConfigBtn: $('#applyConfigBtn'),

  chatTitle: $('#chatTitle'),
  chatSubtitle: $('#chatSubtitle'),
  activeAgentLabel: $('#activeAgentLabel'),
  welcome: $('#welcome'),
  messages: $('#messages'),
  jumpBottom: $('#jumpBottom'),
  composer: $('#composer'),
  sendBtn: $('#sendBtn'),
  stopBtn: $('#stopBtn'),
  missingToolBanner: $('#missingToolBanner'),
  missingToolTitle: $('#missingToolTitle'),
  missingToolText: $('#missingToolText'),
  missingToolAction: $('#missingToolAction'),

  terminalOutput: $('#terminalOutput'),
  terminalInput: $('#terminalInput'),
  terminalSend: $('#terminalSend'),
  clearTerminal: $('#clearTerminal'),
  launchCliBtn: $('#launchCliBtn'),
  activityList: $('#activityList'),

  sessionMenu: $('#sessionMenu'),
  setupModal: $('#setupModal'),
  setupList: $('#setupList'),
  closeSetup: $('#closeSetup')
};

let state = { cwd: '', agent: 'powershell', tools: {}, project: null };
let options = { model: 'Default', subagent: 'Default', effort: 'default' };
let sessions = loadSessions();
let activeId = localStorage.getItem('termbridge.activeId') || sessions[0]?.id || null;
let activity = [];
let terminalText = '';
let menuSessionId = null;
let streamingAssistantId = null;
let streamingText = '';
let pendingResponse = false;
let expandedFolders = new Set();
let renderedProjectPath = null;

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random())
    .replace(/-/g, '')
    .slice(0, 18);
}

function loadSessions() {
  try {
    const value = JSON.parse(localStorage.getItem('termbridge.sessions') || '[]');
    return Array.isArray(value) ? value : [];
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
    kind === 'error' ? '#ff687d' :
    kind === 'busy' ? '#f2c15c' :
    '#43d89f';
}

function addActivity(title, detail = '') {
  activity.unshift({ title, detail, at: Date.now() });
  activity = activity.slice(0, 120);
  renderActivity();
}

function newSession() {
  const session = {
    id: uid(),
    title: 'New chat',
    agent: state.agent || 'powershell',
    cwd: state.project?.path || state.cwd || '',
    createdAt: Date.now(),
    messages: [],
    options: { ...options }
  };
  sessions.unshift(session);
  activeId = session.id;
  saveSessions();
  renderAll(true);
  els.composer.focus();
}

async function selectSession(id) {
  activeId = id;
  const session = activeSession();
  if (!session) return;

  if (session.cwd && session.cwd !== state.project?.path) {
    const project = await api.openProjectPath(session.cwd);
    if (project) renderProject(project);
  }

  state.agent = session.agent || state.agent;
  options = { ...options, ...(session.options || {}) };
  saveSessions();
  renderAll(true);
  await loadCapabilities(state.agent, false);
  renderToolTabs();
}

function showSessionMenu(event, id) {
  event.stopPropagation();
  menuSessionId = id;
  const width = 170;
  const height = 180;
  els.sessionMenu.style.left = Math.min(event.clientX, window.innerWidth - width - 10) + 'px';
  els.sessionMenu.style.top = Math.min(event.clientY, window.innerHeight - height - 10) + 'px';
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
    const name = prompt('Rename chat', session.title || 'New chat');
    if (name?.trim()) session.title = name.trim().slice(0, 90);
  }

  if (action === 'duplicate') {
    const copy = JSON.parse(JSON.stringify(session));
    copy.id = uid();
    copy.title = (session.title || 'Chat') + ' copy';
    copy.createdAt = Date.now();
    sessions.unshift(copy);
    activeId = copy.id;
  }

  if (action === 'clear' && confirm('Clear every message in this chat?')) {
    session.messages = [];
  }

  if (action === 'export') {
    const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = (session.title || 'termbridge-chat').replace(/[^a-z0-9-_]+/gi, '_') + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 200);
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
    return (session.title || '').toLowerCase().includes(query) ||
      (TOOL_NAMES[session.agent] || '').toLowerCase().includes(query);
  });

  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-panel compact';
    empty.innerHTML = '<b>No chats found</b><span>Create a new chat or change the search.</span>';
    els.sessionList.appendChild(empty);
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
    meta.textContent = (TOOL_NAMES[session.agent] || session.agent || 'Terminal') +
      ' · ' + new Date(session.createdAt).toLocaleDateString();
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

function renderChatHeader() {
  const session = activeSession();
  els.chatTitle.textContent = session?.title || 'New chat';

  const modelText = options.model && options.model !== 'Default' ? ' · ' + options.model : '';
  const projectText = state.project?.name ? ' · ' + state.project.name : '';
  els.chatSubtitle.textContent = (TOOL_NAMES[state.agent] || state.agent) + modelText + projectText;
  els.activeAgentLabel.textContent = TOOL_NAMES[state.agent] || state.agent;
}

function renderMessages(forceBottom = false) {
  const session = activeSession();
  const messages = session?.messages || [];
  const oldTop = els.messages.scrollTop;
  const distanceFromBottom = els.messages.scrollHeight - (els.messages.scrollTop + els.messages.clientHeight);
  const shouldFollow = forceBottom || distanceFromBottom < 70;

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
    who.textContent = message.role === 'user'
      ? 'You'
      : (TOOL_NAMES[session?.agent] || 'TermBridge');
    const time = document.createElement('span');
    time.textContent = new Date(message.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    head.append(who, time);

    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = message.text || (message.streaming ? 'Working…' : '');

    body.append(head, text);
    row.append(avatar, body);
    els.messages.appendChild(row);
  }

  requestAnimationFrame(() => {
    if (shouldFollow) {
      els.messages.scrollTop = els.messages.scrollHeight;
      els.jumpBottom.classList.add('hidden');
    } else {
      els.messages.scrollTop = oldTop;
      els.jumpBottom.classList.remove('hidden');
    }
  });
}

function addMessage(role, text, forceBottom = false) {
  if (!activeId) newSession();
  const session = activeSession();
  session.messages.push({
    id: uid(),
    role,
    text: String(text || ''),
    at: Date.now()
  });

  if (role === 'user' && (!session.title || session.title === 'New chat')) {
    session.title = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 52) || 'New chat';
  }

  saveSessions();
  renderSessions();
  renderChatHeader();
  renderMessages(forceBottom);
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
    button.innerHTML = '<span class="tiny-dot"></span><span>' + TOOL_NAMES[id] + '</span>';
    button.title = tool.installed ? (tool.version || 'Installed') : 'Not installed';
    button.addEventListener('click', () => setAgent(id));
    els.toolTabs.appendChild(button);
  }

  const selected = state.tools[state.agent];
  const missing = AI_TOOLS.includes(state.agent) && selected && !selected.installed;
  els.missingToolBanner.classList.toggle('hidden', !missing);

  if (missing) {
    els.missingToolTitle.textContent = TOOL_NAMES[state.agent] + ' is not installed';
    els.missingToolText.textContent = 'Use CLI setup to install it and finish sign-in/configuration.';
  }

  renderChatHeader();
}

function fillSelect(select, items, selected) {
  select.innerHTML = '';
  for (const item of [...new Set(items)]) {
    const option = document.createElement('option');
    option.value = item;
    option.textContent = item;
    select.appendChild(option);
  }
  select.value = items.includes(selected) ? selected : items[0];
}

function updateCustomModelVisibility() {
  const custom = els.modelSelect.value === '__custom__';
  els.customModelInput.classList.toggle('hidden', !custom);
}

async function loadCapabilities(agent, apply = false) {
  const isAI = AI_TOOLS.includes(agent);
  const caps = isAI ? await api.getCapabilities(agent) : { models: [], agents: [] };

  const modelList = ['Default', ...(caps.models || []).filter(Boolean)];
  const knownModel = options.model && options.model !== 'Default' && modelList.includes(options.model);

  if (isAI) modelList.push('__custom__');
  fillSelect(els.modelSelect, modelList, knownModel ? options.model : (options.model === 'Default' ? 'Default' : '__custom__'));

  [...els.modelSelect.options].forEach((option) => {
    if (option.value === '__custom__') option.textContent = 'Custom model…';
  });

  if (options.model && options.model !== 'Default' && !knownModel) {
    els.customModelInput.value = options.model;
  }

  const agentList = ['Default', ...(caps.agents || []).filter(Boolean)];
  fillSelect(els.agentSelect, agentList, options.subagent || 'Default');
  els.effortSelect.value = options.effort || 'default';

  els.modelSelect.disabled = !isAI;
  els.customModelInput.disabled = !isAI;
  els.agentSelect.disabled = agent !== 'opencode';
  els.effortSelect.disabled = agent !== 'codex';

  updateCustomModelVisibility();
  if (apply) await applyConfiguration();
}

async function setAgent(agent) {
  state.agent = agent;
  const session = activeSession();
  if (session) {
    session.agent = agent;
    saveSessions();
  }

  await loadCapabilities(agent, false);
  renderToolTabs();

  const tool = state.tools[agent];
  if (AI_TOOLS.includes(agent)) {
    if (tool && !tool.installed) {
      setStatus('Not installed', 'error');
      openSetup();
    } else {
      setStatus('Ready', 'ok');
      addActivity('Engine selected', TOOL_NAMES[agent]);
    }
  } else {
    setStatus('Starting terminal…', 'busy');
    const result = await api.startAgent(agent, {});
    setStatus(result?.ok ? 'Ready' : 'Terminal error', result?.ok ? 'ok' : 'error');
  }
}

function selectedModelValue() {
  if (els.modelSelect.value === '__custom__') {
    return els.customModelInput.value.trim() || 'Default';
  }
  return els.modelSelect.value || 'Default';
}

async function applyConfiguration() {
  options = {
    model: selectedModelValue(),
    subagent: els.agentSelect.value || 'Default',
    effort: els.effortSelect.value || 'default'
  };

  const session = activeSession();
  if (session) {
    session.agent = state.agent;
    session.options = { ...options };
    saveSessions();
  }

  renderChatHeader();

  if (AI_TOOLS.includes(state.agent)) {
    const tool = state.tools[state.agent];
    if (tool && !tool.installed) {
      setStatus('Not installed', 'error');
      openSetup();
      return;
    }
    setStatus('Configuration applied', 'ok');
    addActivity(
      'AI configuration applied',
      (TOOL_NAMES[state.agent] || state.agent) +
        (options.model !== 'Default' ? ' · ' + options.model : '')
    );
    return;
  }

  setStatus('Restarting terminal…', 'busy');
  const result = await api.startAgent(state.agent, options);
  setStatus(result?.ok ? 'Ready' : 'Terminal error', result?.ok ? 'ok' : 'error');
}

function normalizeRel(rel) {
  return String(rel || '').replace(/\\/g, '/');
}

function parentFolders(rel) {
  const parts = normalizeRel(rel).split('/');
  parts.pop();
  const parents = [];
  for (let i = 1; i <= parts.length; i++) parents.push(parts.slice(0, i).join('/'));
  return parents;
}

function renderFileTree() {
  els.fileTree.innerHTML = '';
  const project = state.project;

  if (!project) {
    els.fileTools.classList.add('hidden');
    return;
  }

  els.fileTools.classList.remove('hidden');
  const query = (els.fileSearch.value || '').trim().toLowerCase();
  const entries = project.entries || [];
  let shown = 0;

  for (const entry of entries) {
    const rel = normalizeRel(entry.rel);
    const matches = !query || rel.toLowerCase().includes(query) || entry.name.toLowerCase().includes(query);

    if (!query) {
      const parents = parentFolders(rel);
      const hiddenByCollapsedParent = parents.some((parent) => !expandedFolders.has(parent));
      if (hiddenByCollapsedParent) continue;
    } else if (!matches) {
      continue;
    }

    const row = document.createElement('div');
    row.className = 'file-entry ' + entry.type;
    row.style.paddingLeft = (8 + Math.min(entry.depth, 5) * 13) + 'px';
    row.title = rel;

    const icon = document.createElement('span');
    icon.className = 'file-icon';

    if (entry.type === 'folder') {
      icon.textContent = expandedFolders.has(rel) ? '⌄' : '›';
    } else {
      icon.textContent = '·';
    }

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
        const prefix = els.composer.value.trim() ? els.composer.value.trim() + ' ' : '';
        els.composer.value = prefix + '@' + rel;
        resizeComposer();
        els.composer.focus();
      });
    }

    els.fileTree.appendChild(row);
    shown++;
  }

  els.fileCount.textContent = shown + ' / ' + entries.length;

  if (!shown) {
    const empty = document.createElement('div');
    empty.className = 'empty-panel compact';
    empty.innerHTML = '<b>No matching files</b><span>Try a different filter.</span>';
    els.fileTree.appendChild(empty);
  }
}

function renderProject(project) {
  const projectChanged = project?.path !== renderedProjectPath;
  state.project = project;
  if (project?.path) state.cwd = project.path;

  if (projectChanged) {
    expandedFolders = new Set();
    renderedProjectPath = project?.path || null;
    els.fileSearch.value = '';
  }

  els.projectName.textContent = project?.name || 'No project selected';
  els.projectPath.textContent = project?.path || 'Choose a folder to start';
  els.projectMeta.innerHTML = '';

  if (!project) {
    els.projectMeta.innerHTML =
      '<div class="empty-panel"><div class="empty-icon">▰</div><b>No project open</b><span>Select a folder. TermBridge will not review or modify it until you ask.</span></div>';
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

  for (const marker of project.markers || []) {
    const tag = document.createElement('span');
    tag.className = 'marker';
    tag.textContent = marker;
    markers.appendChild(tag);
  }

  if (!(project.markers || []).length) {
    const tag = document.createElement('span');
    tag.className = 'marker';
    tag.textContent = (project.entries || []).length + ' files indexed';
    markers.appendChild(tag);
  }

  card.append(title, markers);
  els.projectMeta.appendChild(card);
  renderFileTree();
  renderChatHeader();

  const session = activeSession();
  if (session) {
    session.cwd = project.path;
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
    'Inspect its structure, architecture, dependencies, configuration, likely bugs, security and reliability issues, missing pieces, and implementation quality.',
    'Summarize the findings clearly, prioritize the important issues, and propose a practical next-work plan.',
    'Do not edit, delete, install, or modify files until I explicitly ask after the review.'
  ].join(' ');
}

async function reviewProject() {
  if (!state.project?.path) {
    await pickProject();
    if (!state.project?.path) return;
  }

  if (!AI_TOOLS.includes(state.agent)) {
    alert('Select Codex, Claude Code, or OpenCode before reviewing the project.');
    return;
  }

  await sendMessage(buildReviewPrompt(), true);
}

async function sendMessage(override, review = false) {
  const text = String(override ?? els.composer.value).trim();
  if (!text || pendingResponse) return;

  const tool = state.tools[state.agent];
  if (AI_TOOLS.includes(state.agent) && tool && !tool.installed) {
    openSetup();
    return;
  }

  addMessage('user', text, true);
  els.composer.value = '';
  resizeComposer();

  pendingResponse = AI_TOOLS.includes(state.agent);
  setStatus(pendingResponse ? 'Working…' : 'Running…', 'busy');

  if (pendingResponse) {
    els.stopBtn.classList.remove('hidden');
    els.sendBtn.classList.add('hidden');
    const result = await api.sendChat(state.agent, text, options);
    if (!result?.ok) {
      pendingResponse = false;
      els.stopBtn.classList.add('hidden');
      els.sendBtn.classList.remove('hidden');
      addMessage('assistant', 'The selected AI engine could not start. Open CLI setup and verify installation and sign-in.', true);
      setStatus('Engine error', 'error');
    }
  } else {
    const ok = await api.send(text + '\r');
    if (!ok) {
      addMessage('assistant', 'The terminal session is not ready. Restart it or open CLI setup.', true);
      setStatus('Terminal error', 'error');
    } else {
      setStatus('Ready', 'ok');
    }
  }

  if (review) addActivity('Project review requested', TOOL_NAMES[state.agent]);
}

function appendTerminal(raw) {
  const nearBottom =
    els.terminalOutput.scrollHeight -
      (els.terminalOutput.scrollTop + els.terminalOutput.clientHeight) <
    70;

  terminalText += String(raw || '');
  if (terminalText.length > 220000) terminalText = terminalText.slice(-170000);
  els.terminalOutput.textContent = terminalText;

  requestAnimationFrame(() => {
    if (nearBottom) els.terminalOutput.scrollTop = els.terminalOutput.scrollHeight;
  });
}

function renderActivity() {
  els.activityList.innerHTML = '';

  if (!activity.length) {
    els.activityList.innerHTML =
      '<div class="empty-panel compact"><b>No activity yet</b><span>Engine changes, setup events and project actions will appear here.</span></div>';
    return;
  }

  for (const item of activity) {
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

function renderAll(forceBottom = false) {
  renderSessions();
  renderToolTabs();
  renderChatHeader();
  renderMessages(forceBottom);
  renderActivity();
}

function openSetup() {
  renderSetup();
  els.setupModal.classList.remove('hidden');
}

function closeSetup() {
  els.setupModal.classList.add('hidden');
}

function renderSetup() {
  els.setupList.innerHTML = '';
  let installed = 0;

  for (const id of AI_TOOLS) {
    const tool = state.tools[id] || { installed: false, label: TOOL_NAMES[id] };
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
      ? (tool.version || 'Detected on PATH. Open the CLI to complete login or provider configuration if needed.')
      : 'Not found on PATH. Install it here when npm is available, then complete the official sign-in/configuration flow.';

    info.append(title, description);

    const actions = document.createElement('div');
    actions.className = 'setup-actions';

    if (!tool.installed) {
      const install = document.createElement('button');
      install.textContent = 'Install';
      install.addEventListener('click', () => installTool(id));
      actions.appendChild(install);
    } else {
      const configure = document.createElement('button');
      configure.textContent = 'Open / Configure';
      configure.addEventListener('click', async () => {
        closeSetup();
        await setAgent(id);
        await launchActiveCli();
      });
      actions.appendChild(configure);
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

  els.setupSummary.textContent = installed + ' of ' + AI_TOOLS.length + ' AI CLIs ready';
}

async function installTool(id) {
  closeSetup();
  setStatus('Installing ' + TOOL_NAMES[id] + '…', 'busy');
  addActivity('Installing CLI', TOOL_NAMES[id]);
  const result = await api.installTool(id);

  if (!result?.ok) {
    setStatus('Setup required', 'error');
    alert(result?.reason || 'Installation could not start.');
    openSetup();
  }
}

async function launchActiveCli() {
  const tool = state.tools[state.agent];
  if (AI_TOOLS.includes(state.agent) && tool && !tool.installed) {
    openSetup();
    return;
  }

  setStatus('Opening CLI…', 'busy');
  const result = await api.startAgent(state.agent, options);
  if (result?.ok) {
    setStatus('CLI open', 'ok');
    addActivity('Interactive CLI opened', TOOL_NAMES[state.agent]);
  } else {
    setStatus('CLI error', 'error');
    if (result?.reason === 'not-installed') openSetup();
  }
}

function resizeComposer() {
  els.composer.style.height = 'auto';
  els.composer.style.height = Math.min(160, els.composer.scrollHeight) + 'px';
}

els.newChat.addEventListener('click', newSession);
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
els.reviewBtn.addEventListener('click', reviewProject);

els.modelSelect.addEventListener('change', updateCustomModelVisibility);
els.applyConfigBtn.addEventListener('click', applyConfiguration);

els.sendBtn.addEventListener('click', () => sendMessage());
els.stopBtn.addEventListener('click', async () => {
  await api.stopChat();
  setStatus('Stopping…', 'busy');
});
els.composer.addEventListener('input', resizeComposer);
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
    if (button.dataset.action === 'folder') pickProject();
    else if (button.dataset.action === 'review') reviewProject();
    else if (button.dataset.prompt) sendMessage(button.dataset.prompt);
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
  await api.send(value + '\r');
  addActivity('Raw terminal input', value.slice(0, 80));
  els.terminalInput.value = '';
});
els.terminalInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') els.terminalSend.click();
});
els.restartBtn.addEventListener('click', async () => {
  setStatus('Restarting terminal…', 'busy');
  const result = await api.restart();
  setStatus(result?.ok ? 'Ready' : 'Restart failed', result?.ok ? 'ok' : 'error');
});

els.setupBtn.addEventListener('click', openSetup);
els.missingToolAction.addEventListener('click', openSetup);
els.closeSetup.addEventListener('click', closeSetup);
els.setupModal.addEventListener('click', (event) => {
  if (event.target === els.setupModal) closeSetup();
});

$$('.right-tab').forEach((button) => {
  button.addEventListener('click', () => {
    $$('.right-tab').forEach((item) => item.classList.toggle('active', item === button));
    $$('.right-view').forEach((view) => {
      view.classList.toggle('active', view.id === button.dataset.view + 'View');
    });
  });
});

$$('[data-session-action]').forEach((button) => {
  button.addEventListener('click', () => sessionAction(button.dataset.sessionAction));
});

document.addEventListener('click', (event) => {
  if (!els.sessionMenu.contains(event.target) && !event.target.closest('.session-more')) {
    hideSessionMenu();
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
  renderToolTabs();
  renderSetup();
  if (exitCode === 0) {
    setStatus('Installed', 'ok');
    addActivity('CLI installed', TOOL_NAMES[agent]);
  } else {
    setStatus('Install failed', 'error');
    addActivity('CLI install failed', TOOL_NAMES[agent] + ' · exit ' + exitCode);
  }
});

api.onProjectChanged((project) => renderProject(project));

api.onChatStatus(({ status }) => {
  if (status !== 'running') return;

  pendingResponse = true;
  els.stopBtn.classList.remove('hidden');
  els.sendBtn.classList.add('hidden');
  setStatus('Working…', 'busy');

  streamingText = '';
  streamingAssistantId = uid();

  const session = activeSession();
  if (!session) return;

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

api.onChatComplete(({ ok, text, error, code }) => {
  const session = activeSession();
  const message = session?.messages.find((item) => item.id === streamingAssistantId);
  const finalText = String(text || streamingText || '').trim();

  if (message) {
    message.streaming = false;
    message.text =
      finalText ||
      (ok
        ? 'Completed.'
        : 'Command failed' +
          (error ? ': ' + error : code != null ? ' (exit ' + code + ')' : '.'));
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
  addActivity(ok ? 'AI response completed' : 'AI command failed', TOOL_NAMES[state.agent]);
});

(async function init() {
  state = await api.getState();

  if (!activeId && !sessions.length) {
    newSession();
  } else if (!activeId && sessions.length) {
    activeId = sessions[0].id;
  }

  const session = activeSession();
  if (session?.agent) state.agent = session.agent;
  if (session?.options) options = { ...options, ...session.options };

  if (session?.cwd && session.cwd !== state.project?.path) {
    const restored = await api.openProjectPath(session.cwd);
    if (restored) state.project = restored;
  }

  renderProject(state.project || null);
  renderAll(true);
  renderSetup();
  await loadCapabilities(state.agent, false);
  renderToolTabs();

  if (!AI_TOOLS.includes(state.agent)) {
    await api.startAgent(state.agent, options);
  }

  els.composer.focus();
})();
