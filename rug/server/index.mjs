import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Authority, IntentRejected } from './authority.mjs';
import { ArtifactStore, readBinary } from './artifacts.mjs';
import { DNA, EVENT_TYPES, ROLES } from './dna.mjs';
import { IdentityStore } from './identity.mjs';
import { KnowledgePlane } from './knowledge.mjs';
import { Ledger, LedgerConflict } from './ledger.mjs';
import { mergeBranch } from './merge.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dataDir = path.resolve(process.env.RUG_DATA_DIR || path.join(root, 'data'));
const publicDir = path.join(root, 'public');
const port = Number(process.env.PORT || 8787);

const ledger = new Ledger(path.join(dataDir, 'ledger.jsonl'));
const identities = new IdentityStore(path.join(dataDir, 'identities.json'));
const knowledge = new KnowledgePlane(path.join(dataDir, 'knowledge'));
const artifacts = new ArtifactStore(path.join(dataDir, 'artifacts'));
const listeners = new Set();

const authority = new Authority(ledger, {
  onAccepted(event, state) {
    if (event.branch === 'main') knowledge.sync(state);
    const message = JSON.stringify({ type: 'event', event, state });
    for (const client of listeners) {
      if (client.readyState === 1 && client.rugBranch === event.branch) client.send(message);
    }
  }
});

if (authority.state('main').organization) knowledge.sync(authority.state('main'));

function json(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function credentials(req, url) {
  const actor = req.headers['x-rug-actor'] || url.searchParams.get('actor');
  const token = req.headers['x-rug-token'] || url.searchParams.get('token');
  return { actor: actor ? String(actor) : '', token: token ? String(token) : '' };
}

function requireAuth(req, url) {
  const { actor, token } = credentials(req, url);
  if (!identities.authenticate(actor, token)) {
    const error = new Error('Authentication required');
    error.status = 401;
    throw error;
  }
  return actor;
}

function requireBase(body) {
  if (!body.base_hash) {
    const error = new Error('base_hash is required; refresh state before proposing a change');
    error.status = 409;
    throw error;
  }
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function serveStatic(url, res) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const normalized = path.normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(publicDir, normalized);
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'content-type': contentType(file), 'content-length': body.length });
  res.end(body);
  return true;
}

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, service: 'rug-multiplayer', ledger: ledger.verifyBranch('main') });
  }

  if (req.method === 'POST' && url.pathname === '/api/bootstrap') {
    const state = authority.state('main');
    if (state.organization) return json(res, 409, { error: 'ALREADY_BOOTSTRAPPED' });
    const body = await readJson(req);
    const actorId = String(body.actor_id || 'admin');
    const orgName = String(body.organization || 'RUG Organization');
    const first = authority.submit({
      branch: 'main', actor: 'system:bootstrap', type: EVENT_TYPES.ORG_CREATED,
      base_hash: ledger.head('main'), payload: { name: orgName }
    });
    const second = authority.submit({
      branch: 'main', actor: 'system:bootstrap', type: EVENT_TYPES.ACTOR_REGISTERED,
      base_hash: first.event_hash,
      payload: { actor_id: actorId, name: body.name || actorId, kind: 'human', roles: [ROLES.ADMIN, ROLES.HUMAN, ROLES.REVIEWER] }
    });
    const token = identities.issue(actorId);
    return json(res, 201, { actor: actorId, token, head: second.event_hash, state: authority.state('main') });
  }

  const actor = requireAuth(req, url);
  const branch = url.searchParams.get('branch') || 'main';

  if (req.method === 'GET' && url.pathname.startsWith('/api/artifact/')) {
    const digest = url.pathname.slice('/api/artifact/'.length);
    const bytes = artifacts.read(digest);
    if (!bytes) return json(res, 404, { error: 'ARTIFACT_NOT_FOUND' });
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': bytes.length,
      'etag': `"sha256-${digest}"`,
      'cache-control': 'private, immutable, max-age=31536000'
    });
    return res.end(bytes);
  }

  if (req.method === 'POST' && url.pathname === '/api/artifact') {
    const targetBranch = String(req.headers['x-rug-branch'] || 'main');
    const baseHash = String(req.headers['x-rug-base-hash'] || '');
    requireBase({ base_hash: baseHash });
    const bytes = await readBinary(req);
    const stored = artifacts.put(bytes);
    const artifactId = String(req.headers['x-rug-artifact-id'] || `ART-${stored.digest.slice(0, 12)}`);
    const event = authority.submit({
      branch: targetBranch,
      actor,
      type: EVENT_TYPES.ARTIFACT_COMMITTED,
      base_hash: baseHash,
      payload: {
        artifact_id: artifactId,
        name: String(req.headers['x-rug-artifact-name'] || artifactId),
        uri: `rug://sha256/${stored.digest}`,
        digest: stored.digest,
        media_type: String(req.headers['content-type'] || 'application/octet-stream'),
        size: stored.size,
        work_id: req.headers['x-rug-work-id'] ? String(req.headers['x-rug-work-id']) : null
      },
      meta: { client: String(req.headers['x-rug-client'] || 'artifact-api') }
    });
    return json(res, 201, { accepted: true, artifact: { id: artifactId, digest: stored.digest, size: stored.size }, event });
  }

  if (req.method === 'GET' && url.pathname === '/api/dna') return json(res, 200, DNA);
  if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, authority.state(branch));
  if (req.method === 'GET' && url.pathname === '/api/ledger') {
    return json(res, 200, { branch, head: ledger.head(branch), events: ledger.eventsForBranch(branch), verification: ledger.verifyBranch(branch) });
  }
  if (req.method === 'GET' && url.pathname === '/api/branches') return json(res, 200, ledger.listBranches());
  if (req.method === 'GET' && url.pathname === '/api/knowledge') {
    const state = authority.state(branch);
    return json(res, 200, knowledge.search(state, url.searchParams.get('q') || ''));
  }
  if (req.method === 'GET' && url.pathname === '/api/agent/context') {
    const state = authority.state(branch);
    const me = state.actors[actor] || null;
    return json(res, 200, {
      protocol: 'rug/1', branch, head: state.head, dna: DNA, actor: me,
      mission: Object.values(state.missions).filter(m => m.status === 'active'),
      available_work: Object.values(state.work).filter(w => w.status === 'open'),
      my_work: Object.values(state.work).filter(w => w.owner === actor && w.status !== 'complete'),
      constraints: Object.values(state.constraints).filter(c => c.active),
      knowledge: knowledge.list(state),
      pending_decisions: Object.values(state.decisions).filter(d => d.status === 'proposed'),
      health: state.health
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/actors') {
    const body = await readJson(req);
    requireBase(body);
    const event = authority.submit({
      branch: body.branch || 'main', actor, type: EVENT_TYPES.ACTOR_REGISTERED,
      base_hash: body.base_hash,
      payload: { actor_id: body.actor_id, name: body.name, kind: body.kind || 'human', roles: body.roles || [body.kind === 'agent' ? ROLES.AGENT : ROLES.HUMAN] }
    });
    const token = identities.issue(body.actor_id);
    return json(res, 201, { event, credentials: { actor: body.actor_id, token } });
  }

  if (req.method === 'POST' && url.pathname === '/api/intent') {
    const body = await readJson(req);
    requireBase(body);
    const event = authority.submit({
      branch: body.branch || 'main', actor, type: body.type, payload: body.payload || {},
      base_hash: body.base_hash, meta: { ...(body.meta || {}), client: body.client || 'api' }
    });
    return json(res, 201, { accepted: true, event, state: authority.state(body.branch || 'main') });
  }

  if (req.method === 'POST' && url.pathname === '/api/branch') {
    const body = await readJson(req);
    requireBase(body);
    const event = authority.createBranch({ name: body.name, from: body.from || 'main', actor, base_hash: body.base_hash });
    return json(res, 201, { accepted: true, event, state: authority.state(body.name) });
  }

  if (req.method === 'POST' && url.pathname === '/api/merge') {
    const body = await readJson(req);
    requireBase(body);
    const result = mergeBranch(authority, {
      source: body.source,
      target: body.target || 'main',
      actor,
      base_hash: body.base_hash
    });
    return json(res, 201, { accepted: true, ...result });
  }

  return json(res, 404, { error: 'NOT_FOUND' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (serveStatic(url, res)) return;
    json(res, 404, { error: 'NOT_FOUND' });
  } catch (error) {
    const status = error instanceof LedgerConflict ? 409 : error instanceof IntentRejected ? 422 : error.status || 500;
    json(res, status, {
      error: error.code || error.name || 'ERROR', message: error.message,
      current_head: error.currentHead, details: error.details
    });
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/ws') return socket.destroy();
  const { actor, token } = credentials(req, url);
  if (!identities.authenticate(actor, token)) return socket.destroy();
  const branch = url.searchParams.get('branch') || 'main';
  try { ledger.head(branch); } catch { return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, ws => {
    ws.rugActor = actor;
    ws.rugBranch = branch;
    listeners.add(ws);
    ws.send(JSON.stringify({ type: 'snapshot', state: authority.state(branch) }));
    ws.on('close', () => listeners.delete(ws));
  });
});

const sweep = setInterval(() => {
  for (const { name: branch } of ledger.listBranches()) {
    const state = authority.state(branch);
    for (const work of Object.values(state.work)) {
      if (work.owner && work.lease_expires_at && Date.parse(work.lease_expires_at) <= Date.now() && work.status !== 'complete') {
        try {
          authority.submit({
            branch, actor: 'system:bootstrap', type: EVENT_TYPES.LEASE_EXPIRED,
            base_hash: ledger.head(branch), payload: { work_id: work.id, owner: work.owner }
          });
        } catch (error) { console.error('lease sweep rejected', error.message); }
      }
    }
  }
}, 5000);
sweep.unref();

server.listen(port, () => {
  console.log(`RUG multiplayer listening on http://localhost:${port}`);
  console.log(`data: ${dataDir}`);
});
