export type ActorKind = "human" | "agent" | "system";
export type MemberRole = "lead" | "hand" | "observer";

export type EventType =
  | "GENESIS"
  | "DNA_SET"
  | "OBSERVATION_LOGGED"
  | "UNDERSTAND_PLACED"
  | "WORK_CREATED"
  | "WORK_CLAIMED"
  | "WORK_RELEASED"
  | "EVIDENCE_ATTACHED"
  | "CAUSE_CONFIRMED"
  | "FIX_PROPOSED"
  | "DECISION_PROPOSED"
  | "DECISION_APPROVED"
  | "ARTIFACT_COMMITTED"
  | "KNOWLEDGE_PROMOTED"
  | "REQUIREMENT_CHANGED"
  | "AGENT_LEASE"
  | "AGENT_OFFLINE"
  | "LEASE_GRANTED"
  | "HANDOFF"
  | "ESCALATE"
  | "INTENT_CAPTURED"
  | "COORD_SET"
  | "CHAOS_BAD_SOURCE"
  | "INTERPRETATION_LOGGED"
  | "ANCESTOR_REREAD"
  | "CANON_SET"
  | "SCHISM_MARKED";

export type EntityKind =
  | "work"
  | "knowledge"
  | "observation"
  | "artifact"
  | "decision"
  | "agent"
  | "requirement"
  | "mission"
  | "interpretation";

export type Health = {
  integrity: number;
  coherence: number;
  trust: number;
  energy: number;
  time: number;
  resources: number;
  security: number;
  knowledge: number;
  mission: number;
};

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export type Entity = {
  id: string;
  kind: EntityKind;
  title: string;
  body: string;
  status: string;
  owner: string;
  fields: { [key: string]: Json };
  updatedSeq: number;
};

export type LedgerEntry = {
  id: string;
  seq: number;
  prevHash: string;
  hash: string;
  eventType: EventType;
  actorId: string;
  actorKind: ActorKind;
  actorName: string;
  target: string;
  payload: { [key: string]: Json };
  createdAt: string;
};

export type Proposal = {
  baseHash: string;
  eventType: EventType;
  target: string;
  payload: { [key: string]: Json };
};

export type Reject = {
  id: string;
  actorId: string;
  actorName: string;
  eventType: string;
  target: string;
  baseHash: string;
  currentHead: string;
  reason: string;
  createdAt: string;
};

export type AgentMind = {
  agentId: string;
  name: string;
  model: string;
  online: boolean;
  briefPreview: string;
};

export type Member = {
  userId: string;
  displayName: string;
  role: MemberRole;
  hue: number;
};

export type WorldMeta = {
  id: string;
  code: string;
  name: string;
  seq: number;
  headHash: string;
  createdAt: string;
};

export type Constitution = {
  mission: string;
  laws: string[];
  permissions: string[];
};

export type WorldState = {
  seq: number;
  headHash: string;
  constitution: Constitution;
  entities: Entity[];
  health: Health;
};

export type Snapshot = {
  world: WorldMeta;
  state: WorldState;
  members: Member[];
  ledger: LedgerEntry[];
  rejects: Reject[];
  agents: AgentMind[];
  me: { userId: string; displayName: string; role: MemberRole; hue: number };
};

export type WorldListItem = {
  id: string;
  code: string;
  name: string;
  seq: number;
  role: MemberRole;
};

export type SyncKind = "ack" | "delta" | "snapshot" | "diverged";

export type SyncFrame = {
  protocol: number;
  kind: SyncKind;
  seq: number;
  headHash: string;
  sinceSeq: number;
  entries: LedgerEntry[];
  snapshot: Snapshot | null;
  rejects: Reject[];
  members: Member[];
  agents: AgentMind[];
  me: Snapshot["me"] | null;
};

export type NetHud = {
  kind: SyncKind;
  rttMs: number;
  lastAt: number;
  deltas: number;
  snapshots: number;
  diverged: number;
  inflight: number;
  localSeq: number;
  authSeq: number;
  localHead: string;
  authHead: string;
};

export const EMPTY_HEALTH: Health = {
  integrity: 74,
  coherence: 95,
  trust: 92,
  energy: 82,
  time: 70,
  resources: 46,
  security: 60,
  knowledge: 22,
  mission: 12,
};

export const EMPTY_CONSTITUTION: Constitution = {
  mission: "",
  laws: [],
  permissions: [],
};
