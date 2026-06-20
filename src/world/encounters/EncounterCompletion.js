// Encounter Editor-0 completion rule. PURE — reuses the Enemy-0 defeat predicate so completion is judged
// by the same authority that owns enemy state (no duplicated defeat logic). An encounter is "cleared"
// only when EVERY projected enemy is defeated AND at least one enemy was projected — an empty actor set
// is NOT complete (a beat with no living/dead enemy hasn't been resolved), which guards the vacuous case.

import { isDefeated } from "../enemies/EnemyValidation.js";

export function allDefeated(actorStates) {
  if (!Array.isArray(actorStates) || actorStates.length === 0) return false;
  return actorStates.every((s) => isDefeated(s));
}
