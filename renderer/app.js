const api = window.termbridge;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const AGENT_NAMES = { powershell:'PowerShell', cmd:'CMD', codex:'Codex', claude:'Claude Code', opencode:'OpenCode' };
const AI_TOOLS = ['codex','claude','opencode'];
let state = { cwd:'', agent:'powershell', tools:{}, project:null };
let options = { model:'Default', subagent:'Default', effort:'default' };
let terminalText = '';
let sessions = loadSessions();
let activeId = localStorage.getItem('termbridge.activeId') || sessions[0]?.id || null;
let menuSessionId = null;
let userPinnedScroll = false;
let pendingResponse = false;
let activity = [];

const els = {
  newChat:$('#newChat'), sessionList:$('#sessionList'), chatSearchBtn:$('#chatSearchBtn'),
  chatSearchWrap:$('#chatSearchWrap'), chatSearch:$('#chatSearch'), setupBtn:$('#setupBtn'), setupSummary:$('#setupSummary'),
  projectBtn:$('#projectBtn'), projectName:$('#projectName'), projectPath:$('#projectPath'), projectMeta:$('#projectMeta'),
  fileTree:$('#fileTree'), reviewBtn:$('#reviewBtn'), refreshProjectBtn:$('#refreshProjectBtn'),
  toolTabs:$('#toolTabs'), modelSelect:$('#modelSelect'), agentSelect:$('#agentSelect'), effortSelect:$('#effortSelect'),
  applyConfigBtn:$('#applyConfigBtn'), welcome:$('#welcome'), messages:$('#messages'), jumpBottom:$('#jumpBottom'),
  composer:$('#composer'), sendBtn:$('#sendBtn'), missingToolBanner:$('#missingToolBanner'),
  missingToolTitle:$('#missingToolTitle'), missingToolText:$('#missingToolText'), missingToolAction:$('#missingToolAction'),
  activeAgentLabel:$('#activeAgentLabel'), terminal:$('#terminalOutput'), terminalInput:$('#terminalInput'),
  terminalSend:$('#terminalSend'), clearTerminal:$('#clearTerminal'), statusText:$('#statusText'), statusDot:$('#statusDot'),
  restartBtn:$('#restartBtn'), activityList:$('#activityList'), setupModal:$('#setupModal'), setupList:$('#setupList'),
  closeSetup:$('#closeSetup'), sessionMenu:$('#sessionMenu')
};

function uid(){ return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+Math.random()).replace(/-/g,'').slice(0,16); }
function loadSessions(){ try{ const v=JSON.parse(localStorage.getItem('termbridge.sessions')||'[]'); return Array.isArray(v)?v:[]; }catch{return [];} }
function saveSessions(){ localStorage.setItem('termbridge.sessions',JSON.stringify(sessions.slice(0,60))); if(activeId)localStorage.setItem('termbridge.activeId',activeId); }
function activeSession(){ return sessions.find(s=>s.id===activeId); }
function addActivity(title, detail=''){ activity.unshift({title,detail,at:Date.now()}); activity=activity.slice(0,100); renderActivity(); }

function newSession(){
  const s={id:uid(),title:'New chat',agent:state.agent||'powershell',cwd:state.cwd||'',createdAt:Date.now(),messages:[],options:{...options}};
  sessions.unshift(s);activeId=s.id;saveSessions();renderAll();addActivity('New chat created',AGENT_NAMES[s.agent]||s.agent);
}
function selectSession(id){
  activeId=id;const s=activeSession();saveSessions();
  if(s){ state.agent=s.agent||state.agent; options={...options,...(s.options||{})}; renderToolTabs(); loadCapabilities(state.agent,false); }
  renderAll();
}
function sessionAction(action){
  const s=sessions.find(x=>x.id===menuSessionId); if(!s)return;
  if(action==='rename'){ const n=prompt('Rename chat',s.title); if(n?.trim())s.title=n.trim().slice(0,80); }
  if(action==='duplicate'){ const c=structuredClone(s);c.id=uid();c.title=s.title+' copy';c.createdAt=Date.now();sessions.unshift(c);activeId=c.id; }
  if(action==='clear'){ if(confirm('Clear all messages in this chat?'))s.messages=[]; }
  if(action==='export'){
    const blob=new Blob([JSON.stringify(s,null,2)],{type:'application/json'});const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download=(s.title||'termbridge-chat').replace(/[^a-z0-9-_]+/gi,'_')+'.json';a.click();URL.revokeObjectURL(a.href);
  }
  if(action==='delete'){
    if(confirm('Delete this chat?')){sessions=sessions.filter(x=>x.id!==s.id);if(activeId===s.id)activeId=sessions[0]?.id||null;if(!activeId)newSession();}
  }
  saveSessions();renderAll();hideSessionMenu();
}

function renderSessions(){
  const q=(els.chatSearch.value||'').toLowerCase().trim();els.sessionList.innerHTML='';
  const list=sessions.filter(s=>!q||(s.title||'').toLowerCase().includes(q));
  if(!list.length){els.sessionList.innerHTML='<div class="empty-small">No matching chats.</div>';return;}
  list.forEach(s=>{
    const row=document.createElement('div');row.className='session-item'+(s.id===activeId?' active':'');
    const main=document.createElement('button');main.className='session-main';
    const title=document.createElement('b');title.textContent=s.title||'New chat';
    const meta=document.createElement('small');meta.textContent=(AGENT_NAMES[s.agent]||s.agent)+' · '+new Date(s.createdAt).toLocaleDateString();
    main.append(title,meta);main.onclick=()=>selectSession(s.id);
    const more=document.createElement('button');more.className='session-more';more.textContent='⋯';
    more.onclick=e=>{e.stopPropagation();showSessionMenu(e,s.id);};
    row.append(main,more);els.sessionList.append(row);
  });
}

function renderMessages(forceBottom=false){
  const s=activeSession();const msgs=s?.messages||[];
  const oldTop=els.messages.scrollTop;const oldHeight=els.messages.scrollHeight;
  const distance=oldHeight-(oldTop+els.messages.clientHeight);
  const shouldFollow=forceBottom || distance<90;
  els.welcome.style.display=msgs.length?'none':'block';
  els.messages.style.display=msgs.length?'block':'none';
  els.messages.innerHTML='';
  msgs.forEach(m=>{
    const row=document.createElement('div');row.className='message '+m.role;
    const avatar=document.createElement('div');avatar.className='avatar';avatar.textContent=m.role==='user'?'YOU':'>_';
    const body=document.createElement('div');body.className='message-body';
    const head=document.createElement('div');head.className='message-head';
    const who=document.createElement('strong');who.textContent=m.role==='user'?'You':(AGENT_NAMES[s?.agent]||'Terminal');
    const time=document.createElement('span');time.textContent=new Date(m.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    const text=document.createElement('div');text.className='message-text';text.textContent=m.text;
    head.append(who,time);body.append(head,text);row.append(avatar,body);els.messages.append(row);
  });
  requestAnimationFrame(()=>{
    if(shouldFollow){els.messages.scrollTop=els.messages.scrollHeight;els.jumpBottom.classList.add('hidden');}
    else {els.messages.scrollTop=oldTop+Math.max(0,els.messages.scrollHeight-oldHeight);els.jumpBottom.classList.remove('hidden');}
  });
}

function addMessage(role,text,forceBottom=false){
  if(!activeId)newSession();const s=activeSession();
  s.messages.push({id:uid(),role,text:String(text||''),at:Date.now()});
  if(role==='user'&&(s.title==='New chat'||!s.title))s.title=String(text).trim().replace(/\s+/g,' ').slice(0,48)||'New chat';
  saveSessions();renderMessages(forceBottom);renderSessions();
}

function renderToolTabs(){
  els.toolTabs.innerHTML='';
  ['powershell','cmd','codex','claude','opencode'].forEach(id=>{
    const t=state.tools[id]||{installed:id==='powershell'||id==='cmd'};
    const b=document.createElement('button');b.className='tool-tab '+(t.installed?'installed':'missing')+(state.agent===id?' active':'');
    b.dataset.agent=id;b.innerHTML='<span class="tiny-dot"></span>'+AGENT_NAMES[id];
    b.onclick=()=>setAgent(id,true);els.toolTabs.append(b);
  });
  const tool=state.tools[state.agent];
  const missing=AI_TOOLS.includes(state.agent)&&tool&&!tool.installed;
  els.missingToolBanner.classList.toggle('hidden',!missing);
  if(missing){els.missingToolTitle.textContent=AGENT_NAMES[state.agent]+' is not installed';els.missingToolText.textContent='Open setup to install or configure this CLI.';}
  els.activeAgentLabel.textContent=AGENT_NAMES[state.agent]||state.agent;
}

async function loadCapabilities(agent,start=true){
  const caps=await api.getCapabilities(agent);
  const models=['Default',...(caps.models||[]).filter(x=>x&&x!=='Default')];
  const agents=['Default',...(caps.agents||[]).filter(x=>x&&x!=='Default')];
  fillSelect(els.modelSelect,models,options.model);
  fillSelect(els.agentSelect,agents,options.subagent);
  els.effortSelect.value=options.effort||'default';
  els.modelSelect.disabled=!AI_TOOLS.includes(agent);
  els.agentSelect.disabled=agent!=='opencode';
  els.effortSelect.disabled=agent!=='codex';
  if(start)await applyConfiguration();
}

function fillSelect(el,items,value){ el.innerHTML='';[...new Set(items)].forEach(x=>{const o=document.createElement('option');o.value=x;o.textContent=x;el.append(o);});el.value=items.includes(value)?value:items[0]; }

async function setAgent(agent,start=true){
  state.agent=agent;const s=activeSession();if(s){s.agent=agent;saveSessions();}
  renderToolTabs();await loadCapabilities(agent,false);
  if(start)await applyConfiguration();
}

async function applyConfiguration(){
  options={model:els.modelSelect.value||'Default',subagent:els.agentSelect.value||'Default',effort:els.effortSelect.value||'default'};
  const s=activeSession();if(s){s.options={...options};saveSessions();}
  terminalText='';els.terminal.textContent='';
  setStatus('Starting…','busy');
  const result=await api.startAgent(state.agent,options);
  if(result?.reason==='not-installed'){setStatus('Not installed','error');openSetup();}
  else if(result?.ok){setStatus('Ready','ok');addActivity('Engine started',(AGENT_NAMES[state.agent]||state.agent)+(options.model!=='Default'?' · '+options.model:''));}
}

function renderProject(project){
  state.project=project;state.cwd=project?.path||state.cwd;
  els.projectName.textContent=project?.name||'Select project folder';
  els.projectPath.textContent=project?.path||'No folder selected';
  els.projectMeta.innerHTML='';
  els.fileTree.innerHTML='';
  if(!project){els.projectMeta.innerHTML='<div class="empty-small">Choose a folder to browse project files.</div>';return;}
  const card=document.createElement('div');card.className='project-card';
  const title=document.createElement('b');title.textContent=project.package?.name||project.name;
  const tags=document.createElement('div');tags.className='marker-row';
  (project.markers||[]).forEach(m=>{const x=document.createElement('span');x.className='marker';x.textContent=m;tags.append(x);});
  card.append(title,tags);els.projectMeta.append(card);
  (project.entries||[]).forEach(e=>{
    const row=document.createElement('div');row.className='file-entry';row.style.paddingLeft=(7+Math.min(e.depth,4)*12)+'px';
    const icon=document.createElement('span');icon.className='file-icon';icon.textContent=e.type==='folder'?'▸':'·';
    const name=document.createElement('span');name.textContent=e.name;row.append(icon,name);els.fileTree.append(row);
  });
  const s=activeSession();if(s){s.cwd=project.path;saveSessions();}
}

async function pickProject(){
  const p=await api.pickFolder();if(!p)return;renderProject(p);addActivity('Project selected',p.path);
  setStatus('Project ready','ok');
}

function buildReviewPrompt(){
  return 'Review the currently selected project thoroughly before making any changes. Inspect its structure, architecture, dependencies, configuration, likely bugs, security/reliability issues, missing pieces, and current implementation quality. Summarize findings clearly, prioritize the most important issues, and suggest a practical next-work plan. Do not edit or delete files unless I explicitly ask after the review.';
}
async function reviewProject(){
  if(!state.project?.path){await pickProject();if(!state.project?.path)return;}
  if(!AI_TOOLS.includes(state.agent)){alert('Select Codex, Claude Code, or OpenCode for project review.');return;}
  sendMessage(buildReviewPrompt(),true);
}

async function sendMessage(override,force=false){
  const text=String(override??els.composer.value).trim();if(!text)return;
  const tool=state.tools[state.agent];if(AI_TOOLS.includes(state.agent)&&tool&&!tool.installed){openSetup();return;}
  addMessage('user',text,true);pendingResponse=true;els.composer.value='';resizeComposer();setStatus('Working…','busy');
  const ok=await api.send(text+'\r');if(!ok)addMessage('assistant','The active terminal is not ready. Open CLI setup and verify the selected tool.',true);
  if(force)addActivity('Project review requested',AGENT_NAMES[state.agent]);
}

function cleanTerminalForChat(raw){
  return String(raw||'').replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g,'').replace(/\x1b[@-_]/g,'').replace(/\r/g,'');
}
let chatBuffer='', chatTimer=null;
function handleTerminal(raw,agent){
  terminalText+=raw;if(terminalText.length>180000)terminalText=terminalText.slice(-140000);
  els.terminal.textContent=terminalText;els.terminal.scrollTop=els.terminal.scrollHeight;
  if(agent==='setup')return;
  if(!pendingResponse||!AI_TOOLS.includes(state.agent))return;
  const clean=cleanTerminalForChat(raw).trim();if(!clean)return;
  chatBuffer+=(chatBuffer?'\n':'')+clean;
  clearTimeout(chatTimer);chatTimer=setTimeout(()=>{
    const v=chatBuffer.trim();chatBuffer='';if(v){addMessage('assistant',v,false);pendingResponse=false;setStatus('Ready','ok');}
  },900);
}

function setStatus(text,kind='ok'){els.statusText.textContent=text;els.statusDot.style.background=kind==='error'?'#ff657a':kind==='busy'?'#f4c861':'#43d89f';}

function renderActivity(){
  els.activityList.innerHTML='';
  if(!activity.length){els.activityList.innerHTML='<div class="empty-small">Commands, setup events and session changes appear here.</div>';return;}
  activity.forEach(a=>{const x=document.createElement('div');x.className='activity-item';const b=document.createElement('b');b.textContent=a.title;const s=document.createElement('span');s.textContent=(a.detail?a.detail+' · ':'')+new Date(a.at).toLocaleTimeString();x.append(b,s);els.activityList.append(x);});
}

function renderAll(){renderSessions();renderMessages(false);renderToolTabs();}

function showSessionMenu(e,id){menuSessionId=id;els.sessionMenu.style.left=Math.min(e.clientX,innerWidth-175)+'px';els.sessionMenu.style.top=Math.min(e.clientY,innerHeight-210)+'px';els.sessionMenu.classList.remove('hidden');}
function hideSessionMenu(){els.sessionMenu.classList.add('hidden');menuSessionId=null;}

function openSetup(){renderSetup();els.setupModal.classList.remove('hidden');}
function closeSetup(){els.setupModal.classList.add('hidden');}
function renderSetup(){
  els.setupList.innerHTML='';let installedCount=0;
  AI_TOOLS.forEach(id=>{
    const t=state.tools[id]||{installed:false,label:AGENT_NAMES[id]};if(t.installed)installedCount++;
    const card=document.createElement('div');card.className='setup-card';
    const info=document.createElement('div');const h=document.createElement('h3');h.textContent=AGENT_NAMES[id];
    const badge=document.createElement('span');badge.className='badge '+(t.installed?'ok':'no');badge.textContent=t.installed?'Installed':'Not installed';h.append(badge);
    const p=document.createElement('p');p.textContent=t.installed?(t.version||'Detected on PATH'):'TermBridge can install this CLI with npm when Node.js/npm is available.';
    info.append(h,p);
    const actions=document.createElement('div');actions.className='setup-actions';
    if(!t.installed){const install=document.createElement('button');install.textContent='Install';install.onclick=()=>installTool(id);actions.append(install);}
    else {const config=document.createElement('button');config.textContent='Open / Configure';config.onclick=async()=>{closeSetup();await setAgent(id,true);};actions.append(config);}
    const docs=document.createElement('button');docs.textContent='Docs';docs.onclick=()=>api.openExternal(t.docs||'');actions.append(docs);
    card.append(info,actions);els.setupList.append(card);
  });
  els.setupSummary.textContent=installedCount+' of '+AI_TOOLS.length+' AI CLIs ready';
}
async function installTool(id){closeSetup();setStatus('Installing '+AGENT_NAMES[id]+'…','busy');addActivity('Installing '+AGENT_NAMES[id],'npm global install');const r=await api.installTool(id);if(!r?.ok){alert(r?.reason||'Installation could not start.');setStatus('Setup needed','error');openSetup();}}

function resizeComposer(){els.composer.style.height='auto';els.composer.style.height=Math.min(150,els.composer.scrollHeight)+'px';}

els.newChat.onclick=newSession;
els.chatSearchBtn.onclick=()=>{els.chatSearchWrap.classList.toggle('hidden');if(!els.chatSearchWrap.classList.contains('hidden'))els.chatSearch.focus();};
els.chatSearch.oninput=renderSessions;
els.setupBtn.onclick=openSetup;els.closeSetup.onclick=closeSetup;els.setupModal.onclick=e=>{if(e.target===els.setupModal)closeSetup();};
els.projectBtn.onclick=pickProject;els.refreshProjectBtn.onclick=async()=>renderProject(await api.refreshProject());
els.reviewBtn.onclick=reviewProject;
els.applyConfigBtn.onclick=applyConfiguration;
els.sendBtn.onclick=()=>sendMessage();
els.composer.oninput=resizeComposer;els.composer.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}};
els.jumpBottom.onclick=()=>{els.messages.scrollTop=els.messages.scrollHeight;els.jumpBottom.classList.add('hidden');};
els.messages.onscroll=()=>{const d=els.messages.scrollHeight-(els.messages.scrollTop+els.messages.clientHeight);if(d<60)els.jumpBottom.classList.add('hidden');};
$$('.quick').forEach(b=>b.onclick=()=>b.dataset.action==='review'?reviewProject():sendMessage(b.dataset.prompt));
els.clearTerminal.onclick=()=>{terminalText='';els.terminal.textContent='';};
els.terminalSend.onclick=()=>{const v=els.terminalInput.value;if(v){api.send(v+'\r');els.terminalInput.value='';addActivity('Raw terminal input',v.slice(0,80));}};
els.terminalInput.onkeydown=e=>{if(e.key==='Enter')els.terminalSend.click();};
els.restartBtn.onclick=async()=>{setStatus('Restarting…','busy');await api.restart();};
els.missingToolAction.onclick=openSetup;
$$('.right-tab').forEach(b=>b.onclick=()=>{$$('.right-tab').forEach(x=>x.classList.toggle('active',x===b));$$('.right-view').forEach(v=>v.classList.toggle('active',v.id===b.dataset.view+'View'));});
$$('[data-session-action]').forEach(b=>b.onclick=()=>sessionAction(b.dataset.sessionAction));
document.addEventListener('click',e=>{if(!els.sessionMenu.contains(e.target)&&!e.target.closest('.session-more'))hideSessionMenu();});

api.onData(({raw,agent})=>handleTerminal(raw,agent));
api.onStatus(s=>{if(s.status==='ready')setStatus('Ready','ok');if(s.status==='not-installed')setStatus('Not installed','error');if(s.status==='error')setStatus('Error','error');});
api.onExit(({exitCode})=>{setStatus('Exited '+exitCode,'error');addActivity('Terminal exited','Code '+exitCode);});
api.onSetupComplete(async ({agent,exitCode,tools})=>{state.tools=tools;renderToolTabs();renderSetup();setStatus(exitCode===0?'Installed':'Install failed',exitCode===0?'ok':'error');addActivity(AGENT_NAMES[agent]+' setup finished','Exit '+exitCode);});
api.onProjectChanged(p=>renderProject(p));

(async function init(){
  state=await api.getState();if(!activeId&&!sessions.length)newSession();if(!activeId&&sessions.length)activeId=sessions[0].id;
  const s=activeSession();if(s?.agent)state.agent=s.agent;if(s?.options)options={...options,...s.options};
  renderProject(state.project);renderAll();renderSetup();await loadCapabilities(state.agent,false);els.composer.focus();
})();