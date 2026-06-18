// test:streamer — the shared RegionStreamer (Wildlife-2 extraction) reproduces the EXACT
// streaming behaviour the two wildlife systems had inline. Pure Node (the streamer is
// THREE-free). The decisive assertion is the ORACLE (section D): an independent, literal
// transcription of the pre-extraction `_streamRegions` loop must produce the identical
// region key SET + build ORDER as the streamer for every camera position — direct proof
// the refactor changed nothing. The four wildlife browser/Node tests are the end-to-end
// parity oracle; this locks the unit-level streaming math.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { RegionStreamer } from "../src/world/streaming/RegionStreamer.js";
import { HALF_DIAG_FACTOR, halfDiag, nearestCornerDistance } from "../src/world/streaming/RegionMetrics.js";
import { keyOf, cellOf } from "../src/world/streaming/RegionKey.js";

// Deterministic per-region item count (no Math.random — the source scan below forbids it).
function hash2(rx, rz) {
  let h = (rx * 374761393 + rz * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}
// Stub payload: `items` array sized 1..4 deterministically; `center` from the streamer.
function makeBuildRegion() {
  return (rx, rz, cx, cz) => ({ items: new Array(1 + (hash2(rx, rz) % 4)).fill(0), center: { x: cx, z: cz } });
}
const countItems = (region) => region.items.length;

// =============================================================================
// A. RegionMetrics — the 0.7072 literal + nearest-corner math
// =============================================================================
assert.equal(HALF_DIAG_FACTOR, 0.7072, "half-diagonal factor is the shipped literal");
assert.equal(halfDiag(64), 64 * 0.7072, "halfDiag uses the literal");
assert.notEqual(halfDiag(64), 64 * Math.SQRT1_2, "halfDiag is NOT Math.SQRT1_2 (would shift boundary regions)");
// nearest corner = centre distance minus the cell half-diagonal
assert.equal(nearestCornerDistance(30, 40, 0, 0, 5), Math.hypot(30, 40) - 5, "nearestCornerDistance = hypot - halfDiag");
assert.equal(
  nearestCornerDistance(10, 0, 0, 0, 3),
  nearestCornerDistance(-10, 0, 0, 0, 3),
  "nearestCornerDistance symmetric across the axis"
);
assert.deepEqual(cellOf(130, -10, 64), { cx: Math.floor(130 / 64), cz: Math.floor(-10 / 64) }, "cellOf floor-divides");
assert.equal(keyOf(2, -3), "2,-3", "keyOf matches the inline rx + ',' + rz");

// =============================================================================
// B. Determinism — same camera path → identical built key sequence, twice
// =============================================================================
const PARAMS = { regionSize: 64, visibleDistance: 140, keepDistance: 180, maxItems: 100000 };
const PATH = [[0, 0], [40, 0], [90, 30], [220, -110], [-60, 200], [0, 0]];

function runStreamer(params) {
  const s = new RegionStreamer({
    getRegionSize: () => params.regionSize,
    getVisibleDistance: () => params.visibleDistance,
    getKeepDistance: () => params.keepDistance,
    maxItems: params.maxItems,
    buildRegion: makeBuildRegion(),
    countItems,
  });
  const trace = [];
  for (const [cx, cz] of PATH) {
    s.update(cx, cz);
    trace.push([...s.regions.keys()]);
  }
  return { streamer: s, trace };
}

const runA = runStreamer(PARAMS);
const runB = runStreamer(PARAMS);
assert.deepEqual(runA.trace, runB.trace, "streamer is deterministic across runs");

// idempotency at a fixed position = no build/drop thrash (the hysteresis failure mode)
{
  const { streamer } = runStreamer(PARAMS);
  const before = [...streamer.regions.keys()];
  streamer.update(0, 0);
  const after = [...streamer.regions.keys()];
  assert.deepEqual(before, after, "re-running update at the same position changes nothing (no thrash)");
}

// =============================================================================
// C. Budget cap — overshoot-by-one-region semantics, both count units
// =============================================================================
function builtCountUnderCap(maxItems, perRegion) {
  // visibleDistance huge so the grid is the only limiter; every region has `perRegion` items.
  const s = new RegionStreamer({
    getRegionSize: () => 64,
    getVisibleDistance: () => 5000,
    getKeepDistance: () => 6000,
    maxItems,
    buildRegion: (rx, rz, cx, cz) => ({ items: new Array(perRegion).fill(0), center: { x: cx, z: cz } }),
    countItems,
  });
  s.update(0, 0);
  return { regions: s.regions.size, items: s.itemCount() };
}
// cap checked BEFORE build, incremented AFTER → builds while n*K < M; total may overshoot by < K.
{
  const { regions, items } = builtCountUnderCap(5, 3); // n*3 < 5 → n in {0,1} → 2 regions, 6 items
  assert.equal(regions, 2, "budget builds the exact scan-order prefix (2 regions)");
  assert.equal(items, 6, "budget overshoots by at most one region (6 > cap 5)");
}
{
  const { items } = builtCountUnderCap(10, 1); // 1 item each → exactly 10 regions, 10 items
  assert.equal(items, 10, "budget stops exactly at the cap when divisible");
}
// the SAME semantics with an aloft-style count unit (Σ over sub-groups)
{
  const groupsCount = (r) => { let n = 0; for (const g of r.groups) n += g.n; return n; };
  const s = new RegionStreamer({
    getRegionSize: () => 64,
    getVisibleDistance: () => 5000,
    getKeepDistance: () => 6000,
    maxItems: 7,
    buildRegion: (rx, rz, cx, cz) => ({ groups: [{ n: 2 }, { n: 2 }], center: { x: cx, z: cz } }), // 4 each
    countItems: groupsCount,
  });
  s.update(0, 0);
  assert.equal(s.itemCount(), 8, "aloft-style count unit respects the same cap semantics (4+4, stops >7)");
  assert.equal(s.regions.size, 2, "aloft-style: 2 regions before the cap trips");
}

// =============================================================================
// D. ORACLE — an inlined verbatim copy of the pre-extraction _streamRegions loop
//    must produce the identical region key set + order for every camera position.
// =============================================================================
// Literal transcription of the OLD WildlifeSystem._streamRegions (rx + ',' + rz,
// size * 0.7072, Math.hypot, the exact gate + budget). Independent of the streamer.
function referenceStream(regions, camX, camZ, p) {
  const size = p.regionSize;
  const hd = size * 0.7072;
  const visSq = p.visibleDistance * p.visibleDistance;
  for (const [key, region] of regions) {
    const near = Math.hypot(region.center.x - camX, region.center.z - camZ) - hd;
    if (near > p.keepDistance) regions.delete(key);
  }
  const cx = Math.floor(camX / size);
  const cz = Math.floor(camZ / size);
  const r = Math.ceil(p.visibleDistance / size) + 1;
  let activeCount = 0;
  for (const region of regions.values()) activeCount += p.countItems(region);
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const rx = cx + dx;
      const rz = cz + dz;
      const key = rx + "," + rz;
      if (regions.has(key)) continue;
      const centerX = (rx + 0.5) * size;
      const centerZ = (rz + 0.5) * size;
      const dist = Math.hypot(centerX - camX, centerZ - camZ) - hd;
      if (dist * dist > visSq && dist > 0) continue;
      if (activeCount >= p.maxItems) continue;
      const region = p.buildRegion(rx, rz, centerX, centerZ);
      regions.set(key, region);
      activeCount += p.countItems(region);
    }
  }
}

// Aloft-style payload: each region holds 1..2 flocks, each with a deterministic member
// count; the budget unit is Σ members (NOT flock count) — the aloft system's exact semantics.
function makeAloftBuildRegion() {
  return (rx, rz, cx, cz) => {
    const flockCount = 1 + (hash2(rx ^ 0x5f, rz ^ 0x5f) % 2);
    const flocks = [];
    for (let i = 0; i < flockCount; i++) flocks.push({ members: new Array(2 + (hash2(rx + i, rz - i) % 6)).fill(0) });
    return { flocks, center: { x: cx, z: cz } };
  };
}
const aloftCount = (region) => { let n = 0; for (const f of region.flocks) n += f.members.length; return n; };

// Run the oracle for BOTH the grounded payload/budget-unit and the aloft one, so each
// system's exact streaming (incl. its budget unit) is proven against the inlined reference.
const SCENARIOS = [
  { name: "grounded uncapped", params: PARAMS, makeBuild: makeBuildRegion, count: countItems },
  { name: "grounded capped", params: { regionSize: 64, visibleDistance: 140, keepDistance: 180, maxItems: 12 }, makeBuild: makeBuildRegion, count: countItems },
  { name: "aloft capped", params: { regionSize: 64, visibleDistance: 140, keepDistance: 180, maxItems: 40 }, makeBuild: makeAloftBuildRegion, count: aloftCount },
];

for (const sc of SCENARIOS) {
  const streamer = new RegionStreamer({
    getRegionSize: () => sc.params.regionSize,
    getVisibleDistance: () => sc.params.visibleDistance,
    getKeepDistance: () => sc.params.keepDistance,
    maxItems: sc.params.maxItems,
    buildRegion: sc.makeBuild(),
    countItems: sc.count,
  });
  const refRegions = new Map();
  const refBuild = sc.makeBuild();
  for (const [cx, cz] of PATH) {
    streamer.update(cx, cz);
    referenceStream(refRegions, cx, cz, { ...sc.params, buildRegion: refBuild, countItems: sc.count });
    assert.deepEqual(
      [...streamer.regions.keys()],
      [...refRegions.keys()],
      `${sc.name}: streamer matches the inlined reference @ ${cx},${cz}`
    );
    assert.equal(
      streamer.itemCount(),
      [...refRegions.values()].reduce((a, r) => a + sc.count(r), 0),
      `${sc.name}: itemCount matches reference @ ${cx},${cz}`
    );
  }
}

// clear() empties the map
{
  const { streamer } = runStreamer(PARAMS);
  assert.ok(streamer.regions.size > 0, "streamer populated before clear");
  streamer.clear();
  assert.equal(streamer.regions.size, 0, "clear() empties the region map");
}

// =============================================================================
// E. Source scan — the new streaming modules use no nondeterministic time/random
// =============================================================================
const streamingDir = path.join(process.cwd(), "src", "world", "streaming");
for (const file of readdirSync(streamingDir)) {
  if (!file.endsWith(".js")) continue;
  const src = readFileSync(path.join(streamingDir, file), "utf8");
  assert.ok(!/Math\.random\s*\(|Date\.now\s*\(|performance\.now\s*\(/.test(src), `${file} calls no nondeterministic time/random`);
}

console.log("region streamer regression passed (0.7072 literal guard; deterministic; no thrash; budget overshoot-by-one; inlined-reference oracle matches over a camera path; THREE-free)");
