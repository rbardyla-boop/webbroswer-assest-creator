import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createWorld, addPlayer, removePlayer, command, tick, snapshot, TICK_HZ } from '../shared/rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'world.json');
const PORT = Number(process.env.PORT || 8787);
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = loadDb();
const world = createWorld({ mode: 'online' });
const sockets = new Map(); // ws -> { account, charId, playerId }
const rate = new Map();

const server = http.createServer(async (req, res) => {
  try {
    const ip = req.socket.remoteAddress || 'local';
    if (req.url.startsWith('/api/') && !rateLimit(ip)) return json(res, 429, { error: 'rate limited' });
    if (req.method === 'POST' && req.url === '/api/register') return register(req, res);
    if (req.method === 'POST' && req.url === '/api/login') return login(req, res);
    if (req.method === 'GET' && req.url === '/api/classes') return json(res, 200, { ok: true, classes: classList() });
    if (req.method === 'GET' && req.url === '/api/chars') return listChars(req, res);
    if (req.method === 'POST' && req.url === '/api/chars') return createChar(req, res);
    return serveStatic(req, res);
  } catch (err) {
    console.error(err);
    json(res, 500, { error: 'server error' });
  }
});

server.on('upgrade', (req, socket) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname !== '/ws') return socket.destroy();
    const token = url.searchParams.get('token');
    const charId = url.searchParams.get('char');
    const account = accountByToken(token);
    if (!account || !account.chars.includes(charId)) return socket.destroy();
    handshake(req, socket);
    const char = db.characters[charId];
    addPlayer(world, char, charId);
    sockets.set(socket, { account: account.name, charId, playerId: charId, alive: true });
    send(socket, { t: 'hello', id: charId, snapshot: snapshot(world, charId) });
    socket.on('data', buf => handleFrame(socket, buf));
    socket.on('close', () => disconnect(socket));
    socket.on('error', () => disconnect(socket));
  } catch (e) {
    console.error('upgrade failed', e); socket.destroy();
  }
});

setInterval(() => {
  tick(world, 1 / TICK_HZ);
  for (const [ws, meta] of sockets) {
    if (ws.destroyed) { disconnect(ws); continue; }
    send(ws, { t: 'snapshot', snapshot: snapshot(world, meta.playerId) });
  }
}, 1000 / TICK_HZ);

setInterval(saveOnlineChars, 15000);
process.on('SIGINT', () => { saveOnlineChars(); saveDb(); process.exit(0); });
process.on('SIGTERM', () => { saveOnlineChars(); saveDb(); process.exit(0); });

server.listen(PORT, () => {
  console.log(`Starvale MMO server on http://localhost:${PORT}`);
});

function disconnect(ws) {
  const meta = sockets.get(ws); if (!meta) return;
  const p = removePlayer(world, meta.playerId);
  if (p) { db.characters[meta.charId] = serializeChar(p); saveDb(); }
  sockets.delete(ws);
  try { ws.end(); } catch {}
}

function handleFrame(ws, buf) {
  const messages = decodeFrames(buf);
  const meta = sockets.get(ws); if (!meta) return;
  for (const text of messages) {
    let msg; try { msg = JSON.parse(text); } catch { continue; }
    const result = command(world, meta.playerId, msg);
    if (!result.ok) send(ws, { t:'error', error: result.error });
    else if (result.npc) send(ws, { t:'npc', npc: result.npc });
  }
}

function saveOnlineChars() {
  for (const meta of sockets.values()) {
    const p = world.players[meta.playerId]; if (p) db.characters[meta.charId] = serializeChar(p);
  }
  saveDb();
}
function serializeChar(p) {
  const { input, online, kind, buffs, dots, cooldowns, swing, combatTargetId, targetId, duelId, ...rest } = p;
  return { ...rest, instance:null, partyId:null, hp: Math.max(1, Math.floor(p.hp)), mp: Math.floor(p.mp||0), updatedAt: Date.now() };
}

async function register(req,res) {
  const body = await bodyJson(req);
  const name = cleanAccount(body.username);
  const pass = String(body.password || '');
  if (!name || pass.length < 6) return json(res, 400, { error: 'username required; password min 6 chars' });
  if (db.accounts[name]) return json(res, 409, { error: 'account exists' });
  db.accounts[name] = { name, pass: hashPassword(pass), chars: [], tokens: [] };
  saveDb();
  json(res, 200, { ok: true, token: issueToken(name) });
}
async function login(req,res) {
  const body = await bodyJson(req);
  const name = cleanAccount(body.username);
  const a = db.accounts[name];
  if (!a || !verifyPassword(String(body.password || ''), a.pass)) return json(res, 403, { error: 'bad login' });
  json(res, 200, { ok: true, token: issueToken(name) });
}
function listChars(req,res) {
  const a = auth(req); if (!a) return json(res, 403, { error:'auth required' });
  json(res, 200, { ok:true, chars: a.chars.map(id => db.characters[id]).filter(Boolean) });
}
async function createChar(req,res) {
  const a = auth(req); if (!a) return json(res,403,{error:'auth required'});
  if (a.chars.length >= 10) return json(res,400,{error:'character cap reached'});
  const body = await bodyJson(req);
  const charName = cleanChar(body.name);
  const className = String(body.className || 'Warrior');
  if (!charName) return json(res,400,{error:'letters-only character name required'});
  if (Object.values(db.characters).some(c => c.name.toLowerCase() === charName.toLowerCase())) return json(res,409,{error:'name taken'});
  const mod = await import('../shared/rules.mjs');
  const c = mod.createCharacter(charName, className);
  db.characters[c.id] = c; a.chars.push(c.id); saveDb();
  json(res,200,{ok:true,char:c});
}

function auth(req) { const token = (req.headers.authorization || '').replace(/^Bearer\s+/i,''); return accountByToken(token); }
function accountByToken(token) {
  if (!token) return null;
  const now = Date.now();
  for (const a of Object.values(db.accounts)) {
    a.tokens = (a.tokens || []).filter(t => t.expires > now);
    if (a.tokens.some(t => t.value === token)) return a;
  }
  return null;
}
function issueToken(accountName) { const t = crypto.randomBytes(24).toString('hex'); db.accounts[accountName].tokens.push({ value:t, expires: Date.now() + 7*86400e3 }); saveDb(); return t; }
function hashPassword(pass) { const salt = crypto.randomBytes(16).toString('hex'); const hash = crypto.scryptSync(pass, salt, 64).toString('hex'); return `${salt}:${hash}`; }
function verifyPassword(pass, packed) { const [salt, hash] = String(packed).split(':'); const got = crypto.scryptSync(pass, salt, 64).toString('hex'); return crypto.timingSafeEqual(Buffer.from(hash,'hex'), Buffer.from(got,'hex')); }
function classList() { return ['Warrior','Paladin','Hunter','Rogue','Priest','Shaman','Mage','Warlock','Druid']; }

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  let file = pathname.startsWith('/shared/') ? path.join(ROOT, pathname.slice(1)) : path.join(PUBLIC, pathname);
  if (!file.startsWith(ROOT)) return json(res,403,{error:'forbidden'});
  fs.readFile(file, (err, data) => {
    if (err) return notFound(res);
    res.writeHead(200, { 'Content-Type': mime(file), 'Cache-Control':'no-store' });
    res.end(data);
  });
}
function notFound(res){ res.writeHead(404); res.end('not found'); }
function json(res,status,obj){ res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(obj)); }
function bodyJson(req) { return new Promise(resolve => { let s=''; req.on('data', c => { s+=c; if(s.length>1e6) req.destroy(); }); req.on('end', () => { try{ resolve(JSON.parse(s||'{}')); } catch { resolve({}); } }); }); }
function mime(file){ if(file.endsWith('.html')) return 'text/html'; if(file.endsWith('.js')||file.endsWith('.mjs')) return 'text/javascript'; if(file.endsWith('.css')) return 'text/css'; if(file.endsWith('.json')) return 'application/json'; return 'application/octet-stream'; }
function cleanAccount(n){ return String(n||'').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,24); }
function cleanChar(n){ return String(n||'').replace(/[^A-Za-z]/g,'').slice(0,14); }
function loadDb(){ try{return JSON.parse(fs.readFileSync(DB_FILE,'utf8'));}catch{return {accounts:{},characters:{}};} }
function saveDb(){ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }
function rateLimit(ip){ const now=Date.now(); const r=rate.get(ip)||[]; const recent=r.filter(t=>now-t<10000); recent.push(now); rate.set(ip,recent); return recent.length<80; }

function handshake(req, socket) {
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\n' + 'Upgrade: websocket\r\n' + 'Connection: Upgrade\r\n' + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
}
function send(socket, obj) {
  if (socket.destroyed) return;
  const data = Buffer.from(JSON.stringify(obj));
  const len = data.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0]=0x81; header[1]=126; header.writeUInt16BE(len,2); }
  else { header = Buffer.alloc(10); header[0]=0x81; header[1]=127; header.writeBigUInt64BE(BigInt(len),2); }
  socket.write(Buffer.concat([header,data]));
}
function decodeFrames(buf) {
  const out=[]; let off=0;
  while(off+2<=buf.length){ const b1=buf[off++], b2=buf[off++]; const opcode=b1&0x0f; let len=b2&0x7f; const masked=!!(b2&0x80); if(len===126){ if(off+2>buf.length) break; len=buf.readUInt16BE(off); off+=2; } else if(len===127){ if(off+8>buf.length) break; len=Number(buf.readBigUInt64BE(off)); off+=8; } let mask=null; if(masked){ if(off+4>buf.length) break; mask=buf.subarray(off,off+4); off+=4; } if(off+len>buf.length) break; let payload=Buffer.from(buf.subarray(off,off+len)); off+=len; if(mask) for(let i=0;i<payload.length;i++) payload[i]^=mask[i%4]; if(opcode===1) out.push(payload.toString('utf8')); }
  return out;
}
