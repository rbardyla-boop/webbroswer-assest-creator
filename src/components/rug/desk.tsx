import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { KnowledgeView } from "@/components/rug/canon";
import { UserButton } from "@/lib/auth/gates";
import { missionGates, missionWon } from "@/lib/rug/mission";
import { useP2PRoom } from "@/lib/multiplayer/use-p2p-room";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { shortHash, HEALTH_LABELS, healthTone } from "@/lib/rug/format";
import { collideClaim, dispatchAgent, injectChaos, propose } from "@/lib/rug/server";
import { useWorldSync } from "@/lib/rug/use-world-sync";
import type { Entity, EventType, NetHud, Proposal, Snapshot } from "@/lib/rug/types";
import { cn } from "@/lib/utils";

type Tab = "world" | "knowledge" | "audit" | "talk" | "sync" | "act";
type Presence = { name: string; hue: number; tab: string };
type GrowKind = "claim" | "lease" | "evidence" | "cause" | "fix" | "know" | "handoff" | "escalate";

const TABS: { id: Tab; label: string }[] = [
  { id: "world", label: "World" },
  { id: "knowledge", label: "Lore" },
  { id: "audit", label: "Ledger" },
  { id: "sync", label: "Sync" },
  { id: "talk", label: "Talk" },
  { id: "act", label: "Act" },
];

export function Desk({ code }: { code: string }) {
  const qc = useQueryClient();
  const { query: q, net, resync } = useWorldSync(code);
  const [tab, setTab] = useState<Tab>("world");
  const [notice, setNotice] = useState("");

  const snap = q.data;
  const p2p = useP2PRoom({
    room: `rug-${code}`.slice(0, 64),
    name: snap?.me.displayName ?? "hand",
  });
  const [peers, setPeers] = useState<Record<string, Presence>>({});

  useEffect(() => {
    return p2p.onMessage((from, data) => {
      const msg = data as { t?: string; name?: string; hue?: number; tab?: string; seq?: number };
      if (msg.t === "here") {
        setPeers((p) => ({ ...p, [from]: { name: msg.name ?? from, hue: msg.hue ?? 0, tab: msg.tab ?? "world" } }));
      }
      if (msg.t === "head" && typeof msg.seq === "number") {
        const cur = qc.getQueryData<Snapshot>(["world", code]);
        if (!cur || msg.seq > cur.world.seq) void q.refetch();
      }
    });
  }, [p2p, qc, code, q]);

  useEffect(() => {
    if (!snap) return;
    const id = window.setInterval(() => {
      p2p.broadcast({ t: "here", name: snap.me.displayName, hue: snap.me.hue, tab });
      p2p.broadcast({ t: "head", seq: snap.world.seq, hash: snap.world.headHash });
    }, 800);
    return () => window.clearInterval(id);
  }, [p2p, snap, tab]);

  const onSnap = (next: Snapshot, extra?: string) => {
    qc.setQueryData(["world", code], next);
    p2p.broadcast({ t: "head", seq: next.world.seq, hash: next.world.headHash });
    if (extra) {
      setNotice(extra);
      toast.message(extra);
    }
  };

  if (q.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg text-muted">Loading the organism…</div>
    );
  }
  if (q.isError || !snap) {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg px-6 text-center">
        <div>
          <p className="text-bad">{(q.error as Error | undefined)?.message ?? "World missing."}</p>
          <Link to="/" className="mt-4 inline-block text-sm text-muted hover:text-fg">
            Back
          </Link>
        </div>
      </div>
    );
  }

  const live = Object.entries(peers).filter(([id]) => id !== p2p.selfId);

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 md:px-6">
        <Link to="/" className="font-display text-lg tracking-tight">
          RUG
        </Link>
        <span className="text-fg">{snap.world.name}</span>
        <button
          type="button"
          className="h-11 font-mono text-xs text-subtle hover:text-fg"
          onClick={() => {
            void navigator.clipboard.writeText(snap.world.code);
            toast.message("Invite code copied");
          }}
        >
          {snap.world.code}
        </button>
        <span className="hidden font-mono text-xs text-subtle sm:inline">
          #{snap.world.seq} · {shortHash(snap.world.headHash)}
        </span>
        <SyncChip net={net} />
        <div className="ml-auto flex items-center gap-2">
          {live.map(([id, p]) => (
            <span
              key={id}
              className="size-2 rounded-full"
              style={{ background: `var(--color-presence-${p.hue % 6})` }}
              title={p.name}
            />
          ))}
          <UserButton />
        </div>
      </header>
      <HealthStrip health={snap.state.health} />
      <Briefing mission={snap.state.constitution.mission} health={snap.state.health} />
      {notice ? (
        <div className="border-b border-border bg-raised px-4 py-2 font-mono text-xs text-muted md:px-6">
          {notice}
        </div>
      ) : null}
      <div className="flex flex-1 flex-col md:grid md:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <nav className="flex gap-1 overflow-x-auto border-b border-border px-2 py-2 md:px-4">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "h-11 rounded-sm px-4 text-sm",
                  tab === t.id ? "bg-raised text-fg" : "text-muted hover:text-fg",
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="p-4 md:p-6">
            {tab === "world" ? <WorldBoard snap={snap} /> : null}
            {tab === "knowledge" ? <KnowledgeView code={code} snap={snap} onSnap={onSnap} /> : null}
            {tab === "audit" ? <AuditView snap={snap} /> : null}
            {tab === "sync" ? <SyncView snap={snap} net={net} onResync={resync} /> : null}
            {tab === "talk" ? <TalkView code={code} snap={snap} onSnap={onSnap} /> : null}
            {tab === "act" ? <ActPanel code={code} snap={snap} onSnap={onSnap} /> : null}
          </div>
        </div>
        <aside className="hidden border-l border-border md:block">
          <ActPanel code={code} snap={snap} onSnap={onSnap} compact />
        </aside>
      </div>
    </div>
  );
}

function SyncChip({ net }: { net: NetHud }) {
  const locked = net.kind === "ack" || (net.kind === "delta" && net.localHead === net.authHead);
  const label =
    net.kind === "diverged" ? "DIVERGED" : net.kind === "snapshot" ? "SNAPSHOT" : locked ? "LOCKED" : "CATCHING";
  const tone =
    net.kind === "diverged" ? "text-bad" : locked ? "text-ok" : "text-warn";
  return (
    <span className={cn("font-mono text-xs tracking-widest", tone)}>
      {label}
      {net.rttMs ? ` · ${net.rttMs}ms` : ""}
    </span>
  );
}

function SyncView({ snap, net, onResync }: { snap: Snapshot; net: NetHud; onResync: () => void }) {
  const match = net.localHead === net.authHead && net.localSeq === net.authSeq;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="font-mono text-xs tracking-widest text-subtle uppercase">Game state sync</p>
        <h2 className="mt-2 font-display text-2xl tracking-tight">Clients send intent. Authority writes reality.</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Skybreak lockstep, mapped onto the organization. HELLO is the DNA. INPUT is a proposal.
          HASH is the ledger head. Stale base is an old tick. Divergence is not a chat disagreement.
          It is a hash mismatch, and the desk resyncs from the chain.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
        <Stat k="Local tick" v={`#${net.localSeq}`} />
        <Stat k="Auth tick" v={`#${net.authSeq}`} />
        <Stat k="Local hash" v={shortHash(net.localHead)} />
        <Stat k="Auth hash" v={shortHash(net.authHead)} />
        <Stat k="Frame" v={net.kind} />
        <Stat k="RTT" v={`${net.rttMs}ms`} />
        <Stat k="Deltas" v={String(net.deltas)} />
        <Stat k="Resyncs" v={`${net.snapshots} / ${net.diverged} div`} />
      </dl>
      <p className={cn("font-mono text-sm", match ? "text-ok" : "text-bad")}>
        {match ? "Projection matches authority." : "Projection disagrees. Resync from the ledger."}
      </p>
      <Button variant="outline" onClick={onResync}>
        Force snapshot
      </Button>
      <div>
        <h3 className="font-mono text-xs tracking-widest text-subtle uppercase">Wire</h3>
        <ol className="mt-3 space-y-px overflow-hidden rounded-md border border-border font-mono text-xs">
          <li className="bg-surface px-4 py-2">HELLO · protocol {snap.world.seq ? "1" : "1"} · DNA is session identity</li>
          <li className="bg-bg px-4 py-2">INPUT · PROPOSE / CLAIM / LEASE against current head</li>
          <li className="bg-surface px-4 py-2">HASH · head {shortHash(snap.world.headHash)} at tick #{snap.world.seq}</li>
          <li className="bg-bg px-4 py-2">WINDOW · stale base rejects · same as old tick / out of range</li>
        </ol>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="bg-bg px-4 py-3">
      <dt className="font-mono text-xs text-subtle">{k}</dt>
      <dd className="mt-1 font-mono text-sm text-fg">{v}</dd>
    </div>
  );
}

function Briefing({ mission, health }: { mission: string; health: Snapshot["state"]["health"] }) {
  const trap = health.trust >= 85 && health.knowledge < 50;
  return (
    <div className="border-b border-border px-4 py-4 md:px-6">
      <p className="text-sm leading-relaxed text-muted">
        <span className="text-fg">This match.</span> {mission}{" "}
        {trap
          ? "Everyone agrees. That is not ancestry. Open Lore."
          : "Agents don't get seats. Work gets owners."}
      </p>
    </div>
  );
}

function HealthStrip({ health }: { health: Snapshot["state"]["health"] }) {
  return (
    <div className="grid grid-cols-3 gap-px overflow-x-auto border-b border-border bg-border sm:grid-cols-5 lg:grid-cols-9">
      {HEALTH_LABELS.map(([key, label]) => {
        const n = health[key];
        const tone = healthTone(n);
        return (
          <div key={key} className="bg-bg px-3 py-2">
            <div className="flex items-baseline justify-between font-mono text-xs">
              <span className="text-subtle">{label}</span>
              <span
                className={cn(
                  "tabular-nums",
                  tone === "ok" && "text-ok",
                  tone === "warn" && "text-warn",
                  tone === "bad" && "text-bad",
                )}
              >
                {n}
              </span>
            </div>
            <div className="mt-1 h-1 rounded-full bg-raised">
              <div
                className={cn(
                  "h-1 rounded-full",
                  tone === "ok" && "bg-ok",
                  tone === "warn" && "bg-warn",
                  tone === "bad" && "bg-bad",
                )}
                style={{ width: `${n}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Status({ value }: { value: string }) {
  const tone =
    value === "contested" || value === "offline" || value === "drift"
      ? "text-bad"
      : value === "claimed" || value === "incomplete" || value === "changed"
        ? "text-warn"
        : value === "promoted" ||
            value === "canon" ||
            value === "approved" ||
            value === "online" ||
            value === "working" ||
            value === "revalidated"
          ? "text-ok"
          : value === "idle"
            ? "text-subtle"
          : "text-subtle";
  return <span className={cn("font-mono text-xs", tone)}>{value}</span>;
}

function asList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

function WorldBoard({ snap }: { snap: Snapshot }) {
  const groups: { title: string; kind: Entity["kind"] }[] = [
    { title: "Mission", kind: "mission" },
    { title: "Work", kind: "work" },
    { title: "Observations", kind: "observation" },
    { title: "Artifacts", kind: "artifact" },
    { title: "Decisions", kind: "decision" },
    { title: "Requirements", kind: "requirement" },
  ];
  const gates = missionGates(snap.state);
  const won = missionWon(snap.state);
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 font-mono text-xs tracking-widest text-subtle uppercase">
          {won ? "Mission won" : "Victory"}
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {gates.map((g) => (
            <li key={g.id} className="rounded-md border border-border bg-surface p-4">
              <div className={cn("font-mono text-xs", g.ok ? "text-ok" : "text-bad")}>{g.ok ? "HOLD" : "OPEN"}</div>
              <div className="mt-1 text-sm text-fg">{g.label}</div>
              <p className="mt-2 text-xs leading-relaxed text-muted">{g.detail}</p>
            </li>
          ))}
        </ul>
      </section>
      <CoordFloor snap={snap} />
      <div className="grid gap-8 lg:grid-cols-2">
        {groups.map((g) => {
          const items = snap.state.entities.filter((e) => e.kind === g.kind);
          if (!items.length) return null;
          return (
            <section key={g.kind}>
              <h2 className="mb-3 font-mono text-xs tracking-widest text-subtle uppercase">{g.title}</h2>
              <ul className="space-y-2">
                {items.map((e) => (
                  <li key={e.id} className="rounded-md border border-border bg-surface p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-mono text-xs text-muted">{e.id}</span>
                      <Status value={e.status} />
                    </div>
                    <div className="mt-1 text-fg">{e.title}</div>
                    {e.body ? <p className="mt-2 text-sm leading-relaxed text-muted">{e.body}</p> : null}
                    {e.owner ? (
                      <p className="mt-2 font-mono text-xs text-subtle">
                        owner {e.owner}
                        {e.fields.leaseMinutes ? ` · lease ${String(e.fields.leaseMinutes)}m` : ""}
                        {e.fields.requires ? ` · needs ${String(e.fields.requires)}` : ""}
                      </p>
                    ) : null}
                    {asList(e.fields.cannot).length ? (
                      <p className="mt-1 font-mono text-xs text-subtle">
                        cannot {asList(e.fields.cannot).join(" · ")}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function CoordFloor({ snap }: { snap: Snapshot }) {
  const agents = snap.state.entities.filter((e) => e.kind === "agent");
  return (
    <section>
      <h2 className="mb-3 font-mono text-xs tracking-widest text-subtle uppercase">Coordination</h2>
      <p className="mb-3 text-sm text-muted">
        Not body language. Machine-readable: who is working, on what, for how long, what they cannot
        do.
      </p>
      <ul className="grid gap-2 md:grid-cols-3">
        {agents.map((a) => (
          <li key={a.id} className="rounded-md border border-border bg-surface p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-xs text-muted">{a.id}</span>
              <Status value={String(a.fields.status ?? a.status)} />
            </div>
            <div className="mt-1 text-fg">{a.title}</div>
            <p className="mt-2 font-mono text-xs leading-relaxed text-subtle">
              {String(a.fields.claim || "no claim")} · {String(a.fields.leaseMinutes ?? "—")}m ·{" "}
              {String(a.fields.attention ?? "low")} attn
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted">{a.body}</p>
            <p className="mt-2 font-mono text-xs text-subtle">
              can {asList(a.fields.can).join(" · ") || "—"}
            </p>
            <p className="mt-1 font-mono text-xs text-subtle">
              cannot {asList(a.fields.cannot).join(" · ") || "—"}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AuditView({ snap }: { snap: Snapshot }) {
  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <section>
        <h2 className="mb-3 font-mono text-xs tracking-widest text-subtle uppercase">Head {shortHash(snap.world.headHash)}</h2>
        <ol className="overflow-hidden rounded-md border border-border">
          {[...snap.ledger].reverse().map((e, i) => (
            <li
              key={e.id}
              className={cn(
                "flex flex-wrap gap-x-3 gap-y-1 px-4 py-2.5 font-mono text-xs",
                i % 2 === 0 ? "bg-surface" : "bg-bg",
              )}
            >
              <span className="w-8 text-subtle">#{e.seq}</span>
              <span className="text-muted">{shortHash(e.hash)}</span>
              <span className="text-fg">{e.eventType}</span>
              <span className="text-muted">{e.target}</span>
              <span className="text-subtle">{e.actorName}</span>
            </li>
          ))}
        </ol>
      </section>
      <section className="space-y-8">
        <div>
          <h2 className="mb-3 font-mono text-xs tracking-widest text-subtle uppercase">Rejected</h2>
          {snap.rejects.length === 0 ? (
            <p className="text-sm leading-relaxed text-muted">
              No rejections yet. Run the collision — two agents, same work, same head. One lands.
              One is stale.
            </p>
          ) : (
            <ul className="space-y-2">
              {snap.rejects.map((r) => (
                <li key={r.id} className="rounded-md border border-border bg-surface p-4">
                  <div className="font-mono text-xs text-bad">{r.reason}</div>
                  <div className="mt-1 font-mono text-xs text-muted">
                    {r.actorName} · {r.eventType} {r.target}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2 className="mb-3 font-mono text-xs tracking-widest text-subtle uppercase">DNA</h2>
          <p className="text-sm leading-relaxed text-fg">{snap.state.constitution.mission}</p>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted">
            {snap.state.constitution.laws.map((law) => (
              <li key={law}>{law}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function TalkView({
  code,
  snap,
  onSnap,
}: {
  code: string;
  snap: Snapshot;
  onSnap: (s: Snapshot, extra?: string) => void;
}) {
  const [text, setText] = useState("");
  const send = useMutation({
    mutationFn: (proposal: Proposal) => propose({ data: { code, proposal } }),
    onSuccess: (r) => {
      onSnap(r.snap, r.ok ? "Utterance captured as work. The sentence can die." : `REJECT ${r.reason}`);
      if (r.ok) setText("");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const captured = snap.ledger.filter((e) => e.eventType === "INTENT_CAPTURED").slice(-12).reverse();
  const fromTalk = snap.state.entities.filter((e) => e.kind === "work" && e.fields.utterance);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="font-mono text-xs tracking-widest text-subtle uppercase">A view, not the system</p>
        <h2 className="mt-2 font-display text-2xl tracking-tight">Say it. It becomes work.</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          This is not a group chat with an extra seat. The utterance is disposable. The work item,
          the owner, the lease, and the evidence are not.
        </p>
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Can somebody check why checkout conversion fell?"
      />
      <Button
        disabled={send.isPending || !text.trim()}
        onClick={() =>
          send.mutate({
            baseHash: snap.state.headHash,
            eventType: "INTENT_CAPTURED",
            target: "",
            payload: { utterance: text.trim() },
          })
        }
      >
        Capture as work
      </Button>
      {fromTalk.length ? (
        <ul className="space-y-2">
          {fromTalk.map((w) => (
            <li key={w.id} className="rounded-md border border-border bg-surface p-4">
              <div className="flex items-baseline justify-between gap-3 font-mono text-xs">
                <span className="text-muted">{w.id}</span>
                <Status value={w.status} />
              </div>
              <p className="mt-2 text-sm leading-relaxed text-fg">{String(w.fields.utterance)}</p>
              <p className="mt-2 font-mono text-xs text-subtle">utterance died · object remains</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-subtle">No captured talk yet. The empty thread is correct.</p>
      )}
      {captured.length ? (
        <ol className="font-mono text-xs text-subtle">
          {captured.map((e) => (
            <li key={e.id}>
              #{e.seq} {e.actorName}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function ActPanel({
  code,
  snap,
  onSnap,
  compact,
}: {
  code: string;
  snap: Snapshot;
  onSnap: (s: Snapshot, extra?: string) => void;
  compact?: boolean;
}) {
  const [mode, setMode] = useState<"read" | "understand" | "grow" | "agent">("grow");
  const [growKind, setGrowKind] = useState<GrowKind>("claim");
  const [text, setText] = useState("");
  const [target, setTarget] = useState("WORK-22");
  const [agentId, setAgentId] = useState(snap.agents[0]?.agentId ?? "research-4");

  const send = useMutation({
    mutationFn: (proposal: Proposal) => propose({ data: { code, proposal } }),
    onSuccess: (r) => {
      onSnap(r.snap, r.ok ? "Entry accepted." : `REJECT ${r.reason}`);
      if (r.ok) setText("");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const agent = useMutation({
    mutationFn: () => dispatchAgent({ data: { code, agentId, order: text || "Act on the current world." } }),
    onSuccess: (r) => {
      onSnap(r.snap, r.ok ? r.say || "Agent entry accepted." : `REJECT ${r.reason}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const collide = useMutation({
    mutationFn: () => collideClaim({ data: { code, workId: target || "WORK-22" } }),
    onSuccess: (r) => {
      onSnap(r.snap, `research-4 ${r.first} · builder-2 ${r.second}`);
    },
  });
  const chaos = useMutation({
    mutationFn: (kind: "requirement" | "offline" | "bad-source") => injectChaos({ data: { code, kind } }),
    onSuccess: (r) => onSnap(r.snap, r.ok ? "Chaos applied." : `REJECT ${r.reason}`),
  });

  const workIds = useMemo(
    () => snap.state.entities.filter((e) => e.kind === "work").map((e) => e.id),
    [snap],
  );

  const fire = () => {
    const baseHash = snap.state.headHash;
    if (mode === "read") {
      send.mutate({
        baseHash,
        eventType: "OBSERVATION_LOGGED",
        target: "",
        payload: { title: text.slice(0, 80) || "Observation", body: text },
      });
      return;
    }
    if (mode === "understand") {
      send.mutate({
        baseHash,
        eventType: "UNDERSTAND_PLACED",
        target: target || "OBS-881",
        payload: { affects: "AUTH.SYSTEM", confidence: 0.7 },
      });
      return;
    }
    const kindToEvent: Record<GrowKind, EventType> = {
      claim: "WORK_CLAIMED",
      lease: "LEASE_GRANTED",
      evidence: "EVIDENCE_ATTACHED",
      cause: "CAUSE_CONFIRMED",
      fix: "FIX_PROPOSED",
      know: "KNOWLEDGE_PROMOTED",
      handoff: "HANDOFF",
      escalate: "ESCALATE",
    };
    const payload: Proposal["payload"] =
      growKind === "evidence"
        ? { text, source: snap.me.displayName }
        : growKind === "cause"
          ? { cause: text }
          : growKind === "fix"
            ? { fix: text }
            : growKind === "know"
              ? { title: text.slice(0, 80), body: text, evidence: `ledger:${snap.world.seq}` }
              : growKind === "lease"
                ? { agentId, leaseMinutes: 20, objective: text || "Bounded lease" }
                : growKind === "handoff"
                  ? { to: agentId }
                  : growKind === "escalate"
                    ? { requires: "human_approval", note: text }
                    : { note: text };
    send.mutate({
      baseHash,
      eventType: kindToEvent[growKind],
      target: target || workIds[0] || "WORK-22",
      payload,
    });
  };

  return (
    <div className={cn("space-y-5", compact && "p-5")}>
      <div>
        <h2 className="font-mono text-xs tracking-widest text-subtle uppercase">The test</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Two agents claim the same work against the same head. One is accepted. One is stale.
        </p>
        <Button
          variant="outline"
          className="mt-3 w-full"
          disabled={collide.isPending}
          onClick={() => collide.mutate()}
        >
          Collide on {target || "WORK-22"}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1">
        {(["read", "understand", "grow", "agent"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "h-11 rounded-sm px-3 text-sm capitalize",
              mode === m ? "bg-accent text-accent-fg" : "bg-raised text-muted",
            )}
          >
            {m}
          </button>
        ))}
      </div>

      <label className="block text-xs text-subtle">
        Target
        <select
          className="mt-1 h-11 w-full rounded-sm border border-border bg-raised px-3 text-sm text-fg"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          {snap.state.entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.id} · {e.title}
            </option>
          ))}
        </select>
      </label>

      {mode === "grow" ? (
        <label className="block text-xs text-subtle">
          Grow as
          <select
            className="mt-1 h-11 w-full rounded-sm border border-border bg-raised px-3 text-sm text-fg"
            value={growKind}
            onChange={(e) => setGrowKind(e.target.value as GrowKind)}
          >
            <option value="claim">Claim work</option>
            <option value="lease">Grant a lease</option>
            <option value="evidence">Attach evidence</option>
            <option value="cause">Confirm cause</option>
            <option value="fix">Propose a fix</option>
            <option value="know">Promote knowledge</option>
            <option value="handoff">Handoff</option>
            <option value="escalate">Escalate</option>
          </select>
        </label>
      ) : null}

      {mode === "agent" || (mode === "grow" && (growKind === "lease" || growKind === "handoff")) ? (
        <label className="block text-xs text-subtle">
          Agent — private brief, public ledger
          <select
            className="mt-1 h-11 w-full rounded-sm border border-border bg-raised px-3 text-sm text-fg"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            {snap.agents.map((a) => (
              <option key={a.agentId} value={a.agentId}>
                {a.name} {a.online ? "" : "(offline)"}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          mode === "read"
            ? "What exists right now?"
            : mode === "understand"
              ? "Place this. What does it affect?"
              : mode === "agent"
                ? "Order for this agent. It cannot see the other agents’ briefs."
                : "A small, typed change. No giant prose."
        }
      />
      <Button
        className="w-full"
        disabled={send.isPending || agent.isPending}
        onClick={() => (mode === "agent" ? agent.mutate() : fire())}
      >
        {mode === "agent" ? "Dispatch" : "Propose"}
      </Button>

      <div>
        <p className="mb-2 font-mono text-xs tracking-widest text-subtle uppercase">Chaos</p>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="ghost" size="sm" onClick={() => chaos.mutate("requirement")}>
            Change req
          </Button>
          <Button variant="ghost" size="sm" onClick={() => chaos.mutate("offline")}>
            Drop scout
          </Button>
          <Button variant="ghost" size="sm" onClick={() => chaos.mutate("bad-source")}>
            Bad source
          </Button>
        </div>
      </div>
    </div>
  );
}
