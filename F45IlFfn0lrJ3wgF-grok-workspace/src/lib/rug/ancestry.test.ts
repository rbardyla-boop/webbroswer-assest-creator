import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ancestryOf, diffClaims, forest, lineage, needsReread } from "./ancestry.ts";
import { knowledgeScore, missionGates } from "./mission.ts";
import { EMPTY_CONSTITUTION, EMPTY_HEALTH, type Entity, type WorldState } from "./types.ts";

function e(id: string, parentId: string, depth: number, claims: string[], extra: Partial<Entity["fields"]> = {}): Entity {
  const kind = id.startsWith("ART") ? "artifact" : "knowledge";
  return {
    id,
    kind,
    title: id,
    body: "",
    status: depth > 2 ? "drift" : "promoted",
    owner: "",
    fields: { parentId, depth, claims, ...extra },
    updatedSeq: depth,
  };
}

function world(entities: Entity[], health = EMPTY_HEALTH): WorldState {
  return {
    seq: entities.length,
    headHash: "x",
    constitution: EMPTY_CONSTITUTION,
    entities,
    health,
  };
}

describe("ancestry", () => {
  it("measures loss and mutation", () => {
    const d = diffClaims(["passwords_12_or_passkey", "passkeys_preferred"], ["complex_chars"]);
    assert.deepEqual(d.lost, ["passwords_12_or_passkey", "passkeys_preferred"]);
    assert.deepEqual(d.mutated, ["complex_chars"]);
  });

  it("walks lineage back to the ancestor", () => {
    const src = e("ART-001", "", 0, ["passwords_12_or_passkey"]);
    const g1 = e("KNOW-17", "ART-001", 1, ["passwords_12_or_passkey"]);
    const g2 = e("KNOW-31", "KNOW-17", 2, ["passwords_12_or_passkey"]);
    const g3 = e("KNOW-52", "KNOW-31", 3, ["complex_chars"]);
    const chain = lineage([src, g1, g2, g3], "KNOW-52");
    assert.deepEqual(
      chain.map((x) => x.id),
      ["ART-001", "KNOW-17", "KNOW-31", "KNOW-52"],
    );
  });

  it("flags the ratchet after two un-reread generations", () => {
    const clone = e("KNOW-52", "KNOW-31", 3, ["complex_chars"]);
    assert.equal(needsReread(clone), true);
    assert.equal(needsReread(e("KNOW-60", "ART-001", 1, [], { reread: true })), false);
    assert.equal(ancestryOf(clone).depth, 3);
  });

  it("branches a forest instead of a single line", () => {
    const src = e("ART-001", "", 0, ["passwords_12_or_passkey"]);
    const gpt = e("KNOW-17", "ART-001", 1, ["passwords_12_or_passkey"]);
    const grok = e("KNOW-18", "ART-001", 1, ["passwords_12_or_passkey"]);
    const [root] = forest([src, gpt, grok], "ART-001");
    assert.equal(root?.entity.id, "ART-001");
    assert.deepEqual(root?.children.map((c) => c.entity.id).sort(), ["KNOW-17", "KNOW-18"]);
  });
});

describe("mission", () => {
  it("knowledge dies while consensus still looks healthy", () => {
    const know52 = e("KNOW-52", "KNOW-31", 3, ["complex_chars"], { critical: true, lost: ["passwords_12_or_passkey"], mutated: ["complex_chars"] });
    const state = world(
      [
        e("ART-001", "", 0, ["passwords_12_or_passkey"], { canon: true }),
        e("KNOW-17", "ART-001", 1, ["passwords_12_or_passkey"]),
        e("KNOW-31", "KNOW-17", 2, ["passwords_12_or_passkey"]),
        know52,
        { ...e("ART-1", "", 0, []), kind: "artifact", status: "incomplete", id: "ART-1" },
      ],
      { ...EMPTY_HEALTH, trust: 92, coherence: 95 },
    );
    assert.equal(state.health.trust, 92);
    assert.ok(knowledgeScore(state) < 50);
    assert.equal(missionGates(state).find((g) => g.id === "depth")?.ok, false);
    assert.equal(missionGates(state).find((g) => g.id === "artifact")?.ok, false);
  });
});
