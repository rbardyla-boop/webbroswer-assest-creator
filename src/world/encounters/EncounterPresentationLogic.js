// Encounter-1 — the pure, Node-testable logic for the encounter PRESENTATION layer (no THREE, no
// platform RNG, no wall-clock). It turns the encounter's observable facts (player distance, the enemy's
// Enemy-0 state, completion) into a player-facing PHASE and the readability decisions that follow — what
// the telegraph does, what the banner says. The THREE-side EncounterPresentation owns the meshes/timing
// and calls into here so the readability rules stay testable without a scene.
//
// This is a presentation OBSERVER: it never mutates encounter or enemy state. It reads Combat-0 / Enemy-0
// / Encounter Editor-0 facts and decides how the beat READS.

// The player-facing arc of one authored combat beat.
export const ENCOUNTER_PHASE = Object.freeze({
  DORMANT: "dormant", // out of range — the beat is quiet
  ALERT: "alert", // the player is approaching; the sentinel telegraphs hostility
  ENGAGED: "engaged", // in the zone / combat has begun
  CLEARED: "cleared", // the sentinel is defeated and the beat is complete
});

// The approach band (metres) outside the encounter radius where the sentinel begins to telegraph. Wider
// than the radius so the threat reads BEFORE the player is on top of it.
export const ENCOUNTER_ALERT_RANGE = 22;
// How long the "route clear" banner lingers after a beat is cleared before yielding back to the relic
// objective banner (so completion reads, then normal guidance resumes).
export const CLEARED_BANNER_SECONDS = 5;

const COMBAT_STATES = new Set(["hit-react", "defeated"]);

/**
 * Derive the player-facing phase from the observable facts. Pure.
 * @param {{distance:number, radius:number, enemyState:string|null, completed:boolean}} facts
 */
export function deriveEncounterPhase({ distance, radius, enemyState, completed }) {
  if (completed === true) return ENCOUNTER_PHASE.CLEARED;
  const r = Number.isFinite(radius) && radius > 0 ? radius : 6;
  const d = Number.isFinite(distance) ? distance : Infinity;
  // Once combat has visibly begun (the enemy reacted or fell) the beat is engaged regardless of range.
  if (COMBAT_STATES.has(enemyState)) return ENCOUNTER_PHASE.ENGAGED;
  if (d <= r) return ENCOUNTER_PHASE.ENGAGED;
  if (d <= ENCOUNTER_ALERT_RANGE) return ENCOUNTER_PHASE.ALERT;
  return ENCOUNTER_PHASE.DORMANT;
}

/**
 * The telegraph (idle→alert material cue) is active ONLY while the player is approaching/engaged AND the
 * sentinel is still idle. The moment Enemy-0 takes over the material (hit-react flash / defeat recolor),
 * the telegraph backs off so it never fights EnemyFeedback. Pure.
 */
export function telegraphActive(phase, enemyState) {
  return (phase === ENCOUNTER_PHASE.ALERT || phase === ENCOUNTER_PHASE.ENGAGED) && enemyState === "idle";
}

/**
 * The additive emissive intensity for the idle telegraph pulse, given the sentinel's base intensity and a
 * presentation clock `t` (seconds — passed in, never read from a wall-clock here). Pulses so the idle
 * sentinel reads as charged/hostile. Engaged pulses a touch harder than the approach.
 */
export function telegraphEmissive(baseIntensity, t, phase) {
  const base = Number.isFinite(baseIntensity) ? baseIntensity : 0.25;
  const amp = phase === ENCOUNTER_PHASE.ENGAGED ? 0.55 : 0.35;
  const lift = phase === ENCOUNTER_PHASE.ENGAGED ? 0.7 : 0.45;
  return base + lift + amp * (0.5 + 0.5 * Math.sin(t * 4)); // always > base; oscillates within the band
}

// The neutral fallback location noun when a beat authors no label (Content-1). An unlabelled beat still
// reads ("guards the path"); a labelled beat names its own location ("the crossing" / "the pass").
const DEFAULT_BEAT_LABEL = "the path";

function beatLabel(label) {
  return typeof label === "string" && label.trim() ? label.trim() : DEFAULT_BEAT_LABEL;
}

function capitalize(text) {
  return text.length ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * The single-line banner for the beat, or null to yield to the relic-objective banner. `clearedRecently`
 * is the time-windowed flag the presentation computes (the clear message lingers, then releases). `label`
 * (Content-1) is the beat's authored location noun; the banner names it so two beats read correctly. With
 * label "the crossing" the strings are byte-identical to the pre-Content-1 banner. Pure.
 */
export function encounterBannerText(phase, { clearedRecently = false, label = null } = {}) {
  const loc = beatLabel(label);
  switch (phase) {
    case ENCOUNTER_PHASE.ALERT:
      return `⚔ A glacial sentinel guards ${loc} — ready your weapon`;
    case ENCOUNTER_PHASE.ENGAGED:
      return `⚔ Strike the sentinel to clear ${loc}`;
    case ENCOUNTER_PHASE.CLEARED:
      return clearedRecently ? `✓ ${capitalize(loc)} is clear — the route ahead is open` : null;
    default:
      return null; // dormant → no encounter banner; the objective banner shows through
  }
}

// Beacon (gate-light) colours per phase — hostile while the beat is live, bright green when cleared.
export const BEACON_COLORS = Object.freeze({
  [ENCOUNTER_PHASE.DORMANT]: 0x6b7a86, // dim neutral
  [ENCOUNTER_PHASE.ALERT]: 0xff8a3c, // hostile amber
  [ENCOUNTER_PHASE.ENGAGED]: 0xff5a3c, // hot hostile
  [ENCOUNTER_PHASE.CLEARED]: 0x7fdca0, // route-open green
});

export function beaconColor(phase) {
  return BEACON_COLORS[phase] ?? BEACON_COLORS[ENCOUNTER_PHASE.DORMANT];
}

// Base opacity for the beacon per phase (dormant is subtle; live + cleared read clearly).
export function beaconOpacity(phase) {
  switch (phase) {
    case ENCOUNTER_PHASE.DORMANT:
      return 0.18;
    case ENCOUNTER_PHASE.ALERT:
      return 0.5;
    case ENCOUNTER_PHASE.ENGAGED:
      return 0.7;
    case ENCOUNTER_PHASE.CLEARED:
      return 0.8;
    default:
      return 0.18;
  }
}
