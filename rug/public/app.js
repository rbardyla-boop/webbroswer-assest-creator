const $ = sel => document.querySelector(sel);
const authView = $('#auth');
const appView = $('#app');
let state = null;
let ws = null;
let currentBranch = 'main';

const credentials = {
  get actor() { return localStorage.getItem('rug.actor') || ''; },
  get token() { return localStorage.getItem('rug.token') || ''; },
  set(actor, token) {
    localStorage.setItem('rug.actor', actor);
    localStorage.setItem('rug.token', token);
  },
  clear() {
    localStorage.removeItem('rug.actor');
    localStorage.removeItem('rug.token');
  }
};

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (credentials.actor) headers['x-rug-actor'] = credentials.actor;
  if (credentials.token) headers['x-rug-token'] = credentials.token;
  if (options.body && !headers['content-type']) headers['content-type'] = 'application/json';
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.message || data.error || `HTTP ${res.status}`);
    error.data = data;
    error.status = res.status;
    throw error;
  }
  return data;
}

function text(node, value) { node.textContent = value ?? ''; return node; }
function node(tag, className, value) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (value !== undefined) n.textContent = value;
  return n;
}
function clear(target) { target.replaceChildren(); }
function empty(target, message = 'Nothing here yet.') { target.append(node('div', 'empty', message)); }
function fmt(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
function shortHash(value) { return value && value !== 'GENESIS' ? `${value.slice(0, 10)}…${value.slice(-6)}` : value || 'GENESIS'; }

function makeCard(title, body, meta = [], actions = []) {
  const c = node('article', 'card');
  c.append(text(node('h4'), title));
  if (body) c.append(text(node('p'), body));
  if (meta.length) c.append(text(node('div', 'meta'), meta.filter(Boolean).join(' · ')));
  if (actions.length) {
    const a = node('div', 'actions');
    for (const action of actions) {
      const b = text(node('button', action.danger ? 'danger' : 'ghost'), action.label);
      b.type = 'button';
      b.onclick = action.run;
      a.append(b);
    }
    c.append(a);
  }
  return c;
}

function showAuthError(error) {
  $('#auth-error').textContent = error?.data ? JSON.stringify(error.data, null, 2) : error?.message || String(error || '');
}

function showIntentError(error) {
  $('#intent-result').textContent = error?.data ? JSON.stringify(error.data, null, 2) : error.message;
}

function saveSession(actor, token) {
  credentials.set(actor, token);
  $('#actor-badge').textContent = actor;
}

async function bootstrap(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const result = await api('/api/bootstrap', {
      method: 'POST', body: JSON.stringify(Object.fromEntries(form))
    });
    saveSession(result.actor, result.token);
    enterWorld();
  } catch (error) { showAuthError(error); }
}

async function login(event) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.currentTarget));
  credentials.set(form.actor, form.token);
  try {
    await api('/api/state?branch=main');
    enterWorld();
  } catch (error) {
    credentials.clear();
    showAuthError(error);
  }
}

async function loadBranches() {
  const branches = await api('/api/branches');
  const select = $('#branch-select');
  const previous = currentBranch;
  clear(select);
  for (const branch of branches) {
    const option = node('option');
    option.value = branch.name;
    option.textContent = `${branch.name} · ${shortHash(branch.head)}`;
    if (branch.name === previous) option.selected = true;
    select.append(option);
  }
  if (![...select.options].some(o => o.value === previous)) currentBranch = 'main';
  renderBranches(branches);
}

async function loadState() {
  state = await api(`/api/state?branch=${encodeURIComponent(currentBranch)}`);
  render();
}

function connectSocket() {
  if (ws) ws.close();
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL(`${proto}//${location.host}/ws`);
  url.searchParams.set('actor', credentials.actor);
  url.searchParams.set('token', credentials.token);
  url.searchParams.set('branch', currentBranch);
  ws = new WebSocket(url);
  const indicator = $('#connection');
  indicator.textContent = 'connecting';
  indicator.classList.remove('online');
  ws.onopen = () => { indicator.textContent = 'live'; indicator.classList.add('online'); };
  ws.onclose = () => { indicator.textContent = 'offline'; indicator.classList.remove('online'); };
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.state) {
      state = msg.state;
      render();
      loadBranches().catch(console.error);
    }
  };
}

async function enterWorld() {
  authView.hidden = true;
  appView.hidden = false;
  $('#actor-badge').textContent = credentials.actor;
  try {
    await loadBranches();
    await loadState();
    connectSocket();
  } catch (error) {
    credentials.clear();
    appView.hidden = true;
    authView.hidden = false;
    showAuthError(error);
  }
}

function renderHealth() {
  const target = $('#health-bars');
  clear(target);
  for (const [name, value] of Object.entries(state.health || {})) {
    const wrap = node('div', `health ${value >= 70 ? 'good' : value >= 40 ? 'mid' : 'low'}`);
    wrap.append(text(node('div'), `${name.replaceAll('_', ' ')} ${Number(value).toFixed(Number.isInteger(value) ? 0 : 1)}`));
    const track = node('div', 'health-track');
    const fill = node('div', 'health-fill');
    fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
    track.append(fill);
    wrap.append(track);
    target.append(wrap);
  }
}

async function submitIntent(type, payload, options = {}) {
  const result = await api('/api/intent', {
    method: 'POST',
    body: JSON.stringify({
      branch: currentBranch,
      type,
      payload,
      base_hash: state.head,
      client: options.client || 'browser'
    })
  });
  state = result.state;
  render();
  return result;
}

async function downloadArtifact(item) {
  const res = await fetch(`/api/artifact/${encodeURIComponent(item.digest)}`, {
    headers: { 'x-rug-actor': credentials.actor, 'x-rug-token': credentials.token }
  });
  if (!res.ok) throw new Error(`Artifact download failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = item.name || item.id || item.digest;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderWorld() {
  const read = $('#read-lane');
  const understand = $('#understand-lane');
  const grow = $('#grow-lane');
  clear(read); clear(understand); clear(grow);

  const observations = Object.values(state.observations || {});
  for (const item of observations.slice().reverse()) {
    read.append(makeCard(item.claim || item.id, item.source ? `Source: ${fmt(item.source)}` : '', [item.actor, item.confidence !== null ? `confidence ${item.confidence}` : '']));
  }
  if (!observations.length) empty(read, 'No observations.');

  const works = Object.values(state.work || {});
  for (const item of works) {
    const actions = [];
    if (item.status === 'open') {
      actions.push({ label: 'Claim', run: () => submitIntent('WORK_CLAIMED', {
        work_id: item.id,
        lease_expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString()
      }).catch(showIntentError) });
    }
    if (item.owner === credentials.actor && item.status !== 'complete') {
      actions.push({ label: 'Complete', run: () => submitIntent('WORK_COMPLETED', { work_id: item.id }).catch(showIntentError) });
      actions.push({ label: 'Release', run: () => submitIntent('WORK_RELEASED', { work_id: item.id }).catch(showIntentError) });
    }
    understand.append(makeCard(item.title || item.id, item.description, [
      item.id,
      `status ${item.status}`,
      item.owner ? `owner ${item.owner}` : 'unowned',
      item.dependencies?.length ? `deps ${item.dependencies.join(',')}` : ''
    ], actions));
  }
  if (!works.length) empty(understand, 'No work items.');

  const acceptedKnowledge = Object.values(state.knowledge || {}).filter(k => k.status === 'accepted');
  const artifacts = Object.values(state.artifacts || {});
  for (const item of acceptedKnowledge) grow.append(makeCard(item.title, item.body, [item.id, `promoted by ${item.promoted_by}`]));
  for (const item of artifacts) {
    grow.append(makeCard(item.name || item.id, item.uri, [item.id, shortHash(item.digest), item.size != null ? `${item.size} bytes` : ''], [
      { label: 'Download', run: () => downloadArtifact(item).catch(showIntentError) }
    ]));
  }
  if (!acceptedKnowledge.length && !artifacts.length) empty(grow, 'Nothing committed or promoted yet.');

  $('#read-count').textContent = observations.length;
  $('#understand-count').textContent = works.length;
  $('#grow-count').textContent = acceptedKnowledge.length + artifacts.length;
}

function renderActors() {
  const target = $('#actors');
  clear(target);
  const actors = Object.values(state.actors || {});
  for (const actor of actors) {
    const status = state.agents?.[actor.id];
    const item = node('div', 'actor');
    const title = node('strong');
    title.append(node('span', 'dot'), document.createTextNode(actor.name || actor.id));
    item.append(title);
    item.append(text(node('small'), `${actor.kind} · ${(actor.roles || []).join(', ')}`));
    if (status) item.append(text(node('div', 'meta'), `${status.status}${status.claim ? ` · ${status.claim}` : ''}`));
    target.append(item);
  }
  if (!actors.length) empty(target, 'No actors registered.');
}

function renderDecisions() {
  const target = $('#decisions');
  clear(target);
  const pending = Object.values(state.decisions || {}).filter(d => d.status === 'proposed');
  for (const decision of pending) {
    const actions = [];
    if (decision.proposer !== credentials.actor) {
      actions.push({ label: 'Approve', run: () => submitIntent('DECISION_APPROVED', { decision_id: decision.id }).catch(showIntentError) });
      actions.push({ label: 'Reject', danger: true, run: () => submitIntent('DECISION_REJECTED', { decision_id: decision.id, reason: 'Rejected from operations surface' }).catch(showIntentError) });
    }
    target.append(makeCard(decision.title, decision.proposal, [decision.id, `proposer ${decision.proposer}`], actions));
  }
  if (!pending.length) empty(target, 'No pending decisions.');
}

function renderTimeline() {
  const target = $('#timeline');
  clear(target);
  const timeline = (state.timeline || []).slice().reverse().slice(0, 250);
  for (const item of timeline) {
    const row = node('div', 'timeline-event');
    row.append(text(node('span'), `#${item.seq}`));
    row.append(text(node('span'), `${item.type}\n${item.actor}`));
    row.append(text(node('span'), shortHash(item.hash)));
    target.append(row);
  }
  $('#head').textContent = shortHash(state.head);
}

function renderKnowledge() {
  const target = $('#knowledge');
  clear(target);
  const q = $('#knowledge-search').value.trim().toLowerCase();
  const accepted = Object.values(state.knowledge || {}).filter(k => k.status === 'accepted' && (!q || `${k.title} ${k.body} ${JSON.stringify(k.provenance)}`.toLowerCase().includes(q)));
  for (const item of accepted) target.append(makeCard(item.title, item.body, [item.id, ...(item.provenance || []).map(p => fmt(p))]));
  if (!accepted.length) empty(target, q ? 'No matching accepted knowledge.' : 'No accepted knowledge yet.');
}

async function mergeIntoMain(source) {
  try {
    const main = await api('/api/state?branch=main');
    const result = await api('/api/merge', {
      method: 'POST',
      body: JSON.stringify({ source, target: 'main', base_hash: main.head })
    });
    $('#intent-result').textContent = `MERGED ${source} → main\n${result.summary.event_hash}`;
    await loadBranches();
    if (currentBranch === 'main') await loadState();
  } catch (error) { showIntentError(error); }
}

function renderBranches(branches = null) {
  const target = $('#branches');
  if (!target || !branches) return;
  clear(target);
  for (const branch of branches) {
    const actions = [];
    if (branch.name !== 'main') actions.push({ label: 'Merge into main', run: () => mergeIntoMain(branch.name) });
    target.append(makeCard(branch.name, branch.name === currentBranch ? 'current world' : '', [shortHash(branch.head)], actions));
  }
}

function renderMission() {
  const missions = Object.values(state.missions || {}).filter(m => m.status === 'active');
  const mission = missions.at(-1);
  $('#org-name').textContent = state.organization?.name || 'RUG Organization';
  $('#mission-title').textContent = mission?.title || 'No mission yet';
  $('#mission-desc').textContent = mission?.description || 'Create one to begin.';
  const victory = $('#victory');
  victory.className = 'victory';
  if (!mission) {
    victory.textContent = '';
    return;
  }
  const result = state.victory?.[mission.id];
  if (!result || result.total === 0) {
    victory.textContent = 'No machine-checkable victory conditions declared.';
  } else if (result.won) {
    victory.textContent = `MISSION WON · ${result.met}/${result.total} conditions true`;
    victory.classList.add('won');
  } else {
    victory.textContent = `VICTORY STATE · ${result.met}/${result.total} conditions true`;
  }
}

function render() {
  if (!state) return;
  renderMission();
  renderHealth();
  renderWorld();
  renderActors();
  renderDecisions();
  renderTimeline();
  renderKnowledge();
}

const examples = {
  MISSION_CREATED: () => ({
    mission_id: `MISSION-${Date.now()}`,
    title: 'Make the thing work',
    description: 'A real objective whose useful artifact is the victory state.',
    goals: ['working output', 'verified evidence'],
    success_conditions: [
      { path: 'artifacts.OUTPUT', op: 'exists' },
      { path: 'health.integrity', op: 'gte', value: 80 }
    ]
  }),
  WORK_CREATED: () => ({ work_id: `WORK-${Date.now()}`, mission_id: Object.keys(state?.missions || {})[0] || null, title: 'Investigate next blocker', description: 'Take one bounded piece of the mission.', exclusive: true, dependencies: [] }),
  WORK_CLAIMED: () => ({ work_id: Object.keys(state?.work || {})[0] || 'WORK-ID', lease_expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString() }),
  WORK_RELEASED: () => ({ work_id: Object.keys(state?.work || {})[0] || 'WORK-ID' }),
  WORK_BLOCKED: () => ({ work_id: Object.keys(state?.work || {})[0] || 'WORK-ID', reason: 'Need a prerequisite or human decision' }),
  WORK_COMPLETED: () => ({ work_id: Object.keys(state?.work || {})[0] || 'WORK-ID' }),
  OBSERVATION_RECORDED: () => ({ observation_id: `OBS-${Date.now()}`, claim: 'A new fact or report entered the world.', source: 'human observation', confidence: 0.6 }),
  EVIDENCE_ATTACHED: () => ({ work_id: Object.keys(state?.work || {})[0] || 'WORK-ID', ref: 'rug://sha256/example', digest: null, note: 'Evidence supporting the work.' }),
  DECISION_PROPOSED: () => ({ decision_id: `DEC-${Date.now()}`, title: 'Approve next move', proposal: 'Proceed with the proposed state change.', evidence: [] }),
  DECISION_APPROVED: () => ({ decision_id: Object.keys(state?.decisions || {})[0] || 'DEC-ID' }),
  DECISION_REJECTED: () => ({ decision_id: Object.keys(state?.decisions || {})[0] || 'DEC-ID', reason: 'Insufficient evidence' }),
  ARTIFACT_COMMITTED: () => ({ artifact_id: `ART-${Date.now()}`, name: 'Output artifact', uri: 'rug://sha256/example', digest: '0'.repeat(64), media_type: 'text/plain' }),
  KNOWLEDGE_PROPOSED: () => ({ knowledge_id: `KNOW-${Date.now()}`, title: 'Validated lesson', body: 'What the organization should know after this work.', provenance: ['ledger:event-or-artifact'] }),
  KNOWLEDGE_PROMOTED: () => ({ knowledge_id: Object.keys(state?.knowledge || {})[0] || 'KNOW-ID' }),
  KNOWLEDGE_RETRACTED: () => ({ knowledge_id: Object.keys(state?.knowledge || {})[0] || 'KNOW-ID', reason: 'Superseded or disproven' }),
  CONSTRAINT_SET: () => ({ constraint_id: `CON-${Date.now()}`, rule: 'Do not exceed the agreed budget.', severity: 'hard' }),
  CONSTRAINT_CLEARED: () => ({ constraint_id: Object.keys(state?.constraints || {})[0] || 'CON-ID' }),
  AGENT_STATUS_SET: () => ({ status: 'working', claim: null, confidence: 0.8, attention_request: null }),
  HEALTH_CHANGED: () => ({ delta: { coherence: -2, mission_progress: 4 }, reason: 'Example exogenous game-state consequence' })
};

function fillExample() {
  const type = $('#intent-type').value;
  const payload = examples[type]?.() || {};
  $('#intent-payload').value = JSON.stringify(payload, null, 2);
}

async function genericIntent(event) {
  event.preventDefault();
  try {
    const type = $('#intent-type').value;
    const payload = JSON.parse($('#intent-payload').value || '{}');
    const result = await submitIntent(type, payload);
    $('#intent-result').textContent = `ACCEPTED\n${result.event.type}\n${result.event.event_hash}`;
  } catch (error) { showIntentError(error); }
}

async function createBranch(event) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const result = await api('/api/branch', {
      method: 'POST',
      body: JSON.stringify({ name: body.name, from: currentBranch, base_hash: state.head })
    });
    currentBranch = result.state.branch;
    await loadBranches();
    state = result.state;
    render();
    connectSocket();
    event.currentTarget.reset();
  } catch (error) { showIntentError(error); }
}

async function registerActor(event) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget));
  const roles = body.kind === 'agent' ? ['agent'] : ['human'];
  try {
    const result = await api('/api/actors', {
      method: 'POST',
      body: JSON.stringify({ ...body, roles, branch: currentBranch, base_hash: state.head })
    });
    $('#actor-result').textContent = `ONE-TIME CREDENTIAL\nactor: ${result.credentials.actor}\ntoken: ${result.credentials.token}`;
    await loadState();
    event.currentTarget.reset();
  } catch (error) {
    $('#actor-result').textContent = error?.data ? JSON.stringify(error.data, null, 2) : error.message;
  }
}

async function uploadArtifact(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) return;
  const headers = {
    'x-rug-actor': credentials.actor,
    'x-rug-token': credentials.token,
    'x-rug-branch': currentBranch,
    'x-rug-base-hash': state.head,
    'x-rug-artifact-name': file.name,
    'content-type': file.type || 'application/octet-stream'
  };
  if (form.get('artifact_id')) headers['x-rug-artifact-id'] = String(form.get('artifact_id'));
  if (form.get('work_id')) headers['x-rug-work-id'] = String(form.get('work_id'));
  try {
    const res = await fetch('/api/artifact', { method: 'POST', headers, body: file });
    const result = await res.json();
    if (!res.ok) throw Object.assign(new Error(result.message || result.error || `HTTP ${res.status}`), { data: result });
    $('#artifact-result').textContent = `COMMITTED\n${result.artifact.id}\nsha256:${result.artifact.digest}\n${result.artifact.size} bytes`;
    event.currentTarget.reset();
    await loadState();
  } catch (error) {
    $('#artifact-result').textContent = error?.data ? JSON.stringify(error.data, null, 2) : error.message;
  }
}

$('#bootstrap-form').addEventListener('submit', bootstrap);
$('#login-form').addEventListener('submit', login);
$('#intent-form').addEventListener('submit', genericIntent);
$('#fill-example').addEventListener('click', fillExample);
$('#intent-type').addEventListener('change', fillExample);
$('#branch-form').addEventListener('submit', createBranch);
$('#actor-form').addEventListener('submit', registerActor);
$('#artifact-form').addEventListener('submit', uploadArtifact);
$('#knowledge-search').addEventListener('input', renderKnowledge);
$('#refresh').addEventListener('click', () => loadState().catch(showIntentError));
$('#branch-select').addEventListener('change', async event => {
  currentBranch = event.target.value;
  await loadState();
  connectSocket();
});
$('#logout').addEventListener('click', () => {
  ws?.close();
  credentials.clear();
  location.reload();
});

fillExample();
if (credentials.actor && credentials.token) enterWorld();
