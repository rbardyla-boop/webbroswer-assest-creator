import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DNA_VERSION, EVENT_TYPES } from './dna.mjs';

const GENESIS = 'GENESIS';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  }
  return value;
}

export function canonicalStringify(value) {
  return JSON.stringify(canonical(value));
}

export function digest(value) {
  return crypto.createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

export class LedgerConflict extends Error {
  constructor(message, currentHead) {
    super(message);
    this.name = 'LedgerConflict';
    this.currentHead = currentHead;
  }
}

export class Ledger {
  constructor(file) {
    this.file = file;
    this.events = [];
    this.byHash = new Map();
    this.heads = new Map([['main', GENESIS]]);
    this.load();
  }

  load() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) return;
    const lines = fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      const event = JSON.parse(line);
      this.events.push(event);
      this.byHash.set(event.event_hash, event);
      this.heads.set(event.branch, event.event_hash);
    }
  }

  head(branch = 'main') {
    if (!this.heads.has(branch)) throw new Error(`Unknown branch: ${branch}`);
    return this.heads.get(branch);
  }

  listBranches() {
    return [...this.heads.entries()].map(([name, head]) => ({ name, head }));
  }

  append({ branch = 'main', type, actor, payload = {}, base_hash, meta = {} }) {
    if (!Object.values(EVENT_TYPES).includes(type)) throw new Error(`Unknown event type: ${type}`);
    const current = this.head(branch);
    const base = base_hash ?? current;
    if (base !== current) {
      throw new LedgerConflict(`Stale base for ${branch}: expected ${current}, received ${base}`, current);
    }

    const event = {
      id: crypto.randomUUID(),
      seq: this.events.length + 1,
      branch,
      type,
      actor,
      timestamp: new Date().toISOString(),
      dna_version: DNA_VERSION,
      base_hash: base,
      prev_hash: current,
      payload,
      meta
    };
    event.event_hash = digest(event);

    fs.appendFileSync(this.file, `${JSON.stringify(event)}\n`, 'utf8');
    this.events.push(event);
    this.byHash.set(event.event_hash, event);
    this.heads.set(branch, event.event_hash);
    return event;
  }

  createBranch({ name, from = 'main', actor, base_hash }) {
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(name)) throw new Error('Invalid branch name');
    if (this.heads.has(name)) throw new Error(`Branch already exists: ${name}`);
    const parentHead = this.head(from);
    if (base_hash && base_hash !== parentHead) {
      throw new LedgerConflict(`Stale parent base: expected ${parentHead}`, parentHead);
    }
    this.heads.set(name, parentHead);
    try {
      return this.append({
        branch: name,
        type: EVENT_TYPES.BRANCH_CREATED,
        actor,
        base_hash: parentHead,
        payload: { from_branch: from, from_head: parentHead }
      });
    } catch (error) {
      this.heads.delete(name);
      throw error;
    }
  }

  eventsForBranch(branch = 'main') {
    let cursor = this.head(branch);
    const result = [];
    const seen = new Set();
    while (cursor && cursor !== GENESIS) {
      if (seen.has(cursor)) throw new Error('Ledger cycle detected');
      seen.add(cursor);
      const event = this.byHash.get(cursor);
      if (!event) throw new Error(`Missing ledger event ${cursor}`);
      result.push(event);
      cursor = event.prev_hash;
    }
    return result.reverse();
  }

  verifyBranch(branch = 'main') {
    const events = this.eventsForBranch(branch);
    let previous = GENESIS;
    for (const event of events) {
      if (event.prev_hash !== previous) {
        return { ok: false, seq: event.seq, reason: 'prev_hash mismatch' };
      }
      const { event_hash, ...unsigned } = event;
      if (digest(unsigned) !== event_hash) {
        return { ok: false, seq: event.seq, reason: 'event_hash mismatch' };
      }
      previous = event_hash;
    }
    return { ok: true, head: previous, count: events.length };
  }
}

export { GENESIS };
