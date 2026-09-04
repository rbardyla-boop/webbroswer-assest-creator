import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  ancestryOf,
  forest,
  labelClaim,
  lineage,
  needsReread,
  primaryOf,
  type TreeNode,
} from "@/lib/rug/ancestry";
import { missionGates, missionWon } from "@/lib/rug/mission";
import { propose } from "@/lib/rug/server";
import type { Entity, Snapshot } from "@/lib/rug/types";
import { cn } from "@/lib/utils";

export function KnowledgeView({
  code,
  snap,
  onSnap,
}: {
  code: string;
  snap: Snapshot;
  onSnap: (s: Snapshot, extra?: string) => void;
}) {
  const trees = useMemo(() => forest(snap.state.entities, "ART-001"), [snap.state.entities]);
  const drift = snap.state.entities.find((e) => e.id === "KNOW-52") ?? snap.state.entities.find(needsReread);
  const [picked, setPicked] = useState<string>(drift?.id ?? "KNOW-52");
  const selected = snap.state.entities.find((e) => e.id === picked) ?? drift;
  const gates = missionGates(snap.state);
  const won = missionWon(snap.state);

  const act = useMutation({
    mutationFn: (kind: "clone" | "reread" | "restore" | "recombine-a" | "recombine-b") => {
      const baseHash = snap.state.headHash;
      if (kind === "reread") {
        return propose({
          data: {
            code,
            proposal: {
              baseHash,
              eventType: "ANCESTOR_REREAD",
              target: selected?.id ?? "KNOW-52",
              payload: { from: "ART-001" },
            },
          },
        });
      }
      if (kind === "restore") {
        return propose({
          data: {
            code,
            proposal: {
              baseHash,
              eventType: "KNOWLEDGE_PROMOTED",
              target: "KNOW-60",
              payload: {
                id: "KNOW-60",
                title: "Password policy from ART-001",
                body: "Restored by rereading the ancestor. 12 characters OR a passkey.",
                evidence: "ART-001#p0l1cy04",
                parentId: "ART-001",
                sourceIds: ["ART-001"],
                evidenceHashes: ["p0l1cy04"],
                claims: [
                  "passwords_12_or_passkey",
                  "passkeys_preferred",
                  "lockout_5",
                  "session_12h",
                  "mfa_admin",
                  "reset_email_only",
                  "no_sms",
                  "rotate_90d",
                  "phone_first",
                  "emergency_breakglass",
                ],
                reread: true,
                critical: true,
              },
            },
          },
        });
      }
      if (kind === "recombine-a" || kind === "recombine-b") {
        const model = kind === "recombine-a" ? "gpt" : "grok";
        return propose({
          data: {
            code,
            proposal: {
              baseHash,
              eventType: "INTERPRETATION_LOGGED",
              target: "ART-001",
              payload: {
                ancestor: "ART-001",
                model,
                title: `${model} rereads ART-001`,
                body: "Independent return to source. Not inherited from KNOW-52.",
                claims: ["passwords_12_or_passkey", "passkeys_preferred"],
              },
            },
          },
        });
      }
      return propose({
        data: {
          code,
          proposal: {
            baseHash,
            eventType: "KNOWLEDGE_PROMOTED",
            target: "KNOW-77",
            payload: {
              id: "KNOW-77",
              title: "Policy: passwords require complex characters",
              body: "Cloned from KNOW-52. The ancestor was not opened.",
              evidence: "KNOW-52",
              parentId: "KNOW-52",
              sourceIds: ["KNOW-52"],
              claims: ["complex_chars"],
              critical: true,
            },
          },
        },
      });
    },
    onSuccess: (r, kind) => {
      const ok =
        kind === "reread"
          ? "Returned to ancestor."
          : kind === "restore"
            ? "Canon restored from ART-001."
            : kind.startsWith("recombine")
              ? "Independent reading logged."
              : "Entry accepted.";
      onSnap(r.snap, r.ok ? ok : `REJECT ${r.reason}`);
    },
  });

  return (
    <div className="space-y-8">
      <div className="max-w-2xl">
        <p className="font-mono text-xs tracking-widest text-subtle uppercase">Repetitive fading</p>
        <h2 className="mt-2 font-display text-2xl tracking-tight">Consensus does not prove ancestry.</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Trust is {snap.state.health.trust}. Coherence is {snap.state.health.coherence}. Knowledge
          is {snap.state.health.knowledge}. Everyone quotes KNOW-52. KNOW-52 never met the document.
        </p>
      </div>

      <ol className="grid gap-2 sm:grid-cols-5">
        {gates.map((g) => (
          <li key={g.id} className="rounded-md border border-border bg-surface px-3 py-3">
            <div className={cn("font-mono text-xs", g.ok ? "text-ok" : "text-bad")}>{g.ok ? "HOLD" : "OPEN"}</div>
            <div className="mt-1 text-sm text-fg">{g.label}</div>
          </li>
        ))}
      </ol>
      {won ? (
        <p className="font-mono text-sm text-ok">MISSION WON. Artifact, approval, ancestry.</p>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(16rem,0.9fr)]">
        <section>
          <h3 className="mb-3 font-mono text-xs tracking-widest text-subtle uppercase">Lineage</h3>
          <div className="rounded-md border border-border bg-surface p-4">
            {trees.map((n) => (
              <Branch key={n.entity.id} node={n} selected={picked} onSelect={setPicked} />
            ))}
          </div>
        </section>
        {selected ? <Inspector entity={selected} entities={snap.state.entities} /> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate("clone")}>
          Promote KNOW-52 as policy
        </Button>
        <Button disabled={act.isPending} onClick={() => act.mutate("reread")}>
          Return to ancestor
        </Button>
        <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate("recombine-a")}>
          GPT rereads ART-001
        </Button>
        <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate("recombine-b")}>
          Grok rereads ART-001
        </Button>
        {selected && ancestryOf(selected).reread ? (
          <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate("restore")}>
            Restore from ancestor
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Branch({
  node,
  selected,
  onSelect,
}: {
  node: TreeNode;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const e = node.entity;
  const a = ancestryOf(e);
  const drift = needsReread(e);
  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(e.id)}
        className={cn(
          "flex min-h-11 w-full items-baseline justify-between gap-3 rounded-sm px-2 py-2 text-left",
          selected === e.id ? "bg-raised" : "hover:bg-raised/60",
        )}
      >
        <span className="min-w-0">
          <span className="font-mono text-xs text-subtle">{e.id}</span>
          <span className="ml-2 text-sm text-fg">{e.title}</span>
        </span>
        <span className={cn("shrink-0 font-mono text-xs", drift ? "text-bad" : "text-subtle")}>
          {drift ? `DRIFT DEPTH ${a.depth}` : a.canon ? "CANON" : a.depth ? `d${a.depth}` : "SOURCE"}
        </span>
      </button>
      {node.children.length ? (
        <div className="ml-3 border-l border-border pl-3">
          {node.children.map((c) => (
            <Branch key={c.entity.id} node={c} selected={selected} onSelect={onSelect} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Inspector({ entity, entities }: { entity: Entity; entities: Entity[] }) {
  const a = ancestryOf(entity);
  const origin = primaryOf(entities, entity.id);
  const originClaims = origin ? ancestryOf(origin).claims : [];
  const chain = lineage(entities, entity.id);
  const lost = a.lost.length ? a.lost : originClaims.filter((c) => !a.claims.includes(c));
  const mutated = a.mutated;
  return (
    <aside className="rounded-md border border-border bg-surface p-5">
      <p className="font-mono text-xs tracking-widest text-subtle uppercase">{entity.id}</p>
      <h3 className="mt-2 font-display text-xl tracking-tight">{entity.title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-muted">{entity.body}</p>
      <dl className="mt-5 space-y-3 font-mono text-xs">
        <div>
          <dt className="text-subtle">Lost</dt>
          <dd className="mt-1 text-bad">{lost.length ? lost.map(labelClaim).join(" · ") : "—"}</dd>
        </div>
        <div>
          <dt className="text-subtle">Mutated</dt>
          <dd className="mt-1 text-warn">
            {mutated.length ? mutated.map(labelClaim).join(" · ") : "—"}
            {mutated.includes("complex_chars") ? " ← 12 characters OR a passkey" : ""}
          </dd>
        </div>
        <div>
          <dt className="text-subtle">Ancestry depth</dt>
          <dd className={cn("mt-1", needsReread(entity) ? "text-bad" : "text-fg")}>{a.depth}</dd>
        </div>
        <div>
          <dt className="text-subtle">Primary source available</dt>
          <dd className="mt-1 text-fg">{origin ? `YES · ${origin.id}` : "NO"}</dd>
        </div>
        <div>
          <dt className="text-subtle">Line</dt>
          <dd className="mt-1 text-muted">{chain.map((e) => e.id).join(" → ")}</dd>
        </div>
      </dl>
    </aside>
  );
}
