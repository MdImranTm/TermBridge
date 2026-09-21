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
  'sendBtn','terminalOutput','setupList','providerList','providerForm',
  'paletteModal','capabilitiesList'
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
  'deleteProvider','testProvider','providerModels','onChatSession'
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

if (app.includes("$('.custom-only').forEach")) {
  throw new Error('Invalid single-element selector usage found for custom provider fields.');
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

console.log('Static smoke checks passed.');
console.log('UI ids:', ids.length);
console.log('IPC handlers:', requiredMainHandlers.length);
console.log('Preload APIs:', requiredPreloadMethods.length);
