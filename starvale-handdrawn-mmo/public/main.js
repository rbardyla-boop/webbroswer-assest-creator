import { createWorld, createCharacter, addPlayer, command, tick, snapshot, CLASSES, SPELLS, ITEMS, QUESTS, NPCS, ZONES, xpNeed, dist, zoneAt } from '/shared/rules.mjs';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');
const boot = document.getElementById('boot');
const unitEl = document.getElementById('unit');
const targetEl = document.getElementById('target');
const partyEl = document.getElementById('party');
const questEl = document.getElementById('questPanel');
const bagEl = document.getElementById('bagPanel');
const mapEl = document.getElementById('mapPanel');
const vendorEl = document.getElementById('vendorPanel');
const chatEl = document.getElementById('chat');
const chatInput = document.getElementById('chatInput');
const actionbar = document.getElementById('actionbar');
const toastEl = document.getElementById('toast');
const authEl = document.getElementById('auth');
const createEl = document.getElementById('create');
const charsEl = document.getElementById('chars');
const classSelect = document.getElementById('classSelect');

for (const c of Object.keys(CLASSES)) classSelect.add(new Option(`${c} — ${CLASSES[c].role}`, c));

let mode = 'offline';
let world = null;
let me = null;
let snap = null;
let ws = null;
let token = localStorage.starvaleToken || '';
let camera = { x:0, y:0, zoom:1 };
let keys = { up:false, down:false, left:false, right:false };
let mouse = { x:0, y:0, wx:0, wy:0 };
let openVendor = null;
let selectedNpc = null;
let lastTime = performance.now();
let accumulator = 0;
let chatSeen = 0;
let pending = { party:null, duel:null, trade:null };

resize(); window.addEventListener('resize', resize);

document.getElementById('offlineBtn').onclick = () => startOffline();
document.getElementById('onlineBtn').onclick = () => { authEl.classList.remove('hidden'); if(token) loadChars(); };
document.getElementById('loginBtn').onclick = () => authCall('/api/login');
document.getElementById('registerBtn').onclick = () => authCall('/api/register');
document.getElementById('createCharBtn').onclick = () => createOnlineChar();

async function authCall(path) {
  const username = document.getElementById('user').value;
  const password = document.getElementById('pass').value;
  const r = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username,password}) });
  const j = await r.json(); if(!j.ok) return toast(j.error || 'auth failed');
  token = j.token; localStorage.starvaleToken = token; await loadChars();
}
async function loadChars() {
  const r = await fetch('/api/chars', { headers:{Authorization:`Bearer ${token}`} });
  if (!r.ok) { createEl.classList.remove('hidden'); return; }
  const j = await r.json(); charsEl.innerHTML = '';
  for (const c of j.chars) {
    const div = document.createElement('div'); div.className='char-card';
    div.innerHTML = `<b>${c.name}</b><br>${c.className} · Level ${c.level}<br><button>Enter World</button>`;
    div.querySelector('button').onclick = () => startOnline(c.id);
    charsEl.appendChild(div);
  }
  createEl.classList.remove('hidden');
}
async function createOnlineChar() {
  const name = document.getElementById('charName').value;
  const className = classSelect.value;
  const r = await fetch('/api/chars', { method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body: JSON.stringify({name,className}) });
  const j = await r.json(); if(!j.ok) return toast(j.error || 'create failed');
  await loadChars();
}

function startOffline() {
  mode = 'offline';
  const saved = localStorage.starvaleOfflineChar ? JSON.parse(localStorage.starvaleOfflineChar) : null;
  world = createWorld({ mode:'offline' });
  const c = saved || createCharacter('Adventurer', classSelect.value || 'Warrior');
  me = addPlayer(world, c, c.id);
  me.name = c.name || 'Adventurer';
  boot.classList.add('hidden'); hud.classList.remove('hidden');
  toast('Offline world loaded. Same rules, no account required.');
}
function startOnline(charId) {
  mode = 'online';
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(token)}&char=${encodeURIComponent(charId)}`);
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.t === 'hello') { me = { id: msg.id }; snap = msg.snapshot; boot.classList.add('hidden'); hud.classList.remove('hidden'); toast('Online realm connected.'); }
    if (msg.t === 'snapshot') snap = msg.snapshot;
    if (msg.t === 'npc') { selectedNpc = msg.npc; showNpc(msg.npc); }
    if (msg.t === 'error') toast(msg.error);
  };
  ws.onclose = () => toast('Disconnected from realm.');
}

function resize(){ canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio; ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); }
function loop(now){ const dt = Math.min(0.05,(now-lastTime)/1000); lastTime=now; accumulator += dt; while(accumulator >= 1/20){ step(); accumulator -= 1/20; } draw(); updateUI(); requestAnimationFrame(loop); }
requestAnimationFrame(loop);

function step(){
  if (mode === 'offline' && world && me) { me.input = {...keys}; tick(world,1/20); snap = snapshot(world, me.id); localStorage.starvaleOfflineChar = JSON.stringify(serializeLocal(me)); }
  if (mode === 'online' && ws?.readyState === WebSocket.OPEN) send({type:'input', data:keys});
  const p = myPlayer(); if(p){ camera.x += (p.x-camera.x)*0.12; camera.y += (p.y-camera.y)*0.12; }
}
function serializeLocal(p){ const {input,online,kind,buffs,dots,cooldowns,swing,combatTargetId,targetId,duelId,...rest}=p; return rest; }
function myPlayer(){ return mode==='offline' ? me : snap?.players?.[snap.you]; }
function state(){ return mode==='offline' ? ((world && me) ? snapshot(world, me.id) : null) : snap; }
function send(msg){ if(mode==='offline') { const r=command(world, me.id, msg); if(!r.ok) toast(r.error); else if(r.npc){selectedNpc=r.npc;showNpc(r.npc);} return r; } if(ws?.readyState===WebSocket.OPEN) ws.send(JSON.stringify(msg)); }

window.addEventListener('keydown', e => {
  if (!hud.classList.contains('hidden') && !chatInput.classList.contains('hidden')) {
    if(e.key==='Enter'){ const text=chatInput.value; chatInput.value=''; chatInput.classList.add('hidden'); send({type:'chat', data:{text}}); e.preventDefault(); }
    if(e.key==='Escape') chatInput.classList.add('hidden');
    return;
  }
  if(e.key==='Enter'){ chatInput.classList.remove('hidden'); chatInput.focus(); e.preventDefault(); return; }
  if(e.code==='KeyW'||e.code==='ArrowUp') keys.up=true;
  if(e.code==='KeyS'||e.code==='ArrowDown') keys.down=true;
  if(e.code==='KeyA'||e.code==='ArrowLeft') keys.left=true;
  if(e.code==='KeyD'||e.code==='ArrowRight') keys.right=true;
  if(e.code==='KeyF') interact();
  if(e.code==='KeyB') toggle(bagEl);
  if(e.code==='KeyL') toggle(questEl);
  if(e.code==='KeyM') toggle(mapEl);
  if(e.key>='1'&&e.key<='4') castSlot(Number(e.key)-1);
  if(e.key==='Escape') closeWindows();
});
window.addEventListener('keyup', e => { if(e.code==='KeyW'||e.code==='ArrowUp') keys.up=false; if(e.code==='KeyS'||e.code==='ArrowDown') keys.down=false; if(e.code==='KeyA'||e.code==='ArrowLeft') keys.left=false; if(e.code==='KeyD'||e.code==='ArrowRight') keys.right=false; });
canvas.addEventListener('mousemove', e => { mouse.x=e.clientX; mouse.y=e.clientY; Object.assign(mouse, screenToWorld(e.clientX,e.clientY)); });
canvas.addEventListener('click', e => { const s=state(); if(!s) return; const w=screenToWorld(e.clientX,e.clientY); let best=null,bd=999; for(const m of Object.values(s.mobs||{})){ const d=Math.hypot(m.x-w.wx,m.y-w.wy); if(d<bd&&d<24){bd=d;best=m;} } for(const p of Object.values(s.players||{})){ if(p.id===s.you) continue; const d=Math.hypot(p.x-w.wx,p.y-w.wy); if(d<bd&&d<22){bd=d;best=p;} } for(const n of s.npcs||[]){ const d=Math.hypot(n.x-w.wx,n.y-w.wy); if(d<bd&&d<20){bd=d;best=n;} } if(best){ send({type:'target', data:{id:best.id}}); if(best.kind==='vendor'||best.kind==='quest'||best.kind==='dungeon') { selectedNpc=best; showNpc(best); } } });
canvas.addEventListener('contextmenu', e => { e.preventDefault(); interact(); });

function castSlot(i){ const p=myPlayer(); if(!p) return; const spells = ['attack',...(CLASSES[p.className]?.spells||[])]; const id=spells[i]; if(id) send({type:'cast', data:{spell:id}}); }
function interact(){ const p=myPlayer(); const s=state(); if(!p||!s) return; let id=p.targetId; if(!id){ let near=(s.npcs||[]).find(n=>dist(p,n)<24); if(near) id=near.id; else { const corpse=Object.values(s.mobs||{}).find(m=>m.dead&&dist(p,m)<25); if(corpse) id=corpse.id; } } send({type:'interact', data:{id}}); }
function toggle(el){ el.classList.toggle('hidden'); }
function closeWindows(){ [questEl,bagEl,mapEl,vendorEl].forEach(e=>e.classList.add('hidden')); selectedNpc=null; }

function draw(){
  const s=state(); ctx.clearRect(0,0,innerWidth,innerHeight); drawPaper(); if(!s) return;
  drawWorldBase(); drawRoads(); drawZones(); drawProps();
  const drawables = [...(s.npcs||[]).map(n=>({...n, drawKind:'npc'})), ...Object.values(s.mobs||{}).map(m=>({...m, drawKind:'mob'})), ...Object.values(s.players||{}).map(p=>({...p, drawKind:'player'}))].sort((a,b)=>a.y-b.y);
  for(const d of drawables) drawEntity(d, s.you);
  drawCursor();
}
function worldToScreen(x,y){ const scale=1.06*camera.zoom; return { sx: innerWidth/2 + (x-camera.x)*scale + (y-camera.y)*0.34*scale, sy: innerHeight/2 + (y-camera.y)*0.72*scale - (x-camera.x)*0.16*scale }; }
function screenToWorld(sx,sy){ const scale=1.06*camera.zoom; const X=(sx-innerWidth/2)/scale, Y=(sy-innerHeight/2)/scale; const dy=(Y+0.16*X)/(0.72+0.16*0.34); const dx=X-0.34*dy; return { wx: camera.x+dx, wy: camera.y+dy }; }
function drawPaper(){ const g=ctx.createLinearGradient(0,0,0,innerHeight); g.addColorStop(0,'#6f8b63'); g.addColorStop(.45,'#7e9b6c'); g.addColorStop(1,'#5d754f'); ctx.fillStyle=g; ctx.fillRect(0,0,innerWidth,innerHeight); ctx.globalAlpha=.06; ctx.fillStyle='#170f08'; for(let i=0;i<120;i++){ const x=(i*197)%innerWidth, y=(i*89)%innerHeight; ctx.beginPath(); ctx.arc(x,y,Math.max(6,(i%17)*2),0,Math.PI*2); ctx.fill(); } ctx.globalAlpha=1; }
function drawWorldBase(){ const points=[[-230,-340],[590,-340],[590,210],[-230,210]]; ctx.fillStyle='rgba(95,124,76,.18)'; poly(points); }
function drawZones(){ for(const z of ZONES){ const a=worldToScreen(z.x,z.y), b=worldToScreen(z.x+z.w,z.y+z.h); ctx.save(); ctx.globalAlpha=.10; ctx.fillStyle=z.id==='mirefen'?'#3e7f78':z.id==='thornpeak'?'#b7c4c8':'#bca35d'; ctx.fillRect(Math.min(a.sx,b.sx),Math.min(a.sy,b.sy),Math.abs(b.sx-a.sx),Math.abs(b.sy-a.sy)); ctx.restore(); } }
function drawRoads(){ ctx.lineCap='round'; ctx.lineJoin='round'; sketchPath([[-15,10],[70,28],[140,72],[230,-75],[330,-140],[440,-180]], '#8a6a3f', 22); sketchPath([[0,0],[-80,85],[-140,92]], '#8a6a3f', 18); sketchPath([[0,0],[-70,-115]], '#8a6a3f', 18); }
function drawProps(){ drawTown(); drawForest(-75,-120,10); drawForest(85,45,8); drawMine(-132,90); drawCamp(140,90); drawChapel(238,-78); drawCrypt(250,-86); }
function drawTown(){ for(const [x,y,w,h] of [[-28,-14,34,26],[18,-8,30,24],[-10,24,38,22],[-48,18,28,22]]) drawHouse(x,y,w,h); drawWell(5,9); }
function drawHouse(x,y,w,h){ const p=worldToScreen(x,y); ctx.save(); ctx.translate(p.sx,p.sy); sketchBlob(0,0,w,h,'#9b6d3a'); ctx.fillStyle='#6e3524'; ctx.beginPath(); ctx.moveTo(-w*.6,-h*.35); ctx.lineTo(0,-h*.95); ctx.lineTo(w*.6,-h*.35); ctx.closePath(); ctx.fill(); outlineShape(); ctx.restore(); }
function drawWell(x,y){ const p=worldToScreen(x,y); ctx.save(); ctx.translate(p.sx,p.sy); sketchBlob(0,0,22,13,'#5e6170'); ctx.restore(); }
function drawForest(cx,cy,n){ for(let i=0;i<n;i++){ const x=cx+((i*31)%55)-27, y=cy+((i*47)%45)-22; const p=worldToScreen(x,y); ctx.save(); ctx.translate(p.sx,p.sy); sketchBlob(0,-18,20,36,'#315f37'); sketchLine(0,-2,0,14,'#4a2c1d',5); ctx.restore(); } }
function drawMine(x,y){ const p=worldToScreen(x,y); ctx.save(); ctx.translate(p.sx,p.sy); sketchBlob(0,0,48,28,'#5a5146'); ctx.fillStyle='#15100c'; ctx.fillRect(-14,-10,28,22); ctx.restore(); }
function drawCamp(x,y){ for(let i=0;i<4;i++){ const p=worldToScreen(x+(i%2)*28,y+Math.floor(i/2)*20); ctx.save();ctx.translate(p.sx,p.sy); sketchBlob(0,0,24,20,'#6d4931'); ctx.restore(); } }
function drawChapel(x,y){ const p=worldToScreen(x,y); ctx.save();ctx.translate(p.sx,p.sy); sketchBlob(0,0,52,34,'#a9a197'); sketchLine(-12,-20,0,-44,'#a9a197',7); sketchLine(12,-20,0,-44,'#a9a197',7); ctx.restore(); }
function drawCrypt(x,y){ const p=worldToScreen(x,y); ctx.save();ctx.translate(p.sx,p.sy); sketchBlob(0,0,38,22,'#3b3340'); ctx.fillStyle='#100b15'; ctx.fillRect(-13,-10,26,20); ctx.restore(); }
function drawEntity(e,you){ const p=worldToScreen(e.x,e.y); const isYou=e.id===you; ctx.save(); ctx.translate(p.sx,p.sy); if(e.dead){ ctx.globalAlpha=.65; sketchBlob(0,4,26,10,'#3b3126'); ctx.restore(); return; } if(e.drawKind==='npc'){ sketchBlob(0,-10,18,30, e.kind==='vendor'?'#c99c42':e.kind==='dungeon'?'#80558c':'#d0b064'); sketchLine(-11,-30,11,-30,'#ffe8a3',3); text(e.name,0,-44,'#fff3c2'); } else if(e.drawKind==='mob'){ sketchBlob(0,-8,(e.radius||12)*2,(e.radius||12)*2.2,e.color||'#aaa'); if(e.elite) { ctx.strokeStyle='#ffd874'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(0,-10,(e.radius||12)+5,0,Math.PI*2); ctx.stroke(); } text(`${e.name} ${e.level}`,0,-34,e.boss?'#d695ff':'#fff'); hpbar(e.hp,e.maxHp,-20,10,40); } else { sketchBlob(0,-13,22,34,e.color||'#d98'); sketchLine(Math.cos(e.facing||0)*8,-14+Math.sin(e.facing||0)*8,Math.cos(e.facing||0)*18,-14+Math.sin(e.facing||0)*18,'#22170e',3); text(`${e.name}${isYou?'':` ${e.level}`}`,0,-42,isYou?'#ffd874':'#cce8ff'); hpbar(e.hp,e.maxHp,-23,8,46); if(isYou){ ctx.strokeStyle='#ffd874'; ctx.lineWidth=2; ctx.beginPath();ctx.ellipse(0,1,18,9,0,0,Math.PI*2);ctx.stroke(); } }
  ctx.restore(); }
function drawCursor(){ const w=screenToWorld(mouse.x,mouse.y); const p=worldToScreen(w.wx,w.wy); ctx.strokeStyle='rgba(255,230,150,.4)'; ctx.beginPath();ctx.ellipse(p.sx,p.sy,13,7,0,0,Math.PI*2);ctx.stroke(); }
function sketchBlob(x,y,w,h,color){ ctx.fillStyle=color; ctx.beginPath(); ctx.ellipse(x,y,w/2,h/2,0,0,Math.PI*2); ctx.fill(); outlineShape(); ctx.strokeStyle='rgba(255,255,255,.18)'; ctx.beginPath(); ctx.ellipse(x-w*.08,y-h*.12,w*.28,h*.18,-.2,0,Math.PI*2); ctx.stroke(); }
function sketchLine(x1,y1,x2,y2,color,width=2){ ctx.strokeStyle=color; ctx.lineWidth=width; ctx.lineCap='round'; ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); ctx.strokeStyle='rgba(34,25,18,.6)'; ctx.lineWidth=1; ctx.stroke(); }
function outlineShape(){ ctx.lineWidth=2; ctx.strokeStyle='rgba(31,22,15,.82)'; ctx.stroke(); }
function text(t,x,y,color){ ctx.font='700 12px system-ui'; ctx.textAlign='center'; ctx.strokeStyle='#120d09'; ctx.lineWidth=4; ctx.strokeText(t,x,y); ctx.fillStyle=color; ctx.fillText(t,x,y); }
function hpbar(h,m,x,y,w){ ctx.fillStyle='#1a100c'; ctx.fillRect(x,y,w,5); ctx.fillStyle='#b84035'; ctx.fillRect(x,y,w*Math.max(0,h/m),5); ctx.strokeStyle='#120d09'; ctx.lineWidth=1; ctx.strokeRect(x,y,w,5); }
function sketchPath(points,color,width){ ctx.strokeStyle='rgba(35,25,15,.25)'; ctx.lineWidth=width+6; ctx.beginPath(); for(let i=0;i<points.length;i++){ const p=worldToScreen(points[i][0],points[i][1]); if(i)ctx.lineTo(p.sx,p.sy);else ctx.moveTo(p.sx,p.sy); } ctx.stroke(); ctx.strokeStyle=color; ctx.lineWidth=width; ctx.beginPath(); for(let i=0;i<points.length;i++){ const p=worldToScreen(points[i][0],points[i][1]); if(i)ctx.lineTo(p.sx,p.sy);else ctx.moveTo(p.sx,p.sy); } ctx.stroke(); }
function poly(points){ ctx.beginPath(); points.forEach(([x,y],i)=>{const p=worldToScreen(x,y); if(i)ctx.lineTo(p.sx,p.sy); else ctx.moveTo(p.sx,p.sy);}); ctx.closePath();ctx.fill(); }

function updateUI(){ const s=state(); const p=myPlayer(); if(!s||!p) return; unitEl.innerHTML = `<b>${p.name}</b> <span class="gold">Lv ${p.level} ${p.className}</span><div class="bar"><div class="fill" style="width:${pct(p.hp,p.maxHp)}%"></div></div><span>${Math.floor(p.hp)}/${p.maxHp} HP</span>${p.maxMp?`<div class="bar"><div class="fill mana" style="width:${pct(p.mp,p.maxMp)}%"></div></div><span>${Math.floor(p.mp)}/${p.maxMp} Mana</span>`:''}<div class="bar"><div class="fill xp" style="width:${pct(p.xp,xpNeed(p.level))}%"></div></div><span class="dim">${p.xp}/${xpNeed(p.level)} XP · ${coin(p.coin)}</span><br><span class="dim">${zoneAt(p.x,p.y).name}</span>`;
  const target = p.targetId && (s.mobs[p.targetId] || s.players[p.targetId] || (s.npcs||[]).find(n=>n.id===p.targetId));
  targetEl.innerHTML = target ? targetHtml(target,p) : '<span class="dim">No target. Click a mob, player, vendor, quest giver, or the crypt gate.</span>';
  partyEl.innerHTML = partyHtml(s,p); actionbarHtml(p); questHtml(p); bagHtml(p); mapHtml(s,p); chatHtml(s); handleEvents(s); }
function targetHtml(t,p){ let h=`<b>${t.name}</b> ${t.level?`<span class="dim">Lv ${t.level}</span>`:''}`; if(t.maxHp) h+=`<div class="bar"><div class="fill" style="width:${pct(t.hp,t.maxHp)}%"></div></div>`; if(t.kind==='vendor'||t.kind==='quest'||t.kind==='dungeon') h+=`<div class="social"><button onclick="__game.interact()">Interact</button></div>`; if(t.kind==='player'||t.className) h+=`<div class="social"><button onclick="__game.invite('${t.name}')">Party</button><button onclick="__game.duel('${t.name}')">Duel</button><button onclick="__game.trade('${t.name}')">Trade</button></div>`; return h; }
function partyHtml(s,p){ if(!p.partyId) return '<b>Party</b><br><span class="dim">Solo. Target player → Party or /invite name.</span>'; const party=s.parties[p.partyId]; return '<b>Party</b>'+party.members.map(id=>{const m=s.players[id]; return m?`<br>${m.name} <span class="dim">${Math.floor(m.hp)}/${m.maxHp}</span>`:'';}).join(''); }
function actionbarHtml(p){ const spells=['attack',...(CLASSES[p.className]?.spells||[])].slice(0,4); actionbar.innerHTML=spells.map((id,i)=>`<button class="slot" onclick="__game.cast('${id}')"><b>${i+1}</b>${SPELLS[id].name}<small>${Math.ceil(p.cooldowns?.[id]||0)||''}</small></button>`).join(''); }
function questHtml(p){ questEl.innerHTML='<h2>Quest Log</h2>'+Object.entries(p.quests||{}).map(([id,log])=>{const q=QUESTS[id]; return `<div class="quest"><b>${q.name}</b> <span class="dim">${log.status}</span><p>${q.text}</p>${q.objectives.map((o,i)=>`<div>${o.type} ${o.target}: ${log.progress[i]||0}/${o.count}</div>`).join('')}${log.status==='ready'?`<button onclick="__game.complete('${id}')">Turn In</button>`:''}</div>`;}).join('') || '<span class="dim">No active quests. Talk to Mayor Brindle or Brother Aldric.</span>'; }
function bagHtml(p){ bagEl.innerHTML=`<h2>Bags</h2><div class="dim">${coin(p.coin)} · ${p.bag.length}/24 slots</div>`+p.bag.map((id,i)=>{const it=ITEMS[id]; return `<div class="bag-row"><span>${it?.rare?'🔵 ':''}${it?.name||id}<br><small class="dim">${it?.slot||it?.type||'item'}</small></span><span>${it?.slot?`<button onclick="__game.equip(${i})">Equip</button>`:''}${it?.heal||it?.mana?`<button onclick="__game.use(${i})">Use</button>`:''}</span></div>`;}).join(''); }
function mapHtml(s,p){ mapEl.innerHTML='<h2>World Map</h2>'+ZONES.map(z=>`<div class="quest"><b>${z.name}</b> <span class="dim">${z.min}-${z.max}</span><br>${z.desc}</div>`).join('')+`<p><span class="map-dot"></span> You: ${Math.round(p.x)}, ${Math.round(p.y)}</p><p class="dim">Crypt gate: east/northeast ruined chapel.</p>`; }
function chatHtml(s){ const rows=[...(s.chats||[]), ...(s.events||[]).filter(e=>e.kind==='system'||e.kind==='quest'||e.kind==='level')].slice(-8); chatEl.innerHTML=rows.map(e=>`<div><span class="${e.party?'green':e.kind==='quest'?'gold':'dim'}">${e.party?'[Party]':e.from?e.from:e.kind}</span> ${e.text}</div>`).join(''); }
function showNpc(npc){ if(!npc) return; if(npc.kind==='vendor'){ vendorEl.classList.remove('hidden'); vendorEl.innerHTML=`<h2>${npc.name}</h2>`+(npc.vendor||[]).map(id=>`<div class="vendor-row"><span>${ITEMS[id].name}<br><small class="dim">${coin(ITEMS[id].price||0)}</small></span><button onclick="__game.buy('${npc.id}','${id}')">Buy</button></div>`).join(''); } else if(npc.kind==='quest'){ vendorEl.classList.remove('hidden'); vendorEl.innerHTML=`<h2>${npc.name}</h2>`+(npc.quests||[]).map(id=>`<div class="quest"><b>${QUESTS[id].name}</b><p>${QUESTS[id].text}</p><button onclick="__game.accept('${id}')">Accept</button></div>`).join(''); } else if(npc.kind==='dungeon'){ vendorEl.classList.remove('hidden'); vendorEl.innerHTML=`<h2>${npc.name}</h2><p>Private party instance. Tough elite undead and Morthen the Gravecaller.</p><button onclick="__game.enterDungeon()">Enter Hollow Crypt</button>`; } }
function handleEvents(s){ for(const e of s.events||[]){ if(e.time && e.time>chatSeen){ chatSeen=e.time; if(e.kind==='partyInvite'){ pending.party=e.from; toast(`${e.fromName} invites you. Press Accept in target panel.`); targetEl.innerHTML += `<div class="social"><button onclick="__game.acceptParty()">Accept Party</button></div>`; } if(e.kind==='duelInvite'){ pending.duel=e.from; toast(`${e.fromName} challenges you to a duel.`); targetEl.innerHTML += `<div class="social"><button onclick="__game.acceptDuel()">Accept Duel</button></div>`; } if(e.kind==='tradeInvite'){ pending.trade=e.from; toast(`${e.fromName} wants to trade.`); targetEl.innerHTML += `<div class="social"><button onclick="__game.acceptTrade()">Accept Trade</button></div>`; } if(e.text && (e.kind==='level'||e.kind==='quest')) toast(e.text); } } }
function pct(a,b){ return Math.max(0,Math.min(100,(a/b)*100)); } function coin(c){ return `${Math.floor(c/100)}g ${Math.floor((c%100)/10)}s ${c%10}c`; } function toast(t){ toastEl.textContent=t; clearTimeout(toast._t); toast._t=setTimeout(()=>toastEl.textContent='',2600); }

window.__game = { interact, cast:(id)=>send({type:'cast',data:{spell:id}}), buy:(npcId,itemId)=>send({type:'buy',data:{npcId,itemId}}), accept:(questId)=>send({type:'acceptQuest',data:{questId}}), complete:(questId)=>send({type:'chat',data:{text:`/complete ${questId}`}}), use:(slot)=>send({type:'useItem',data:{slot}}), equip:(slot)=>send({type:'equip',data:{slot}}), invite:(name)=>send({type:'invite',data:{name}}), duel:(name)=>send({type:'duel',data:{name}}), trade:(name)=>send({type:'trade',data:{name}}), acceptParty:()=>send({type:'acceptParty',data:{fromId:pending.party}}), acceptDuel:()=>send({type:'acceptDuel',data:{fromId:pending.duel}}), acceptTrade:()=>send({type:'acceptTrade',data:{fromId:pending.trade}}), enterDungeon:()=>send({type:'enterDungeon',data:{dungeon:'hollow_crypt'}}) };
