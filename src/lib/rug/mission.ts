import { ancestryOf, needsReread } from "./ancestry.ts";
import type { WorldState } from "./types.ts";

export type Gate = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

export function missionGates(state: WorldState): Gate[] {
  const art = state.entities.find((e) => e.id === "ART-1");
  const artifactWorks = Boolean(art && (art.status === "working" || art.status === "complete"));
  const approved = state.entities.some((e) => e.kind === "decision" && e.status === "approved");
  const knowledge = state.entities.filter((e) => e.kind === "knowledge");
  const critical = knowledge.filter((e) => ancestryOf(e).critical || needsReread(e));
  const deep = critical.filter(needsReread);
  const contested = knowledge.filter((e) => e.status === "contested");
  const sourceBacked = critical.length === 0 || critical.every((e) => !needsReread(e) && e.status !== "contested");

  return [
    {
      id: "artifact",
      label: "Artifact works",
      ok: artifactWorks,
      detail: artifactWorks ? "ART-1 is live." : "ART-1 is still incomplete.",
    },
    {
      id: "approval",
      label: "Approval valid",
      ok: approved,
      detail: approved ? "A human signed the end." : "No approved decision on the chain.",
    },
    {
      id: "source",
      label: "Critical claims source-backed",
      ok: sourceBacked,
      detail: sourceBacked ? "Critical knowledge traces to an ancestor." : "A critical claim is a clone of a clone.",
    },
    {
      id: "depth",
      label: "No critical knowledge > depth 2",
      ok: deep.length === 0,
      detail: deep.length ? deep.map((e) => `${e.id} d${ancestryOf(e).depth}`).join(" · ") : "Depth holds.",
    },
    {
      id: "contested",
      label: "Contested claims resolved",
      ok: contested.length === 0,
      detail: contested.length ? contested.map((e) => e.id).join(" · ") : "No open contests.",
    },
  ];
}

export function missionWon(state: WorldState): boolean {
  return missionGates(state).every((g) => g.ok);
}

/** Knowledge bar is ancestry quality. Trust can be high while this is dying. */
export function knowledgeScore(state: WorldState): number {
  const knowledge = state.entities.filter((e) => e.kind === "knowledge");
  const deep = knowledge.filter(needsReread).length;
  const contested = knowledge.filter((e) => e.status === "contested").length;
  const faded = knowledge.filter((e) => ancestryOf(e).lost.length > 0 || ancestryOf(e).mutated.length > 0).length;
  return Math.max(0, Math.min(100, 88 - deep * 40 - contested * 12 - faded * 6));
}
