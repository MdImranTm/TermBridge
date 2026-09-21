const fs = require('fs');

const html = fs.readFileSync('renderer/index.html', 'utf8');
const app = fs.readFileSync('renderer/app.js', 'utf8');
const main = fs.readFileSync('main.js', 'utf8');
const preload = fs.readFileSync('preload.js', 'utf8');

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) {
  throw new Error('Duplicate HTML ids: ' + [...new Set(duplicates)].join(', '));
}

const requiredIds = [
  'newChat','sessionList','projectBtn','projectName','toolTabs',
  'modelSelect','agentSelect','effortSelect','messages','composer',
  'sendBtn','terminalOutput','terminalState','engineSelect','engineBootState','mainGrid',
  'terminalZoomOut','terminalZoomReset','terminalZoomIn','terminalExpand',
  'setupList','providerList','providerForm','paletteModal','capabilitiesList'
];

for (const id of requiredIds) {
  if (!ids.includes(id)) throw new Error('Missing required UI element #' + id);
}

const requiredMainHandlers = [
  'app:state','tools:detect','tools:capabilities','tools:install',
  'folder:pick','project:refresh','agent:start','chat:send',
  'chat:provider-send','chat:stop','terminal:write','terminal:restart',
  'providers:list','providers:save','providers:delete','providers:test',
  'providers:models'
];

for (const handler of requiredMainHandlers) {
  if (!main.includes("'" + handler + "'")) {
    throw new Error('Missing IPC handler ' + handler);
  }
}

const requiredPreloadMethods = [
  'getState','detectTools','getCapabilities','installTool','pickFolder',
  'startAgent','sendChat','sendProviderChat','listProviders','saveProvider',
  'deleteProvider','testProvider','providerModels','onChatSession','onEngineSync'
];

for (const method of requiredPreloadMethods) {
  if (!preload.includes(method + ':')) {
    throw new Error('Missing preload API ' + method);
  }
}

if (!app.includes('window.termbridge')) {
  throw new Error('Renderer is not connected to preload bridge.');
}

if (/Preview only|fake data|simulated/i.test(app)) {
  throw new Error('Preview-only implementation text found in production renderer.');
}

if (/(^|[^$])\$\('\.custom-only'\)\.forEach/.test(app)) {
  throw new Error('Invalid single-element selector usage found for custom provider fields.');
}
if (!app.includes("document.querySelectorAll('.custom-only').forEach")) {
  throw new Error('Custom provider field selector fix is missing.');
}

if (!main.includes("initial: '& ' +")) {
  throw new Error('Interactive AI CLI launch is not using the PowerShell call operator.');
}

if (!main.includes("['run', '--format', 'json']")) {
  throw new Error('OpenCode chat runner is not configured for JSON event output.');
}

if (!main.includes("['session', 'export', detectedSessionId]")) {
  throw new Error('OpenCode missing-output recovery is not present.');
}

if (!main.includes("send('chat:session'")) {
  throw new Error('AI session continuity event is missing.');
}


if (!html.includes('@xterm/xterm/lib/xterm.js') || !html.includes('@xterm/addon-fit/lib/addon-fit.js')) {
  throw new Error('Interactive xterm runtime assets are not wired into the renderer.');
}

if (/\basync\s+async\b/.test(app)) {
  throw new Error('Duplicate async keyword found in renderer.');
}

if (!/\basync\s+function\s+selectSession\s*\(id\)/.test(app)) {
  throw new Error('Chat/session switching must remain async because it restores projects and engines.');
}

const invalidSingleSelectorForEach = [...app.matchAll(/(^|[^$])\$\([^)]+\)\.forEach/gm)];
if (invalidSingleSelectorForEach.length) {
  throw new Error(
    'Single-element selector used with forEach: ' +
    invalidSingleSelectorForEach.map((m) => m[0].trim()).join(', ')
  );
}

if (!app.includes("$('.right-tab').forEach") || !app.includes("$('.right-view').forEach")) {
  throw new Error('Right panel selectors must use the multi-element selector helper.');
}

if (!app.includes("els.engineSelect.addEventListener('change'")) {
  throw new Error('Engine selector change handler is missing.');
}

if (!app.includes('initTerminalUI()') || !app.includes('terminalUI.onData')) {
  throw new Error('Real interactive terminal initialization/input passthrough is missing.');
}

if (!app.includes('scheduleAutoApply()')) {
  throw new Error('Automatic model/agent/reasoning apply behavior is missing.');
}

if (!main.includes('if (terminal === instance) terminal = null')) {
  throw new Error('PTY instance ownership race protection is missing.');
}

if (!main.includes("status: 'starting'") || !main.includes("status: 'ready'")) {
  throw new Error('Terminal Starting/Ready lifecycle events are missing.');
}

if (!main.includes("initialSent = true")) {
  throw new Error('CLI boot readiness must wait until the actual AI command is launched.');
}


if (!main.includes('ensureOpenCodeService') || !main.includes('ensureOpenCodeSession')) {
  throw new Error('Shared OpenCode service/session architecture is missing.');
}

if (!main.includes("'/session/' + encodeURIComponent(sessionId) + '/message'")) {
  throw new Error('OpenCode shared-session message API is missing.');
}

if (!main.includes("'attach'") || !main.includes('opencodeAttachUrl')) {
  throw new Error('OpenCode TUI attach flow is missing.');
}

if (!main.includes("send('engine:sync'")) {
  throw new Error('Engine state synchronization event is missing.');
}

if (!app.includes('api.onEngineSync')) {
  throw new Error('Renderer engine synchronization listener is missing.');
}

if (!app.includes('applyTerminalZoom') || !app.includes('applyTerminalExpanded')) {
  throw new Error('Terminal zoom/expand controls are missing.');
}

console.log('Static smoke checks passed.');
console.log('UI ids:', ids.length);
console.log('IPC handlers:', requiredMainHandlers.length);
console.log('Preload APIs:', requiredPreloadMethods.length);
