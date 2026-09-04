import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { DEMO_CODE, GENESIS_HASH, PROTOCOL, hueFor, makeWorldCode, nid } from "./ids";
import { fold } from "./project";
import { DEMO_EVENTS, DEMO_MINDS, DEMO_NAME } from "./seed";
import type {
  ActorKind,
  AgentMind,
  EventType,
  Json,
  LedgerEntry,
  Member,
  MemberRole,
  Proposal,
  Reject,
  Snapshot,
  SyncFrame,
  WorldListItem,
  WorldMeta,
} from "./types";
import { validateProposal } from "./validate";

type Sql = Awaited<ReturnType<typeof getSql>>;

function ts(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  return new Date().toISOString();
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  return 0;
}

function displayOf(email: string | null | undefined, id: string) {
  return email ? email.split("@")[0]! : id.slice(0, 10);
}

async function sessionDisplay(userId: string): Promise<string> {
  const { getSessionUser } = await import("@/lib/auth/verify.server");
  const session = await getSessionUser();
  return displayOf(session?.email ?? null, userId);
}

function asPayload(v: unknown): { [key: string]: Json } {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as { [key: string]: Json };
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v) as unknown;
      if (parsed && typeof parsed === "object") return parsed as { [key: string]: Json };
    } catch {
      /* ignore */
    }
  }
  return {};
}

function mapEntry(row: {
  id: string;
  seq: unknown;
  prev_hash: string;
  hash: string;
  event_type: string;
  actor_id: string;
  actor_kind: string;
  actor_name: string;
  target: string;
  payload: unknown;
  created_at: unknown;
}): LedgerEntry {
  return {
    id: row.id,
    seq: num(row.seq),
    prevHash: row.prev_hash,
    hash: row.hash,
    eventType: row.event_type as EventType,
    actorId: row.actor_id,
    actorKind: row.actor_kind as ActorKind,
    actorName: row.actor_name,
    target: row.target,
    payload: asPayload(row.payload),
    createdAt: ts(row.created_at),
  };
}

async function loadEntries(sql: Sql, worldId: string): Promise<LedgerEntry[]> {
  const rows = await sql.query<{
    id: string;
    seq: unknown;
    prev_hash: string;
    hash: string;
    event_type: string;
    actor_id: string;
    actor_kind: string;
    actor_name: string;
    target: string;
    payload: unknown;
    created_at: unknown;
  }>(
    `select id, seq, prev_hash, hash, event_type, actor_id, actor_kind, actor_name, target, payload, created_at
     from ledger where world_id = $1 order by seq asc`,
    [worldId],
  );
  return rows.map(mapEntry);
}

async function loadEntriesAfter(sql: Sql, worldId: string, sinceSeq: number): Promise<LedgerEntry[]> {
  const rows = await sql.query<{
    id: string;
    seq: unknown;
    prev_hash: string;
    hash: string;
    event_type: string;
    actor_id: string;
    actor_kind: string;
    actor_name: string;
    target: string;
    payload: unknown;
    created_at: unknown;
  }>(
    `select id, seq, prev_hash, hash, event_type, actor_id, actor_kind, actor_name, target, payload, created_at
     from ledger where world_id = $1 and seq > $2 order by seq asc`,
    [worldId, sinceSeq],
  );
  return rows.map(mapEntry);
}

async function loadSnapshot(sql: Sql, worldId: string, userId: string): Promise<Snapshot> {
  const worlds = await sql.query<{
    id: string;
    code: string;
    name: string;
    seq: unknown;
    head_hash: string;
    created_at: unknown;
  }>(`select id, code, name, seq, head_hash, created_at from worlds where id = $1`, [worldId]);
  const world = worlds[0];
  if (!world) throw new Error("World not found");

  const members = await sql.query<{
    user_id: string;
    display_name: string;
    role: MemberRole;
    hue: number;
  }>(`select user_id, display_name, role, hue from world_members where world_id = $1 order by joined_at`, [
    worldId,
  ]);
  const me = members.find((m) => m.user_id === userId);
  if (!me) throw new Error("Not a member of this world");

  const entries = await loadEntries(sql, worldId);
  const state = fold(entries);

  const rejects = await sql.query<{
    id: string;
    actor_id: string;
    actor_name: string;
    event_type: string;
    target: string;
    base_hash: string;
    current_head: string;
    reason: string;
    created_at: unknown;
  }>(
    `select id, actor_id, actor_name, event_type, target, base_hash, current_head, reason, created_at
     from rejects where world_id = $1 order by created_at desc limit 12`,
    [worldId],
  );

  const agents = await sql.query<{
    agent_id: string;
    name: string;
    model: string;
    online: boolean;
    brief: string;
  }>(`select agent_id, name, model, online, brief from agent_minds where world_id = $1`, [worldId]);

  const meta: WorldMeta = {
    id: world.id,
    code: world.code,
    name: world.name,
    seq: num(world.seq),
    headHash: world.head_hash,
    createdAt: ts(world.created_at),
  };

  return {
    world: meta,
    state: { ...state, seq: meta.seq, headHash: meta.headHash },
    members: members.map(
      (m): Member => ({
        userId: m.user_id,
        displayName: m.display_name,
        role: m.role,
        hue: num(m.hue),
      }),
    ),
    ledger: entries,
    rejects: rejects.map(
      (r): Reject => ({
        id: r.id,
        actorId: r.actor_id,
        actorName: r.actor_name,
        eventType: r.event_type,
        target: r.target,
        baseHash: r.base_hash,
        currentHead: r.current_head,
        reason: r.reason,
        createdAt: ts(r.created_at),
      }),
    ),
    agents: agents.map(
      (a): AgentMind => ({
        agentId: a.agent_id,
        name: a.name,
        model: a.model,
        online: Boolean(a.online),
        briefPreview: a.brief.slice(0, 48) + (a.brief.length > 48 ? "…" : ""),
      }),
    ),
    me: {
      userId: me.user_id,
      displayName: me.display_name,
      role: me.role,
      hue: num(me.hue),
    },
  };
}

async function appendEntry(
  sql: Sql,
  worldId: string,
  actor: { id: string; kind: ActorKind; name: string },
  proposal: Proposal,
): Promise<{ ok: true } | { ok: false; reason: string; currentHead: string }> {
  const worlds = await sql.query<{ seq: unknown; head_hash: string }>(
    `select seq, head_hash from worlds where id = $1`,
    [worldId],
  );
  const row = worlds[0];
  if (!row) throw new Error("World not found");
  const seq = num(row.seq);
  const head = row.head_hash;
  const entries = await loadEntries(sql, worldId);
  const state = fold(entries);
  state.seq = seq;
  state.headHash = head;

  const check = validateProposal(state, proposal, actor.kind, actor.id);
  if (!check.ok) {
    await sql.query(
      `insert into rejects (id, world_id, actor_id, actor_name, event_type, target, base_hash, current_head, reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        nid("rj"),
        worldId,
        actor.id,
        actor.name,
        proposal.eventType,
        proposal.target,
        proposal.baseHash,
        head,
        check.reason,
      ],
    );
    return { ok: false, reason: check.reason, currentHead: head };
  }

  const nextSeq = seq + 1;
  const { hashEntry } = await import("./hash.server");
  const hash = hashEntry({
    seq: nextSeq,
    prevHash: head,
    eventType: proposal.eventType,
    actorId: actor.id,
    target: proposal.target,
    payload: proposal.payload ?? {},
  });
  try {
    await sql.query(
      `insert into ledger (id, world_id, seq, prev_hash, hash, event_type, actor_id, actor_kind, actor_name, target, payload)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        nid("ev"),
        worldId,
        nextSeq,
        head,
        hash,
        proposal.eventType,
        actor.id,
        actor.kind,
        actor.name,
        proposal.target,
        JSON.stringify(proposal.payload ?? {}),
      ],
    );
  } catch {
    await sql.query(
      `insert into rejects (id, world_id, actor_id, actor_name, event_type, target, base_hash, current_head, reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        nid("rj"),
        worldId,
        actor.id,
        actor.name,
        proposal.eventType,
        proposal.target,
        proposal.baseHash,
        head,
        `stale base. current_head=${head.slice(0, 8).toUpperCase()}`,
      ],
    );
    return {
      ok: false,
      reason: `stale base. current_head=${head.slice(0, 8).toUpperCase()}`,
      currentHead: head,
    };
  }
  await sql.query(`update worlds set seq = $1, head_hash = $2 where id = $3 and seq = $4`, [
    nextSeq,
    hash,
    worldId,
    seq,
  ]);
  return { ok: true };
}

async function appendAs(
  sql: Sql,
  worldId: string,
  actor: { id: string; kind: ActorKind; name: string },
  proposal: Proposal,
  readerId: string,
) {
  const result = await appendEntry(sql, worldId, actor, proposal);
  const snap = await loadSnapshot(sql, worldId, readerId);
  if (result.ok) return { ok: true as const, snap, reason: "" };
  return { ok: false as const, snap, reason: result.reason };
}

async function requireMember(sql: Sql, code: string, userId: string) {
  const rows = await sql.query<{ id: string; role: MemberRole }>(
    `select w.id, m.role from worlds w
     join world_members m on m.world_id = w.id
     where w.code = $1 and m.user_id = $2`,
    [code.toUpperCase(), userId],
  );
  const row = rows[0];
  if (!row) throw new Error("Not a member of this world");
  return row;
}

async function joinMember(sql: Sql, worldId: string, userId: string, display: string, role: MemberRole) {
  await sql.query(
    `insert into world_members (world_id, user_id, display_name, role, hue)
     values ($1,$2,$3,$4,$5)
     on conflict (world_id, user_id) do update set display_name = excluded.display_name`,
    [worldId, userId, display, role, hueFor(userId)],
  );
}

async function seedDemo(sql: Sql, worldId: string) {
  const { hashEntry } = await import("./hash.server");
  let head = GENESIS_HASH;
  let seq = 0;
  for (const ev of DEMO_EVENTS) {
    seq += 1;
    const hash = hashEntry({
      seq,
      prevHash: head,
      eventType: ev.eventType,
      actorId: ev.actorId,
      target: ev.target,
      payload: ev.payload,
    });
    await sql.query(
      `insert into ledger (id, world_id, seq, prev_hash, hash, event_type, actor_id, actor_kind, actor_name, target, payload)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        nid("ev"),
        worldId,
        seq,
        head,
        hash,
        ev.eventType,
        ev.actorId,
        ev.actorKind,
        ev.actorName,
        ev.target,
        JSON.stringify(ev.payload),
      ],
    );
    head = hash;
  }
  await sql.query(`update worlds set seq = $1, head_hash = $2 where id = $3`, [seq, head, worldId]);
  for (const mind of DEMO_MINDS) {
    await sql.query(
      `insert into agent_minds (world_id, agent_id, name, model, brief, online)
       values ($1,$2,$3,'grok-4.5',$4,true)
       on conflict (world_id, agent_id) do nothing`,
      [worldId, mind.agentId, mind.name, mind.brief],
    );
  }
}

async function ensureDemo(sql: Sql, userId: string, display: string): Promise<string> {
  const existing = await sql.query<{ id: string }>(`select id from worlds where code = $1`, [DEMO_CODE]);
  let worldId = existing[0]?.id;
  if (!worldId) {
    worldId = nid("wd");
    await sql.query(`insert into worlds (id, code, name, created_by) values ($1,$2,$3,$4)`, [
      worldId,
      DEMO_CODE,
      DEMO_NAME,
      userId,
    ]);
    await seedDemo(sql, worldId);
  }
  await joinMember(sql, worldId, userId, display, existing[0] ? "hand" : "lead");
  return worldId;
}

export const listWorlds = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const display = await sessionDisplay(context.userId);
    await ensureDemo(sql, context.userId, display);
    const rows = await sql.query<{
      id: string;
      code: string;
      name: string;
      seq: unknown;
      role: MemberRole;
    }>(
      `select w.id, w.code, w.name, w.seq, m.role
       from worlds w join world_members m on m.world_id = w.id
       where m.user_id = $1 order by w.created_at desc`,
      [context.userId],
    );
    return rows.map(
      (r): WorldListItem => ({
        id: r.id,
        code: r.code,
        name: r.name,
        seq: num(r.seq),
        role: r.role,
      }),
    );
  });

export const createWorld = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { name: string; mission: string }) => input)
  .handler(async ({ context, data }) => {
    const name = data.name.trim().slice(0, 60);
    if (!name) throw new Error("Name required");
    const sql = await getSql();
    const display = await sessionDisplay(context.userId);
    const id = nid("wd");
    const code = makeWorldCode();
    await sql.query(`insert into worlds (id, code, name, created_by) values ($1,$2,$3,$4)`, [
      id,
      code,
      name,
      context.userId,
    ]);
    await joinMember(sql, id, context.userId, display, "lead");
    await appendAs(
      sql,
      id,
      { id: context.userId, kind: "human", name: display },
      { baseHash: GENESIS_HASH, eventType: "GENESIS", target: "", payload: { note: "organism online" } },
      context.userId,
    );
    const head = (await sql.query<{ head_hash: string }>(`select head_hash from worlds where id = $1`, [id]))[0]
      ?.head_hash;
    await appendAs(
      sql,
      id,
      { id: context.userId, kind: "human", name: display },
      {
        baseHash: head ?? GENESIS_HASH,
        eventType: "DNA_SET",
        target: "MISSION-1",
        payload: {
          mission: data.mission.trim().slice(0, 400) || `Make ${name} work.`,
          laws: ["Agents propose. They never rewrite reality.", "Stale base hashes reject.", "Humans own approvals."],
          permissions: ["hand: propose", "lead: approve", "agent: propose"],
        },
      },
      context.userId,
    );
    return { code };
  });

export const joinWorld = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string }) => input)
  .handler(async ({ context, data }) => {
    const code = data.code.trim().toUpperCase();
    const sql = await getSql();
    const display = await sessionDisplay(context.userId);
    if (code === DEMO_CODE) {
      await ensureDemo(sql, context.userId, display);
      return { code };
    }
    const worlds = await sql.query<{ id: string }>(`select id from worlds where code = $1`, [code]);
    if (!worlds[0]) throw new Error("No world with that code");
    await joinMember(sql, worlds[0].id, context.userId, display, "hand");
    return { code };
  });

export const getWorld = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { code: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const display = await sessionDisplay(context.userId);
    const code = data.code.trim().toUpperCase();
    if (code === DEMO_CODE) await ensureDemo(sql, context.userId, display);
    const found = await sql.query<{ id: string }>(`select id from worlds where code = $1`, [code]);
    if (!found[0]) throw new Error("No world with that code");
    await joinMember(sql, found[0].id, context.userId, display, "hand");
    return loadSnapshot(sql, found[0].id, context.userId);
  });

export const syncWorld = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; sinceSeq: number; localHead: string }) => input)
  .handler(async ({ context, data }): Promise<SyncFrame> => {
    const sql = await getSql();
    const display = await sessionDisplay(context.userId);
    const code = data.code.trim().toUpperCase();
    if (code === DEMO_CODE) await ensureDemo(sql, context.userId, display);
    const found = await sql.query<{ id: string; seq: unknown; head_hash: string }>(
      `select id, seq, head_hash from worlds where code = $1`,
      [code],
    );
    if (!found[0]) throw new Error("No world with that code");
    await joinMember(sql, found[0].id, context.userId, display, "hand");
    const worldId = found[0].id;
    const authSeq = num(found[0].seq);
    const authHead = found[0].head_hash;
    const sinceSeq = Number.isFinite(data.sinceSeq) ? Math.max(0, data.sinceSeq) : 0;
    const localHead = data.localHead || GENESIS_HASH;

    const empty = (kind: SyncFrame["kind"], extra?: Partial<SyncFrame>): SyncFrame => ({
      protocol: PROTOCOL,
      kind,
      seq: authSeq,
      headHash: authHead,
      sinceSeq,
      entries: [],
      snapshot: null,
      rejects: [],
      members: [],
      agents: [],
      me: null,
      ...extra,
    });

    if (sinceSeq === authSeq && localHead === authHead) {
      return empty("ack");
    }

    if (sinceSeq > 0) {
      const at = await sql.query<{ hash: string }>(
        `select hash from ledger where world_id = $1 and seq = $2`,
        [worldId, sinceSeq],
      );
      if (!at[0] || at[0].hash !== localHead) {
        const snapshot = await loadSnapshot(sql, worldId, context.userId);
        return empty("diverged", { snapshot, rejects: snapshot.rejects, members: snapshot.members, agents: snapshot.agents, me: snapshot.me });
      }
    }

    if (sinceSeq === 0 || sinceSeq > authSeq) {
      const snapshot = await loadSnapshot(sql, worldId, context.userId);
      return empty("snapshot", { snapshot, rejects: snapshot.rejects, members: snapshot.members, agents: snapshot.agents, me: snapshot.me });
    }

    const entries = await loadEntriesAfter(sql, worldId, sinceSeq);
    const snapshotLite = await loadSnapshot(sql, worldId, context.userId);
    return empty("delta", {
      entries,
      rejects: snapshotLite.rejects,
      members: snapshotLite.members,
      agents: snapshotLite.agents,
      me: snapshotLite.me,
    });
  });

export const propose = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; proposal: Proposal }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const { id } = await requireMember(sql, data.code, context.userId);
    const display = await sessionDisplay(context.userId);
    return appendAs(
      sql,
      id,
      { id: context.userId, kind: "human", name: display },
      data.proposal,
      context.userId,
    );
  });

export const dispatchAgent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; agentId: string; order: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const { id } = await requireMember(sql, data.code, context.userId);
    const snap = await loadSnapshot(sql, id, context.userId);
    const minds = await sql.query<{
      agent_id: string;
      name: string;
      model: string;
      online: boolean;
      brief: string;
    }>(`select agent_id, name, model, online, brief from agent_minds where world_id = $1 and agent_id = $2`, [
      id,
      data.agentId,
    ]);
    const mind = minds[0];
    if (!mind) throw new Error("No such agent");
    if (!mind.online) throw new Error("Agent is offline");
    const { askAgent } = await import("./agent.server");
    const asked = await askAgent({
      snap,
      mind: {
        agentId: mind.agent_id,
        name: mind.name,
        model: mind.model,
        online: mind.online,
        briefPreview: "",
        brief: mind.brief,
      },
      order: data.order,
    });
    if (!asked.ok) return { ok: false as const, snap, reason: asked.error, say: "" };
    const applied = await appendAs(
      sql,
      id,
      { id: mind.agent_id, kind: "agent", name: mind.name },
      asked.plan.proposal,
      context.userId,
    );
    return { ...applied, say: asked.plan.say };
  });

export const collideClaim = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; workId: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const { id } = await requireMember(sql, data.code, context.userId);
    const snap = await loadSnapshot(sql, id, context.userId);
    const base = snap.state.headHash;
    const first = await appendAs(
      sql,
      id,
      { id: "research-4", kind: "agent", name: "research-4" },
      { baseHash: base, eventType: "WORK_CLAIMED", target: data.workId, payload: { note: "collision A" } },
      context.userId,
    );
    const second = await appendAs(
      sql,
      id,
      { id: "builder-2", kind: "agent", name: "builder-2" },
      { baseHash: base, eventType: "WORK_CLAIMED", target: data.workId, payload: { note: "collision B" } },
      context.userId,
    );
    return {
      snap: second.snap,
      first: first.ok ? "accepted" : first.reason,
      second: second.ok ? "accepted" : second.reason,
    };
  });

export const injectChaos = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; kind: "requirement" | "offline" | "bad-source" }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const { id } = await requireMember(sql, data.code, context.userId);
    const snap = await loadSnapshot(sql, id, context.userId);
    const base = snap.state.headHash;
    const display = await sessionDisplay(context.userId);
    let proposal: Proposal;
    if (data.kind === "requirement") {
      proposal = {
        baseHash: base,
        eventType: "REQUIREMENT_CHANGED",
        target: "REQ-1",
        payload: {
          id: "REQ-1",
          title: "Login must work on a phone — and support passkeys",
          body: "Requirement changed mid-match. Dependent work is now stale if it assumed passwords only.",
        },
      };
    } else if (data.kind === "offline") {
      proposal = {
        baseHash: base,
        eventType: "AGENT_OFFLINE",
        target: "scout",
        payload: { note: "scout dropped" },
      };
    } else {
      const know = snap.state.entities.find((e) => e.kind === "knowledge" && e.status === "promoted");
      proposal = {
        baseHash: base,
        eventType: "CHAOS_BAD_SOURCE",
        target: know?.id ?? "KNOW-52",
        payload: { note: "source failed verification" },
      };
    }
    return appendAs(sql, id, { id: context.userId, kind: "human", name: display }, proposal, context.userId);
  });
