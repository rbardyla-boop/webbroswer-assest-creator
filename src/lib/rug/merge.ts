import { applyEntries } from "./project";
import type { Snapshot, SyncFrame } from "./types";

export function mergeFrame(cur: Snapshot | undefined, frame: SyncFrame): Snapshot {
  if (frame.snapshot) return frame.snapshot;
  if (!cur) throw new Error("No local world to apply a delta onto.");
  if (frame.kind === "ack") {
    return {
      ...cur,
      members: frame.members.length ? frame.members : cur.members,
      agents: frame.agents.length ? frame.agents : cur.agents,
      me: frame.me ?? cur.me,
    };
  }
  const state = applyEntries(cur.state, frame.entries);
  return {
    ...cur,
    world: { ...cur.world, seq: frame.seq, headHash: frame.headHash },
    state: { ...state, seq: frame.seq, headHash: frame.headHash },
    ledger: [...cur.ledger, ...frame.entries],
    rejects: frame.rejects.length ? frame.rejects : cur.rejects,
    members: frame.members.length ? frame.members : cur.members,
    agents: frame.agents.length ? frame.agents : cur.agents,
    me: frame.me ?? cur.me,
  };
}
