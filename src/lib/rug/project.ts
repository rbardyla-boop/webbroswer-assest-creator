import { GENESIS_HASH } from "./ids";
import { DEMO_LEASES } from "./seed";
import { ancestryOf, diffClaims } from "./ancestry";
import { knowledgeScore } from "./mission";
import {
  EMPTY_CONSTITUTION,
  EMPTY_HEALTH,
  type Constitution,
  type Entity,
  type EntityKind,
  type Health,
  type Json,
  type LedgerEntry,
  type WorldState,
} from "./types";

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function bump(h: Health, patch: Partial<Health>): Health {
  const next = { ...h };
  for (const key of Object.keys(patch) as (keyof Health)[]) {
    const v = patch[key];
    if (typeof v === "number") next[key] = clamp(next[key] + v);
  }
  return next;
}

function upsert(entities: Entity[], entity: Entity): Entity[] {
  const i = entities.findIndex((e) => e.id === entity.id);
  if (i < 0) return [...entities, entity];
  const copy = entities.slice();
  copy[i] = entity;
  return copy;
}

function nextId(kind: EntityKind, entities: Entity[]): string {
  const prefix: Record<EntityKind, string> = {
    work: "WORK",
    knowledge: "KNOW",
    observation: "OBS",
    artifact: "ART",
    decision: "DEC",
    agent: "AGENT",
    requirement: "REQ",
    mission: "MISSION",
    interpretation: "INT",
  };
  const p = prefix[kind];
  let max = 0;
  for (const e of entities) {
    if (!e.id.startsWith(`${p}-`)) continue;
    const n = Number(e.id.slice(p.length + 1));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${p}-${max + 1}`;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function strs(v: unknown, fallback: string[] = []): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : fallback;
}

function find(entities: Entity[], id: string): Entity | undefined {
  return entities.find((e) => e.id === id);
}

function idleAgent(e: Entity, seq: number): Entity {
  return {
    ...e,
    fields: {
      ...e.fields,
      status: "idle",
      claim: "",
      attention: "low",
      blockedBy: "",
    },
    updatedSeq: seq,
  };
}

export function emptyState(): WorldState {
  return {
    seq: 0,
    headHash: GENESIS_HASH,
    constitution: { ...EMPTY_CONSTITUTION },
    entities: [],
    health: { ...EMPTY_HEALTH },
  };
}

export function applyEntry(state: WorldState, entry: LedgerEntry): WorldState {
  const seq = entry.seq;
  const payload = entry.payload;
  let entities = state.entities;
  let health = state.health;
  let constitution: Constitution = state.constitution;

  const patchEntity = (id: string, fn: (e: Entity) => Entity) => {
    const cur = find(entities, id);
    if (!cur) return;
    entities = upsert(entities, fn({ ...cur, fields: { ...cur.fields }, updatedSeq: seq }));
  };

  switch (entry.eventType) {
    case "GENESIS":
      break;
    case "DNA_SET": {
      constitution = {
        mission: str(payload.mission, constitution.mission),
        laws: Array.isArray(payload.laws) ? payload.laws.map((x) => String(x)) : constitution.laws,
        permissions: Array.isArray(payload.permissions)
          ? payload.permissions.map((x) => String(x))
          : constitution.permissions,
      };
      const existing = find(entities, "MISSION-1");
      entities = upsert(entities, {
        id: "MISSION-1",
        kind: "mission",
        title: "MISSION",
        body: constitution.mission,
        status: "canon",
        owner: "",
        fields: {},
        updatedSeq: seq,
      });
      if (!existing) health = bump(health, { integrity: 2 });
      break;
    }
    case "OBSERVATION_LOGGED": {
      const id = str(payload.id) || nextId("observation", entities);
      entities = upsert(entities, {
        id,
        kind: "observation",
        title: str(payload.title, "Observation"),
        body: str(payload.body),
        status: "unread",
        owner: entry.actorId,
        fields: { evidence: str(payload.evidence) },
        updatedSeq: seq,
      });
      health = bump(health, { knowledge: 1 });
      break;
    }
    case "UNDERSTAND_PLACED": {
      patchEntity(entry.target, (e) => ({
        ...e,
        status: "placed",
        fields: {
          ...e.fields,
          affects: str(payload.affects),
          related: payload.related ?? e.fields.related ?? null,
          confidence: payload.confidence ?? e.fields.confidence ?? null,
        },
      }));
      health = bump(health, { coherence: 3 });
      break;
    }
    case "INTENT_CAPTURED":
    case "WORK_CREATED": {
      const id = str(payload.id) || nextId("work", entities);
      const utterance = str(payload.utterance);
      entities = upsert(entities, {
        id,
        kind: "work",
        title: str(payload.title, utterance.slice(0, 72) || "Untitled work"),
        body: str(payload.body, utterance),
        status: "open",
        owner: "",
        fields: utterance ? { utterance } : {},
        updatedSeq: seq,
      });
      health = bump(health, { energy: -1 });
      break;
    }
    case "WORK_CLAIMED":
    case "LEASE_GRANTED": {
      const agentId = str(payload.agentId, entry.actorId);
      const work = find(entities, entry.target);
      const agent = find(entities, agentId);
      const defaults = DEMO_LEASES[agentId];
      patchEntity(entry.target, (e) => ({
        ...e,
        status: "claimed",
        owner: agentId,
        fields: {
          ...e.fields,
          leaseMinutes: num(payload.leaseMinutes, num(agent?.fields.leaseMinutes, defaults?.leaseMinutes ?? 20)),
          can: strs(payload.can, strs(agent?.fields.can, defaults?.can ?? [])),
          cannot: strs(payload.cannot, strs(agent?.fields.cannot, defaults?.cannot ?? [])),
          objective: str(payload.objective, str(work?.title, defaults?.objective ?? e.title)),
        },
      }));
      if (agent) {
        entities = upsert(entities, {
          ...agent,
          fields: {
            ...agent.fields,
            status: "working",
            claim: entry.target,
            attention: "low",
            blockedBy: "",
          },
          updatedSeq: seq,
        });
      }
      health = bump(health, { energy: -2, mission: 1 });
      break;
    }
    case "WORK_RELEASED": {
      const work = find(entities, entry.target);
      if (work?.owner) {
        const prev = find(entities, work.owner);
        if (prev) entities = upsert(entities, idleAgent(prev, seq));
      }
      patchEntity(entry.target, (e) => ({
        ...e,
        status: "open",
        owner: "",
        fields: { ...e.fields, leaseMinutes: 0, can: [], cannot: [], objective: "" },
      }));
      break;
    }
    case "HANDOFF": {
      const to = str(payload.to);
      const work = find(entities, entry.target);
      if (work?.owner) {
        const prev = find(entities, work.owner);
        if (prev) entities = upsert(entities, idleAgent(prev, seq));
      }
      patchEntity(entry.target, (e) => ({ ...e, owner: to, status: "claimed" }));
      const next = find(entities, to);
      if (next) {
        entities = upsert(entities, {
          ...next,
          fields: { ...next.fields, status: "working", claim: entry.target, attention: "low" },
          updatedSeq: seq,
        });
      }
      health = bump(health, { coherence: 2 });
      break;
    }
    case "ESCALATE": {
      patchEntity(entry.target, (e) => ({
        ...e,
        fields: { ...e.fields, requires: str(payload.requires, "human_approval") },
      }));
      if (entry.actorKind === "agent") {
        patchEntity(entry.actorId, (e) => ({
          ...e,
          fields: { ...e.fields, attention: "high", requires: "human_approval" },
        }));
      }
      health = bump(health, { time: -3 });
      break;
    }
    case "COORD_SET": {
      patchEntity(entry.target, (e) => ({
        ...e,
        fields: {
          ...e.fields,
          status: str(payload.status, str(e.fields.status, "idle")),
          confidence: payload.confidence ?? e.fields.confidence ?? null,
          blockedBy: str(payload.blockedBy, str(e.fields.blockedBy)),
          requires: str(payload.requires, str(e.fields.requires)),
          attention: str(payload.attention, str(e.fields.attention, "low")),
          claim: str(payload.claim, str(e.fields.claim)),
        },
      }));
      break;
    }
    case "EVIDENCE_ATTACHED": {
      patchEntity(entry.target, (e) => {
        const prev: Json[] = Array.isArray(e.fields.evidence) ? [...e.fields.evidence] : [];
        prev.push({ text: str(payload.text), source: str(payload.source), seq });
        return { ...e, fields: { ...e.fields, evidence: prev } };
      });
      health = bump(health, { knowledge: 5, trust: 2 });
      break;
    }
    case "CAUSE_CONFIRMED": {
      patchEntity(entry.target, (e) => ({
        ...e,
        status: "cause_confirmed",
        fields: { ...e.fields, cause: str(payload.cause) },
      }));
      health = bump(health, { integrity: 4 });
      break;
    }
    case "FIX_PROPOSED": {
      patchEntity(entry.target, (e) => ({
        ...e,
        status: "fix_proposed",
        fields: { ...e.fields, fix: str(payload.fix) },
      }));
      health = bump(health, { mission: 2 });
      break;
    }
    case "DECISION_PROPOSED": {
      const id = str(payload.id) || nextId("decision", entities);
      entities = upsert(entities, {
        id,
        kind: "decision",
        title: str(payload.title, "Decision"),
        body: str(payload.body),
        status: "proposed",
        owner: entry.actorId,
        fields: { target: entry.target },
        updatedSeq: seq,
      });
      break;
    }
    case "DECISION_APPROVED": {
      patchEntity(entry.target, (e) => ({ ...e, status: "approved" }));
      health = bump(health, { mission: 7 });
      break;
    }
    case "ARTIFACT_COMMITTED": {
      const id = str(payload.id) || nextId("artifact", entities);
      entities = upsert(entities, {
        id,
        kind: "artifact",
        title: str(payload.title, "Artifact"),
        body: str(payload.body),
        status: str(payload.status, "committed"),
        owner: entry.actorId,
        fields: {
          hash: str(payload.hash),
          ref: str(payload.ref),
          layer: str(payload.layer, "evidence") || "evidence",
          claims: strs(payload.claims),
          depth: 0,
          parentId: "",
          evidenceHashes: strs(payload.evidenceHashes, payload.hash ? [str(payload.hash)] : []),
        },
        updatedSeq: seq,
      });
      health = bump(health, { mission: 5, integrity: 2 });
      break;
    }
    case "KNOWLEDGE_PROMOTED": {
      const id = str(payload.id) || nextId("knowledge", entities);
      const parentId = str(payload.parentId);
      const parent = parentId ? find(entities, parentId) : undefined;
      const parentA = ancestryOf(parent);
      const claims = strs(payload.claims);
      const diff = parent ? diffClaims(parentA.claims, claims) : { lost: [] as string[], mutated: [] as string[] };
      const depth = parent ? parentA.depth + 1 : num(payload.depth);
      const reread = payload.reread === true;
      const status = depth > 2 && !reread ? "drift" : "promoted";
      entities = upsert(entities, {
        id,
        kind: "knowledge",
        title: str(payload.title, "Knowledge"),
        body: str(payload.body),
        status,
        owner: entry.actorId,
        fields: {
          evidence: str(payload.evidence),
          from: entry.target,
          parentId,
          sourceIds: strs(payload.sourceIds, parentId ? [parentId] : []),
          evidenceHashes: strs(payload.evidenceHashes),
          depth,
          claims,
          lost: diff.lost,
          mutated: diff.mutated,
          reread,
          layer: "knowledge",
          critical: payload.critical === true,
          disputed: str(payload.disputed),
        },
        updatedSeq: seq,
      });
      health = bump(health, {
        trust: 3,
        coherence: 2,
      });
      break;
    }
    case "INTERPRETATION_LOGGED": {
      const id = str(payload.id) || nextId("interpretation", entities);
      const ancestor = str(payload.ancestor) || entry.target;
      entities = upsert(entities, {
        id,
        kind: "interpretation",
        title: str(payload.title, "Interpretation"),
        body: str(payload.body),
        status: "phenotype",
        owner: entry.actorId,
        fields: {
          ancestor,
          model: str(payload.model, entry.actorName),
          claims: strs(payload.claims),
          layer: "interpretation",
          depth: 1,
          parentId: ancestor,
        },
        updatedSeq: seq,
      });
      break;
    }
    case "ANCESTOR_REREAD": {
      patchEntity(entry.target, (e) => ({
        ...e,
        status: "revalidated",
        fields: { ...e.fields, reread: true, rereadFrom: str(payload.from, str(e.fields.parentId)) },
      }));
      health = bump(health, { knowledge: 8, integrity: 4 });
      break;
    }
    case "CANON_SET": {
      patchEntity(entry.target, (e) => ({
        ...e,
        status: "canon",
        fields: { ...e.fields, canon: true, layer: "evidence" },
      }));
      health = bump(health, { integrity: 4, knowledge: 3 });
      break;
    }
    case "SCHISM_MARKED": {
      const claim = str(payload.claim);
      const left = str(payload.left, entry.target);
      const right = str(payload.right);
      patchEntity(left, (e) => ({ ...e, fields: { ...e.fields, disputed: claim || "claim" } }));
      if (right) patchEntity(right, (e) => ({ ...e, fields: { ...e.fields, disputed: claim || "claim" } }));
      health = bump(health, { coherence: -4, knowledge: 2, integrity: 2 });
      break;
    }
    case "REQUIREMENT_CHANGED": {
      const id = str(payload.id) || entry.target || nextId("requirement", entities);
      entities = upsert(entities, {
        id,
        kind: "requirement",
        title: str(payload.title, "Requirement"),
        body: str(payload.body),
        status: "changed",
        owner: "",
        fields: {},
        updatedSeq: seq,
      });
      health = bump(health, { coherence: -6, mission: -4, time: -5 });
      break;
    }
    case "AGENT_LEASE": {
      const id = str(payload.id) || entry.target;
      const d = DEMO_LEASES[id];
      entities = upsert(entities, {
        id,
        kind: "agent",
        title: str(payload.name, id),
        body: str(payload.role),
        status: "online",
        owner: id,
        fields: {
          model: str(payload.model),
          leaseMinutes: num(payload.leaseMinutes, d?.leaseMinutes ?? 20),
          can: strs(payload.can, d?.can ?? []),
          cannot: strs(payload.cannot, d?.cannot ?? []),
          status: "idle",
          claim: "",
          confidence: null,
          blockedBy: "",
          requires: "",
          attention: "low",
        },
        updatedSeq: seq,
      });
      break;
    }
    case "AGENT_OFFLINE": {
      patchEntity(entry.target, (e) => ({
        ...e,
        status: "offline",
        fields: { ...e.fields, status: "idle", claim: "" },
      }));
      for (const e of entities) {
        if (e.kind === "work" && e.owner === entry.target && e.status === "claimed") {
          entities = upsert(entities, { ...e, owner: "", status: "open", updatedSeq: seq });
        }
      }
      health = bump(health, { energy: -5, coherence: -3 });
      break;
    }
    case "CHAOS_BAD_SOURCE": {
      patchEntity(entry.target, (e) => ({ ...e, status: "contested" }));
      break;
    }
    default:
      break;
  }

  return observe({
    seq: entry.seq,
    headHash: entry.hash,
    constitution,
    entities,
    health,
  });
}

function observe(state: WorldState): WorldState {
  return {
    ...state,
    health: { ...state.health, knowledge: knowledgeScore(state) },
  };
}

export function fold(entries: LedgerEntry[]): WorldState {
  return entries.reduce(applyEntry, emptyState());
}

export function applyEntries(state: WorldState, entries: LedgerEntry[]): WorldState {
  return entries.reduce(applyEntry, state);
}

export { nextId };
