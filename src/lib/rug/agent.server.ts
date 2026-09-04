import type { AgentMind, EventType, Proposal, Snapshot } from "./types";

const TYPES: EventType[] = [
  "OBSERVATION_LOGGED",
  "UNDERSTAND_PLACED",
  "WORK_CREATED",
  "WORK_CLAIMED",
  "WORK_RELEASED",
  "EVIDENCE_ATTACHED",
  "CAUSE_CONFIRMED",
  "FIX_PROPOSED",
  "DECISION_PROPOSED",
  "ARTIFACT_COMMITTED",
  "HANDOFF",
  "ESCALATE",
  "COORD_SET",
  "INTERPRETATION_LOGGED",
  "ANCESTOR_REREAD",
  "CANON_SET",
  "SCHISM_MARKED",
];

function publicView(snap: Snapshot, agentId: string): string {
  const { state, ledger } = snap;
  const work = state.entities
    .filter((e) => e.kind === "work")
    .map((e) => {
      const lease = e.owner
        ? ` lease=${String(e.fields.leaseMinutes ?? "-")}m cannot=${Array.isArray(e.fields.cannot) ? e.fields.cannot.join(",") : "-"}`
        : "";
      return `${e.id} [${e.status} owner=${e.owner || "-"}] ${e.title} — ${e.body}${lease}`;
    })
    .join("\n");
  const knowledge =
    agentId === "scout"
      ? "(scout cannot see knowledge)"
      : state.entities
          .filter((e) => e.kind === "knowledge" || e.kind === "observation" || e.kind === "requirement")
          .map((e) => `${e.id} [${e.status}] ${e.title} — ${e.body}`)
          .join("\n");
  const artifacts =
    agentId === "scout"
      ? ""
      : state.entities
          .filter((e) => e.kind === "artifact")
          .map((e) => `${e.id} [${e.status}] ${e.title} hash=${String(e.fields.hash ?? "")}`)
          .join("\n");
  const coord = state.entities
    .filter((e) => e.kind === "agent")
    .map((e) => {
      const f = e.fields;
      return `${e.id} status=${String(f.status ?? e.status)} claim=${String(f.claim || "-")} attention=${String(f.attention ?? "low")} blocked_by=${String(f.blockedBy || "-")} requires=${String(f.requires || "-")} can=${Array.isArray(f.can) ? f.can.join(";") : ""} cannot=${Array.isArray(f.cannot) ? f.cannot.join(";") : ""}`;
    })
    .join("\n");
  const recent = ledger
    .slice(-12)
    .map((e) => `#${e.seq} ${e.eventType} ${e.target} by ${e.actorName}`)
    .join("\n");
  return `HEAD ${state.headHash}
SEQ ${state.seq}
MISSION ${state.constitution.mission}

LAW: Agents don't need seats. Work needs owners. You propose. You never rewrite reality.

COORDINATION
${coord}

WORK
${work}

KNOWLEDGE / OBSERVATIONS / REQUIREMENTS
${knowledge}

ARTIFACTS
${artifacts || "(hidden or none)"}

RECENT LEDGER
${recent}`;
}

function extractJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no json");
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

export type AgentPlan = { say: string; proposal: Proposal };

export async function askAgent(opts: {
  snap: Snapshot;
  mind: AgentMind & { brief: string };
  order: string;
  forcedBaseHash?: string;
}): Promise<{ ok: true; plan: AgentPlan } | { ok: false; error: string }> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return { ok: false, error: "Agent runtime unavailable." };

  const base = opts.forcedBaseHash ?? opts.snap.state.headHash;
  const system = `You are ${opts.mind.agentId}, an agent in RUG.
You never rewrite reality. You PROPOSE one ledger event against the given base_hash.
Return ONLY JSON: { "say": string, "event_type": one of ${TYPES.join(",")}, "target": string, "payload": object }
Rules:
- Copy base_hash from the prompt. Do not invent a hash.
- payload must be small. No giant prose blobs. Documents are references/hashes.
- Do not approve decisions. Humans own that.
- Do not publish knowledge. Your lease forbids it.
- Do not invent citations. If you lack evidence, log an observation or claim work.
- One event only. Prefer CLAIM, EVIDENCE, HANDOFF, ESCALATE, COORD_SET.`;

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-4.5",
      max_tokens: 700,
      temperature: 0.4,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `PRIVATE BRIEF\n${opts.mind.brief}\n\nPUBLIC WORLD (ledger projection)\n${publicView(opts.snap, opts.mind.agentId).slice(0, 9000)}\n\nbase_hash: ${base}\nORDER: ${opts.order.slice(0, 800)}`,
        },
      ],
    }),
  });
  if (!res.ok) return { ok: false, error: `Agent refused (${res.status}).` };
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content ?? "";
  try {
    const json = extractJson(text);
    const eventType = String(json.event_type ?? "") as EventType;
    if (!TYPES.includes(eventType)) return { ok: false, error: "Agent proposed an illegal event." };
    return {
      ok: true,
      plan: {
        say: String(json.say ?? "").slice(0, 280),
        proposal: {
          baseHash: base,
          eventType,
          target: String(json.target ?? "").slice(0, 40),
          payload:
            json.payload && typeof json.payload === "object" && !Array.isArray(json.payload)
              ? (json.payload as { [key: string]: import("./types").Json })
              : {},
        },
      },
    };
  } catch {
    return { ok: false, error: "Agent returned an unreadable proposal." };
  }
}
