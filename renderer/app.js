const api = window.termbridge;

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const els = {
  newChat: $('#newChat'),
  sessionList: $('#sessionList'),
  projectBtn: $('#projectBtn'),
  projectName: $('#projectName'),
  messages: $('#messages'),
  welcome: $('#welcome'),
  composer: $('#composer'),
  sendBtn: $('#sendBtn'),
  terminal: $('#terminalOutput'),
  clearTerminal: $('#clearTerminal'),
  statusText: $('#statusText'),
  statusDot: $('#statusDot'),
  activeAgentLabel: $('#activeAgentLabel'),
  restartBtn: $('#restartBtn')
};

const AGENT_NAMES = {
  powershell: 'PowerShell',
  cmd: 'CMD',
  codex: 'Codex',
  claude: 'Claude'
};

let appState = { cwd: '', agent: 'powershell' };
let terminalText = '';
let assistantBuffer = '';
let assistantTimer = null;
let lastSent = '';

let sessions = loadSessions();
let activeId = localStorage.getItem('termbridge.activeId') || sessions[0]?.id || null;

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/-/g, '').slice(0, 16);
}

function loadSessions() {
  try {
    const data = JSON.parse(localStorage.getItem('termbridge.sessions') || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveSessions() {
  localStorage.setItem('termbridge.sessions', JSON.stringify(sessions.slice(0, 30)));
  if (activeId) localStorage.setItem('termbridge.activeId', activeId);
}

function activeSession() {
  return sessions.find(s => s.id === activeId);
}

function newSession() {
  const s = {
    id: uid(),
    title: 'New terminal chat',
    agent: appState.agent || 'powershell',
    cwd: appState.cwd || '',
    createdAt: Date.now(),
    messages: []
  };
  sessions.unshift(s);
  activeId = s.id;
  saveSessions();
  renderAll();
}

function selectSession(id) {
  activeId = id;
  const s = activeSession();
  if (s?.agent) setAgent(s.agent, false);
  saveSessions();
  renderAll();
}

function renderSessions() {
  els.sessionList.innerHTML = '';
  if (!sessions.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:#555e70;font-size:11px;padding:10px;';
    empty.textContent = 'No conversations yet';
    els.sessionList.appendChild(empty);
    return;
  }
  sessions.forEach(s => {
    const b = document.createElement('button');
    b.className = 'session-item' + (s.id === activeId ? ' active' : '');
    b.innerHTML = '';
    const title = document.createElement('div');
    title.textContent = s.title || 'Terminal chat';
    const meta = document.createElement('small');
    meta.textContent = AGENT_NAMES[s.agent] || 'Terminal';
    b.append(title, meta);
    b.addEventListener('click', () => selectSession(s.id));
    els.sessionList.appendChild(b);
  });
}

function addMessage(role, text) {
  if (!activeId) newSession();
  const s = activeSession();
  s.messages.push({ id: uid(), role, text: String(text || ''), at: Date.now() });
  if (role === 'user' && (s.title === 'New terminal chat' || !s.title)) {
    s.title = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 42) || 'Terminal chat';
  }
  saveSessions();
  renderMessages();
  renderSessions();
}

function renderMessages() {
  const s = activeSession();
  const messages = s?.messages || [];
  const hasMessages = messages.length > 0;

  els.welcome.style.display = hasMessages ? 'none' : 'block';
  els.messages.style.display = hasMessages ? 'block' : 'none';
  els.messages.innerHTML = '';

  for (const m of messages) {
    const row = document.createElement('div');
    row.className = 'message ' + m.role;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = m.role === 'user' ? 'YOU' : 'TB';

    const body = document.createElement('div');
    body.className = 'message-body';

    const head = document.createElement('div');
    head.className = 'message-head';

    const strong = document.createElement('strong');
    strong.textContent = m.role === 'user' ? 'You' : (AGENT_NAMES[s?.agent] || 'Terminal');

    const time = document.createElement('span');
    time.textContent = new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = m.text;

    head.append(strong, time);
    body.append(head, text);
    row.append(avatar, body);
    els.messages.appendChild(row);
  }

  requestAnimationFrame(() => {
    els.messages.scrollTop = els.messages.scrollHeight;
  });
}

function renderAll() {
  renderSessions();
  renderMessages();
}

function cleanForChat(text) {
  return String(text || '')
    .replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, '')
    .replace(/\r/g, '')
    .replace(/^\s*PS [^>]+>\s*/gm, '')
    .replace(/^\s*Microsoft Windows \[Version[^\n]*\]\s*/gmi, '')
    .replace(/^\s*Copyright \(C\) Microsoft Corporation[^\n]*\s*/gmi, '')
    .trim();
}

function queueAssistant(text) {
  const cleaned = cleanForChat(text);
  if (!cleaned) return;

  const withoutEcho = lastSent && cleaned.trim() === lastSent.trim() ? '' : cleaned;
  if (!withoutEcho) return;

  assistantBuffer += (assistantBuffer ? '\n' : '') + withoutEcho;
  clearTimeout(assistantTimer);
  assistantTimer = setTimeout(() => {
    const value = assistantBuffer.trim();
    assistantBuffer = '';
    if (value) addMessage('assistant', value);
  }, 700);
}

async function sendMessage(textOverride) {
  const text = String(textOverride ?? els.composer.value).trim();
  if (!text) return;

  if (!activeId) newSession();
  addMessage('user', text);
  lastSent = text;

  els.composer.value = '';
  resizeComposer();

  els.statusText.textContent = 'Working…';
  els.statusDot.style.background = '#f6c761';

  try {
    await api.send(text + '\r');
  } catch (err) {
    addMessage('assistant', 'Could not send to the terminal: ' + (err?.message || err));
  }
}

async function setAgent(agent, restart = true) {
  appState.agent = agent;
  $$('.agent').forEach(b => b.classList.toggle('active', b.dataset.agent === agent));
  els.activeAgentLabel.textContent = (AGENT_NAMES[agent] || agent) + ' session';

  const s = activeSession();
  if (s) {
    s.agent = agent;
    saveSessions();
    renderSessions();
  }

  if (restart) {
    terminalText = '';
    els.terminal.textContent = '';
    els.statusText.textContent = 'Starting…';
    await api.startAgent(agent);
  }
}

function resizeComposer() {
  els.composer.style.height = 'auto';
  els.composer.style.height = Math.min(160, els.composer.scrollHeight) + 'px';
}

els.newChat.addEventListener('click', newSession);

els.projectBtn.addEventListener('click', async () => {
  const folder = await api.pickFolder();
  if (!folder) return;
  appState.cwd = folder;
  els.projectName.textContent = folder.split(/[\\/]/).filter(Boolean).pop() || folder;
  const s = activeSession();
  if (s) {
    s.cwd = folder;
    saveSessions();
  }
});

$$('.agent').forEach(btn => btn.addEventListener('click', () => setAgent(btn.dataset.agent, true)));

els.sendBtn.addEventListener('click', () => sendMessage());

els.composer.addEventListener('input', resizeComposer);
els.composer.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

$$('.quick').forEach(btn => btn.addEventListener('click', () => sendMessage(btn.dataset.prompt)));

els.clearTerminal.addEventListener('click', () => {
  terminalText = '';
  els.terminal.textContent = '';
});

els.restartBtn.addEventListener('click', async () => {
  els.statusText.textContent = 'Restarting…';
  await api.restart();
});

api.onData(({ raw, clean }) => {
  terminalText += raw || clean || '';
  if (terminalText.length > 120000) terminalText = terminalText.slice(-90000);
  els.terminal.textContent = terminalText;
  els.terminal.scrollTop = els.terminal.scrollHeight;

  queueAssistant(clean);

  els.statusText.textContent = 'Ready';
  els.statusDot.style.background = '#42d392';
});

api.onStatus((status) => {
  appState = { ...appState, ...status };
  els.statusText.textContent = status.status === 'ready' ? 'Ready' : status.status;
  els.statusDot.style.background = '#42d392';
  if (status.cwd) {
    els.projectName.textContent = status.cwd.split(/[\\/]/).filter(Boolean).pop() || status.cwd;
  }
});

api.onExit(({ exitCode }) => {
  els.statusText.textContent = 'Exited (' + exitCode + ')';
  els.statusDot.style.background = '#ff6b7a';
});

(async function init() {
  appState = await api.getState();
  if (!activeId && !sessions.length) newSession();
  const current = activeSession();
  if (current?.agent) appState.agent = current.agent;
  els.projectName.textContent = (appState.cwd || '').split(/[\\/]/).filter(Boolean).pop() || 'Home folder';
  await setAgent(appState.agent || 'powershell', true);
  renderAll();
  els.composer.focus();
})();
