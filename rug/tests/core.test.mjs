import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Authority } from '../server/authority.mjs';
import { EVENT_TYPES, ROLES } from '../server/dna.mjs';
import { Ledger, LedgerConflict } from '../server/ledger.mjs';
import { mergeBranch } from '../server/merge.mjs';

function rig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rug-test-'));
  const ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
  const authority = new Authority(ledger);
  return { dir, ledger, authority };
}

function submit(authority, ledger, actor, type, payload, branch = 'main', base = null) {
  return authority.submit({ actor, type, payload, branch, base_hash: base || ledger.head(branch) });
}

function bootstrap(authority, ledger) {
  submit(authority, ledger, 'system:bootstrap', EVENT_TYPES.ORG_CREATED, { name: 'Test Org' });
  submit(authority, ledger, 'system:bootstrap', EVENT_TYPES.ACTOR_REGISTERED, {
    actor_id: 'admin', name: 'Admin', kind: 'human', roles: [ROLES.ADMIN, ROLES.HUMAN, ROLES.REVIEWER]
  });
  submit(authority, ledger, 'admin', EVENT_TYPES.ACTOR_REGISTERED, {
    actor_id: 'agent-a', name: 'Agent A', kind: 'agent', roles: [ROLES.AGENT]
  });
  submit(authority, ledger, 'admin', EVENT_TYPES.ACTOR_REGISTERED, {
    actor_id: 'agent-b', name: 'Agent B', kind: 'agent', roles: [ROLES.AGENT]
  });
}

test('ledger is hash-linked, replayable, and rejects stale heads', () => {
  const { ledger, authority } = rig();
  bootstrap(authority, ledger);
  const oldHead = ledger.head('main');
  submit(authority, ledger, 'admin', EVENT_TYPES.MISSION_CREATED, { mission_id: 'M1', title: 'Mission' });
  assert.throws(() => authority.submit({
    actor: 'admin', branch: 'main', type: EVENT_TYPES.MISSION_CREATED,
    base_hash: oldHead, payload: { mission_id: 'M2', title: 'Stale' }
  }), LedgerConflict);
  assert.equal(ledger.verifyBranch('main').ok, true);
  assert.equal(authority.state('main').missions.M1.title, 'Mission');
});

test('exclusive work has one owner and dependencies gate claims', () => {
  const { ledger, authority } = rig();
  bootstrap(authority, ledger);
  submit(authority, ledger, 'admin', EVENT_TYPES.MISSION_CREATED, { mission_id: 'M', title: 'Ship' });
  submit(authority, ledger, 'admin', EVENT_TYPES.WORK_CREATED, { work_id: 'A', mission_id: 'M', title: 'First', exclusive: true, dependencies: [] });
  submit(authority, ledger, 'admin', EVENT_TYPES.WORK_CREATED, { work_id: 'B', mission_id: 'M', title: 'Second', exclusive: true, dependencies: ['A'] });

  assert.throws(() => submit(authority, ledger, 'agent-b', EVENT_TYPES.WORK_CLAIMED, { work_id: 'B' }), e => e.code === 'DEPENDENCY_BLOCKED');
  submit(authority, ledger, 'agent-a', EVENT_TYPES.WORK_CLAIMED, { work_id: 'A', lease_expires_at: new Date(Date.now() + 60000).toISOString() });
  assert.throws(() => submit(authority, ledger, 'agent-b', EVENT_TYPES.WORK_CLAIMED, { work_id: 'A' }), e => e.code === 'OWNERSHIP_CONFLICT');
  submit(authority, ledger, 'agent-a', EVENT_TYPES.WORK_COMPLETED, { work_id: 'A' });
  submit(authority, ledger, 'agent-b', EVENT_TYPES.WORK_CLAIMED, { work_id: 'B' });
  assert.equal(authority.state('main').work.B.owner, 'agent-b');
});

test('agents cannot self-approve decisions or promote their own knowledge', () => {
  const { ledger, authority } = rig();
  bootstrap(authority, ledger);
  submit(authority, ledger, 'agent-a', EVENT_TYPES.DECISION_PROPOSED, { decision_id: 'D1', title: 'Decision', proposal: 'Do it' });
  assert.throws(() => submit(authority, ledger, 'agent-a', EVENT_TYPES.DECISION_APPROVED, { decision_id: 'D1' }), e => e.code === 'FORBIDDEN' || e.code === 'SELF_APPROVAL');
  submit(authority, ledger, 'admin', EVENT_TYPES.DECISION_APPROVED, { decision_id: 'D1' });
  assert.equal(authority.state('main').decisions.D1.status, 'approved');

  submit(authority, ledger, 'agent-a', EVENT_TYPES.KNOWLEDGE_PROPOSED, {
    knowledge_id: 'K1', title: 'Lesson', body: 'Verified lesson', provenance: ['artifact:abc']
  });
  assert.throws(() => submit(authority, ledger, 'agent-a', EVENT_TYPES.KNOWLEDGE_PROMOTED, { knowledge_id: 'K1' }), e => e.code === 'FORBIDDEN' || e.code === 'SELF_APPROVAL');
  submit(authority, ledger, 'admin', EVENT_TYPES.KNOWLEDGE_PROMOTED, { knowledge_id: 'K1' });
  assert.equal(authority.state('main').knowledge.K1.status, 'accepted');
});

test('scenario branches diverge without mutating main and can semantically merge', () => {
  const { ledger, authority } = rig();
  bootstrap(authority, ledger);
  const mainHead = ledger.head('main');
  authority.createBranch({ name: 'scenario-a', from: 'main', actor: 'admin', base_hash: mainHead });
  submit(authority, ledger, 'admin', EVENT_TYPES.MISSION_CREATED, { mission_id: 'ALT', title: 'Alternative plan' }, 'scenario-a');
  assert.equal(authority.state('main').missions.ALT, undefined);
  assert.equal(authority.state('scenario-a').missions.ALT.title, 'Alternative plan');

  const result = mergeBranch(authority, { source: 'scenario-a', target: 'main', actor: 'admin', base_hash: ledger.head('main') });
  assert.equal(result.merged_events.length, 1);
  assert.equal(authority.state('main').missions.ALT.title, 'Alternative plan');
  assert.equal(ledger.verifyBranch('main').ok, true);
});

test('artifact commits require immutable sha256 digests', () => {
  const { ledger, authority } = rig();
  bootstrap(authority, ledger);
  assert.throws(() => submit(authority, ledger, 'agent-a', EVENT_TYPES.ARTIFACT_COMMITTED, {
    artifact_id: 'A1', uri: 'file://thing', digest: 'bad'
  }), e => e.code === 'BAD_DIGEST');
  submit(authority, ledger, 'agent-a', EVENT_TYPES.ARTIFACT_COMMITTED, {
    artifact_id: 'A1', uri: 'file://thing', digest: 'a'.repeat(64)
  });
  assert.equal(authority.state('main').artifacts.A1.digest.length, 64);
});
