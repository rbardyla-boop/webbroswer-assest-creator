import type { Entity, EventType, Proposal, WorldState } from "./types";
import { MAX_DERIVATION, ancestryOf } from "./ancestry";

export type Validation =
  | { ok: true }
  | { ok: false; reason: string };

function entity(state: WorldState, id: string): Entity | undefined {
  return state.entities.find((e) => e.id === id);
}

function cannotList(agent: Entity | undefined): string[] {
  const v = agent?.fields.cannot;
  return Array.isArray(v) ? v.map(String).map((s) => s.toLowerCase()) : [];
}

function forbidden(agent: Entity | undefined, action: string): boolean {
  return cannotList(agent).some((c) => c.includes(action));
}

const TYPES = new Set<EventType>([
  "GENESIS",
  "DNA_SET",
  "OBSERVATION_LOGGED",
  "UNDERSTAND_PLACED",
  "WORK_CREATED",
  "WORK_CLAIMED",
  "WORK_RELEASED",
  "EVIDENCE_ATTACHED",
  "CAUSE_CONFIRMED",
  "FIX_PROPOSED",
  "DECISION_PROPOSED",
  "DECISION_APPROVED",
  "ARTIFACT_COMMITTED",
  "KNOWLEDGE_PROMOTED",
  "REQUIREMENT_CHANGED",
  "AGENT_LEASE",
  "AGENT_OFFLINE",
  "LEASE_GRANTED",
  "HANDOFF",
  "ESCALATE",
  "INTENT_CAPTURED",
  "COORD_SET",
  "CHAOS_BAD_SOURCE",
  "INTERPRETATION_LOGGED",
  "ANCESTOR_REREAD",
  "CANON_SET",
  "SCHISM_MARKED",
]);

export function validateProposal(
  state: WorldState,
  proposal: Proposal,
  actorKind: string,
  actorId?: string,
): Validation {
  if (proposal.baseHash !== state.headHash) {
    return {
      ok: false,
      reason: `stale base. current_head=${state.headHash.slice(0, 8).toUpperCase()}`,
    };
  }
  if (!TYPES.has(proposal.eventType)) {
    return { ok: false, reason: `unknown event ${proposal.eventType}` };
  }

  const actor = actorId ? entity(state, actorId) : undefined;

  switch (proposal.eventType) {
    case "WORK_CLAIMED":
    case "LEASE_GRANTED": {
      const work = entity(state, proposal.target);
      if (!work || work.kind !== "work") return { ok: false, reason: "no such work" };
      if (work.owner) return { ok: false, reason: `already claimed by ${work.owner}` };
      break;
    }
    case "WORK_RELEASED": {
      const work = entity(state, proposal.target);
      if (!work) return { ok: false, reason: "no such work" };
      break;
    }
    case "HANDOFF": {
      const work = entity(state, proposal.target);
      if (!work || work.kind !== "work") return { ok: false, reason: "no such work" };
      if (!work.owner) return { ok: false, reason: "unowned work cannot be handed off" };
      if (!String(proposal.payload.to ?? "").trim()) return { ok: false, reason: "handoff needs a recipient" };
      break;
    }
    case "ESCALATE": {
      if (!entity(state, proposal.target)) return { ok: false, reason: "no such target" };
      break;
    }
    case "INTENT_CAPTURED": {
      if (!String(proposal.payload.utterance ?? "").trim()) return { ok: false, reason: "utterance is empty" };
      break;
    }
    case "UNDERSTAND_PLACED": {
      if (!entity(state, proposal.target)) return { ok: false, reason: "no such observation" };
      break;
    }
    case "EVIDENCE_ATTACHED": {
      if (!entity(state, proposal.target)) return { ok: false, reason: "no such target" };
      if (!String(proposal.payload.text ?? "").trim()) return { ok: false, reason: "evidence is empty" };
      break;
    }
    case "KNOWLEDGE_PROMOTED": {
      if (actorKind === "agent" && forbidden(actor, "publish")) {
        return { ok: false, reason: "lease forbids publish knowledge" };
      }
      const ev = String(proposal.payload.evidence ?? "").trim();
      if (!ev) return { ok: false, reason: "knowledge needs evidence. do not invent citations." };
      const parentId = String(proposal.payload.parentId ?? "").trim();
      if (parentId) {
        const parent = entity(state, parentId);
        if (!parent) return { ok: false, reason: "parent_id does not exist. do not clone a ghost." };
        const depth = ancestryOf(parent).depth + 1;
        const reread = proposal.payload.reread === true;
        if (depth > MAX_DERIVATION && !reread) {
          return {
            ok: false,
            reason: `GENETIC DRIFT. derived through ${depth} generations without source revalidation. Re-read ancestor evidence before promotion.`,
          };
        }
      }
      break;
    }
    case "INTERPRETATION_LOGGED": {
      if (!String(proposal.payload.body ?? "").trim()) return { ok: false, reason: "interpretation is empty" };
      const ancestor = String(proposal.payload.ancestor ?? proposal.target ?? "").trim();
      if (!entity(state, ancestor)) return { ok: false, reason: "interpretation needs an ancestor" };
      break;
    }
    case "ANCESTOR_REREAD": {
      const claim = entity(state, proposal.target);
      if (!claim) return { ok: false, reason: "no such claim" };
      const from = String(proposal.payload.from ?? "").trim();
      if (from && !entity(state, from)) return { ok: false, reason: "ancestor missing" };
      break;
    }
    case "CANON_SET": {
      const art = entity(state, proposal.target);
      if (!art || art.kind !== "artifact") return { ok: false, reason: "canon must be an artifact" };
      break;
    }
    case "SCHISM_MARKED": {
      if (!entity(state, proposal.target)) return { ok: false, reason: "no such branch" };
      break;
    }
    case "DECISION_APPROVED": {
      if (actorKind === "agent") return { ok: false, reason: "humans own approvals" };
      const dec = entity(state, proposal.target);
      if (!dec || dec.kind !== "decision") return { ok: false, reason: "no such decision" };
      break;
    }
    case "WORK_CREATED": {
      if (!String(proposal.payload.title ?? "").trim()) return { ok: false, reason: "work needs a title" };
      break;
    }
    case "CAUSE_CONFIRMED":
    case "FIX_PROPOSED": {
      if (!entity(state, proposal.target)) return { ok: false, reason: "no such work" };
      break;
    }
    case "ARTIFACT_COMMITTED": {
      if (actorKind === "agent" && forbidden(actor, "change production")) {
        return { ok: false, reason: "lease forbids changing production" };
      }
      break;
    }
    default:
      break;
  }
  return { ok: true };
}
