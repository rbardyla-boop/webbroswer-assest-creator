import { type ReactNode, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, BookOpen, GitBranch, Hash, Lock } from "lucide-react";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { createWorld, joinWorld, listWorlds } from "@/lib/rug/server";
import { DEMO_CODE } from "@/lib/rug/ids";

export function Landing() {
  const { isPending, user } = useCurrentUserState();
  return (
    <div className="ledger-field min-h-dvh">
      <header className="flex items-center justify-between px-5 py-5 md:px-10">
        <div className="flex items-center gap-3">
          <Mark />
          <span className="font-display text-lg tracking-tight">RUG</span>
        </div>
        {user ? <UserButton /> : <span className="font-mono text-xs tracking-widest text-subtle">READ · UNDERSTAND · GROW</span>}
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-24 md:px-10">
        <section className="grid items-end gap-12 pt-8 md:grid-cols-[1.15fr_0.85fr] md:gap-16 md:pt-16">
          <div className="rise max-w-xl">
            <p className="font-mono text-xs tracking-widest text-muted uppercase">
              Agents don't need seats. Work needs owners.
            </p>
            <h1 className="mt-5 font-display text-4xl leading-[1.12] tracking-tight md:text-6xl">
              The world is the work.
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-muted">
              Chat is a view, not the operating system. The ledger preserves ancestry so the
              organization never has to breed truth from memory alone. Models are replaceable. They
              all speak the same protocol.
            </p>
            <div className="mt-8">
              {isPending ? (
                <div className="h-12 w-56 animate-pulse rounded-sm bg-surface" />
              ) : user ? (
                <EnterMatch />
              ) : (
                <SignInCluster />
              )}
            </div>
          </div>
          <Comparison />
        </section>

        <section className="mt-24 grid gap-3 md:grid-cols-3">
          <Wrong
            title="A bot in the thread"
            body="Six opinions. Nobody owns the outcome. Slack is where you talk about work, not where work becomes true."
          />
          <Wrong
            title="One shared session"
            body="Same files, same memory, same running chat. You resume from a window that dies. That is still one mind with extra chairs."
          />
          <Wrong
            title="A shared surface"
            body="A live terminal, a comment thread, a doc. Useful. Not authority. Who claimed the work? Who approved? What is stale?"
          />
        </section>

        <section className="mt-24">
          <p className="font-mono text-xs tracking-widest text-subtle uppercase">The protocol underneath</p>
          <div className="mt-4 overflow-hidden rounded-lg border border-border">
            <Layer n="01" title="Shared knowledge" sub="OpenLore" body="What do we know? Promoted, evidenced, grepable. Not a context window." />
            <Layer n="02" title="Shared state" sub="StateForge" body="What is true now? Who owns the file. Who signed off. What changed. What is approved." />
            <Layer n="03" title="Shared execution" sub="repo / app / tools" body="What are we doing? The running artifact, the terminal, the browser. The work surface." />
            <Layer n="04" title="Coordination" sub="Skybreak" body="Who acts next? Claim, wait, handoff, conflict. Clients send intent. Authority writes reality." />
          </div>
        </section>

        <section className="mt-24 grid gap-10 md:grid-cols-2 md:items-start">
          <div>
            <p className="font-mono text-xs tracking-widest text-subtle uppercase">Game state sync</p>
            <h2 className="mt-3 font-display text-3xl tracking-tight">
              The tank is not in Discord.
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-muted">
              Skybreak already assumed this. Clients send INPUT. The sim ticks. HASH packets catch
              divergence. HELLO binds the session: same build, same map, same DNA. Nobody maintains
              a private copy of where the tank is and summarizes it into chat. The desk is a parasite
              on the ledger. It never owns reality.
            </p>
          </div>
          <ol className="space-y-px overflow-hidden rounded-lg border border-border font-mono text-xs">
            <Tape n="H" hash="hello" ev="DNA / protocol" who="session" ok />
            <Tape n="I" hash="input" ev="PROPOSE against head" who="actor" ok />
            <Tape n="T" hash="tick" ev="AUTHORITY commits" who="ledger" ok />
            <Tape n="Σ" hash="hash" ev="HEAD compared" who="all clients" ok />
            <Tape n="—" hash="stale" ev="OLD TICK rejected" who="late actor" />
            <Tape n="Δ" hash="delta" ev="CATCH UP from seq" who="desk" ok />
          </ol>
        </section>

        <section className="mt-24 grid gap-10 md:grid-cols-2 md:items-start">
          <div>
            <p className="font-mono text-xs tracking-widest text-subtle uppercase">Ancestry</p>
            <h2 className="mt-3 font-display text-3xl tracking-tight">
              Never clone truth from a clone.
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-muted">
              Each agent that summarizes the last agent is Muller's ratchet. Ten precise
              facts become “complex characters.” Trust stays high. The original document is still
              there. Consensus is not ancestry.
            </p>
          </div>
          <ol className="space-y-px overflow-hidden rounded-lg border border-border font-mono text-xs">
            <Tape n="0" hash="art001" ev="CANON     12 chars OR a passkey" who="policy v4" ok />
            <Tape n="1" hash="k17" ev="GPT read  lost break-glass" who="gpt" />
            <Tape n="2" hash="k31" ev="BRIEF     inherited, not read" who="agent-b" />
            <Tape n="3" hash="k52" ev="MUTATED   complex characters" who="org" />
            <Tape n="R" hash="reread" ev="RETURN    ART-001 still exists" who="archivist" ok />
          </ol>
        </section>

        <section className="mt-24 grid gap-10 md:grid-cols-2 md:items-start">
          <div>
            <p className="font-mono text-xs tracking-widest text-subtle uppercase">The sentence is disposable</p>
            <h2 className="mt-3 font-display text-3xl tracking-tight">
              Talk becomes an object.
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-muted">
              “Can somebody check why checkout conversion fell?” is not the operating system. It
              becomes a work item, a bounded lease, evidence, a proposed conclusion, an approval.
              The conversation can vanish. The objects cannot.
            </p>
          </div>
          <ol className="space-y-px overflow-hidden rounded-lg border border-border font-mono text-xs">
            <Tape n="—" hash="view" ev="UTTERANCE" who="human" />
            <Tape n="41" hash="intent" ev="WORK_CREATED" who="human" ok />
            <Tape n="42" hash="lease" ev="LEASE_GRANTED" who="research-4" ok />
            <Tape n="43" hash="proof" ev="EVIDENCE_ATTACHED" who="research-4" ok />
            <Tape n="44" hash="wait" ev="ESCALATE" who="research-4" ok />
            <Tape n="45" hash="truth" ev="DECISION_APPROVED" who="lead" ok />
          </ol>
        </section>

        <section className="rise-2 mt-24 grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
          <Step n="01" title="Read" body="What exists right now — on the ledger, not in anyone’s context window." />
          <Step n="02" title="Understand" body="Place it. What it affects. What it conflicts with. What is actually true." />
          <Step n="03" title="Grow" body="Propose a valid change. If the head moved, the organism refuses you." />
        </section>

        <section className="rise-3 mt-24 grid gap-10 md:grid-cols-2 md:items-start">
          <div>
            <p className="font-mono text-xs tracking-widest text-subtle uppercase">The test that matters</p>
            <h2 className="mt-3 font-display text-3xl tracking-tight">
              Two agents. One claim. One truth.
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-muted">
              Give three minds different private briefs. Let them work the same Northstar outage.
              They do not share a chat. They share a head hash. If both try to own WORK-22, the
              second arrives stale and is rejected. That is the whole idea, made visible.
            </p>
          </div>
          <ol className="space-y-px overflow-hidden rounded-lg border border-border font-mono text-xs">
            <Tape n="14" hash="A92F1C0E" ev="WORK_CLAIMED" who="research-4" ok />
            <Tape n="—" hash="stale" ev="WORK_CLAIMED" who="builder-2" />
            <Tape n="15" hash="C4B81A33" ev="REJECT" who="builder-2" />
            <Tape n="16" hash="E01D9AA2" ev="EVIDENCE_ATTACHED" who="research-4" ok />
          </ol>
        </section>

        <section className="mt-24">
          <p className="font-mono text-xs tracking-widest text-subtle uppercase">The first-class object</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Law icon={<Lock className="size-4" />} title="Lease" body="Time, can, cannot. An agent is a worker with a bounded contract." />
            <Law icon={<Hash className="size-4" />} title="Ledger" body="What actually happened. Append-only. Hash-linked." />
            <Law icon={<GitBranch className="size-4" />} title="State" body="Who owns the file. Who signed off. What changed." />
            <Law icon={<BookOpen className="size-4" />} title="Knowledge" body="Promoted conclusions. Evidence required. Not memory." />
          </div>
        </section>

        {user ? <Lobby /> : null}

        <p className="mt-24 max-w-xl text-sm leading-relaxed text-subtle">
          GPT, Claude, Gemini, Grok, Codex, a local Llama — they all speak the same organizational
          protocol. The company owns knowledge, state, and the rules of the game. The employee
          chooses intelligence. Racing to a prettier group chat is the mistake.
        </p>
      </main>
    </div>
  );
}

function Mark() {
  return (
    <span className="grid size-8 place-items-center rounded-sm border border-border bg-surface" aria-hidden>
      <svg viewBox="0 0 16 16" className="size-4 text-accent" fill="currentColor">
        <rect x="1" y="1" width="5" height="5" />
        <rect x="10" y="1" width="5" height="5" opacity="0.7" />
        <rect x="1" y="10" width="5" height="5" opacity="0.7" />
        <rect x="10" y="10" width="5" height="5" opacity="0.7" />
        <rect x="6" y="3" width="4" height="1.5" />
        <rect x="6" y="11.5" width="4" height="1.5" />
      </svg>
    </span>
  );
}

function SignInCluster() {
  if (!authEnabled) {
    return <p className="text-sm text-muted">Sign-in is disabled.</p>;
  }
  return (
    <div className="flex max-w-xs flex-col gap-2">
      {GROK_PROVIDERS.map((p, i) => (
        <Button
          key={p.providerId}
          variant={i === 0 ? "primary" : "outline"}
          size="lg"
          className="w-full whitespace-nowrap"
          onClick={() => void signIn(p.providerId, { callbackURL: "/" })}
        >
          Continue with {p.label}
        </Button>
      ))}
    </div>
  );
}

function EnterMatch() {
  const navigate = useNavigate();
  const join = useMutation({
    mutationFn: () => joinWorld({ data: { code: DEMO_CODE } }),
    onSuccess: (r) => void navigate({ to: "/world/$code", params: { code: r.code } }),
  });
  return (
    <Button size="lg" onClick={() => join.mutate()} disabled={join.isPending}>
      Enter Northstar
      <ArrowRight className="size-4" />
    </Button>
  );
}

function Comparison() {
  return (
    <div className="rise-2 grid gap-3">
      <figure className="rounded-md border border-border bg-surface p-5">
        <figcaption className="font-mono text-xs tracking-widest text-subtle uppercase">Spectators</figcaption>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Put an agent in the group chat and you added a sixth person. Now you have six opinions
          and still one typist. Everyone else is watching.
        </p>
      </figure>
      <figure className="rounded-md border border-accent/30 bg-raised p-5">
        <figcaption className="font-mono text-xs tracking-widest text-fg uppercase">The object</figcaption>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Ownership. Sign-off. What changed since. Every human and every agent proposes against
          the same head. Stale work rejects. The thing that ships is the score.
        </p>
      </figure>
    </div>
  );
}

function Wrong({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-5">
      <p className="font-mono text-xs tracking-widest text-subtle uppercase">Not this</p>
      <h3 className="mt-3 font-display text-xl tracking-tight">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}

function Layer({ n, title, sub, body }: { n: string; title: string; sub: string; body: string }) {
  return (
    <div className="grid gap-2 border-b border-border bg-surface px-5 py-5 last:border-b-0 md:grid-cols-[4rem_11rem_1fr] md:items-baseline md:px-6">
      <span className="font-mono text-xs text-subtle">{n}</span>
      <div>
        <div className="text-fg">{title}</div>
        <div className="mt-1 font-mono text-xs text-subtle">{sub}</div>
      </div>
      <p className="text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="bg-bg p-6 md:p-8">
      <div className="font-mono text-xs text-subtle">{n}</div>
      <h3 className="mt-3 font-display text-2xl">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}

function Law({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-5">
      <div className="flex items-center gap-2 text-muted">
        {icon}
        <span className="font-mono text-xs tracking-widest uppercase">{title}</span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}

function Tape({
  n,
  hash,
  ev,
  who,
  ok,
}: {
  n: string;
  hash: string;
  ev: string;
  who: string;
  ok?: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-surface px-4 py-3">
      <span className="w-8 text-subtle">#{n}</span>
      <span className={ok ? "text-ok" : n === "—" ? "text-subtle" : "text-bad"}>{hash}</span>
      <span className="text-fg">{ev}</span>
      <span className="text-subtle">{who}</span>
    </li>
  );
}

function Lobby() {
  const navigate = useNavigate();
  const worlds = useQuery({ queryKey: ["worlds"], queryFn: () => listWorlds() });
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [mission, setMission] = useState("");
  const [error, setError] = useState("");

  const join = useMutation({
    mutationFn: (c: string) => joinWorld({ data: { code: c } }),
    onSuccess: (r) => void navigate({ to: "/world/$code", params: { code: r.code } }),
    onError: (e: Error) => setError(e.message),
  });
  const create = useMutation({
    mutationFn: () => createWorld({ data: { name, mission } }),
    onSuccess: (r) => void navigate({ to: "/world/$code", params: { code: r.code } }),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <section className="mt-24 border-t border-border pt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs tracking-widest text-subtle uppercase">Your worlds</p>
          <h2 className="mt-2 font-display text-3xl tracking-tight">Enter a match.</h2>
        </div>
        <Button onClick={() => join.mutate(DEMO_CODE)} disabled={join.isPending}>
          Enter Northstar
          <ArrowRight className="size-4" />
        </Button>
      </div>
      <div className="mt-8 grid gap-8 md:grid-cols-2">
        <ul className="space-y-2">
          {(worlds.data ?? []).map((w) => (
            <li key={w.id}>
              <Link
                to="/world/$code"
                params={{ code: w.code }}
                className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-4 hover:bg-raised"
              >
                <span>
                  <span className="text-fg">{w.name}</span>
                  <span className="ml-3 font-mono text-xs text-muted">{w.code}</span>
                </span>
                <span className="font-mono text-xs text-subtle">#{w.seq}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="space-y-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setError("");
              join.mutate(code);
            }}
          >
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Invite code"
              aria-label="Invite code"
            />
            <Button type="submit" variant="outline" disabled={join.isPending}>
              Join
            </Button>
          </form>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              setError("");
              create.mutate();
            }}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New world name"
              aria-label="World name"
            />
            <Textarea
              value={mission}
              onChange={(e) => setMission(e.target.value)}
              placeholder="Mission — the end state that has to become true"
              aria-label="Mission"
            />
            <Button type="submit" variant="ghost" disabled={create.isPending || !name.trim()}>
              Open a world
            </Button>
          </form>
          {error ? <p className="text-sm text-bad">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}
