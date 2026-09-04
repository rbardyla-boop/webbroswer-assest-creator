# RUG

A multiplayer game where the world is the work.

Agents don’t need seats. Work needs owners.

The ledger preserves ancestry so the organization never has to breed truth from memory alone.

## Canon

Evidence is the genome. Knowledge is accepted claims. Interpretation is a phenotype.

Derived claims carry `parent_id`, `source_ids`, `evidence_hashes`, and `derivation_depth`. Past two generations without a reread of the ancestor is genetic drift. The organism refuses to promote the clone as policy.

Never clone organizational truth from a clone when the ancestor still exists.

Lockstep protects shared reality across machines. Canon protects shared meaning across generations. Repetitive Fading is a failure mode in the world, not a network bug: Agent A reads ART-001, Agent B inherits the brief, Agent C inherits B. By KNOW-52 the organization agrees on a mutation. Trust is 92. The source is still there.

## The protocol

```
SHARED KNOWLEDGE     what do we know?
SHARED STATE         who owns what, who signed off, what changed
SHARED EXECUTION     repo / app / tools
COORDINATION         who acts next
```

Clients send intent. Authority writes reality.

That is Skybreak lockstep, mapped onto an organization:

| Wire     | Game                         | Organization              |
|----------|------------------------------|---------------------------|
| HELLO    | build / map / config hash    | DNA + protocol            |
| INPUT    | quantized player intent      | propose / claim / lease   |
| TICK     | 60 Hz sim                    | ledger append             |
| HASH     | rolling state hash           | ledger head               |
| WINDOW   | old tick / out of range      | stale base rejects        |
| DIVERGED | hash mismatch → resync       | desk snapshot from chain  |

Models are replaceable. GPT, Claude, Gemini, Grok, Codex, a local Llama — they all speak the same organizational protocol. The company owns knowledge, state, and the rules. The employee chooses intelligence.

## Northstar

The demo match: ship a working login.

- Incomplete repo
- Contradictory password rules
- Three agents with **private** briefs
- Bounded leases (`can` / `cannot`, time-boxed)
- Collision: two agents claim `WORK-22` against the same head. One lands. One is stale.

Talk is disposable. “Can somebody check why checkout conversion fell?” becomes a work item, a lease, evidence, an approval. The sentence can die. The objects cannot.

## Run

```bash
npm install
npm run dev
```

Sign in, enter **Northstar** (`RUG001`). Collide a claim. Open **Sync** to watch lockstep: local tick vs authority tick, local hash vs head.

## Stack

TanStack Start, Postgres / PGLite, hash-linked ledger, P2P presence, Skybreak-style delta sync.
