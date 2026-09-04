const baseUrl = process.env.RUG_URL || 'http://localhost:8787';
const actor = process.env.RUG_ACTOR;
const token = process.env.RUG_TOKEN;
const branch = process.env.RUG_BRANCH || 'main';

if (!actor || !token) {
  console.error('Set RUG_ACTOR and RUG_TOKEN.');
  process.exit(2);
}

async function request(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-rug-actor': actor,
      'x-rug-token': token,
      ...(options.headers || {})
    }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function context() {
  return request(`/api/agent/context?branch=${encodeURIComponent(branch)}`);
}

async function intent(type, payload, head) {
  return request('/api/intent', {
    method: 'POST',
    body: JSON.stringify({ branch, type, payload, base_hash: head, client: 'generic-agent-worker' })
  });
}

async function runOnce() {
  const ctx = await context();
  console.log(JSON.stringify({
    actor,
    branch,
    head: ctx.head,
    missions: ctx.mission.map(m => ({ id: m.id, title: m.title })),
    available_work: ctx.available_work.map(w => ({ id: w.id, title: w.title, dependencies: w.dependencies })),
    my_work: ctx.my_work.map(w => ({ id: w.id, title: w.title, status: w.status })),
    constraints: ctx.constraints,
    pending_decisions: ctx.pending_decisions.map(d => ({ id: d.id, title: d.title })),
    knowledge_count: ctx.knowledge.length,
    health: ctx.health
  }, null, 2));

  if (!ctx.my_work.length && ctx.available_work.length) {
    const work = ctx.available_work[0];
    const lease = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    const accepted = await intent('WORK_CLAIMED', { work_id: work.id, lease_expires_at: lease }, ctx.head);
    console.log(`claimed ${work.id} @ ${accepted.event.event_hash}`);
  }
}

runOnce().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
