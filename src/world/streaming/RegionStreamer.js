// RegionStreamer — the shared region streaming + budget mechanics for the Family-A
// wildlife systems (grounded WildlifeSystem + AloftWildlife). Pure + Node-safe (NO
// THREE): it owns the region Map and the keep/drop/build pass; the systems keep their
// own per-item simulate/render bodies (which differ) iterating `streamer.regions`.
//
// Extracted in Wildlife-2 from two near-identical inline `_streamRegions` loops. The
// `update()` body is a BYTE-FAITHFUL reproduction of that loop — same drop-before-scan
// order, same dz-outer/dx-inner grid order, same nearest-corner build/keep gate, same
// `activeCount` seed/increment and overshoot-by-one-region budget semantics — so the
// region SET and build ORDER (and therefore every downstream proof count) are unchanged.
// Only Family A adopts this; Bush/Grass/Tree are a different (lazy, per-patch) archetype.

import { keyOf, cellOf } from "./RegionKey.js";
import { halfDiag, nearestCornerDistance } from "./RegionMetrics.js";

export class RegionStreamer {
  // opts (all three cfg reads are getters → read per frame, matching the pre-extraction loop):
  //   getRegionSize       () => number — cell edge length (world units)
  //   getVisibleDistance  () => number — build radius
  //   getKeepDistance     () => number — drop radius (hysteresis)
  //   maxItems            hard ceiling on the total item budget across active regions
  //   buildRegion(rx, rz, centerX, centerZ) -> region object { <items>: [...], center: {x,z} }
  //   countItems(region)  -> number — the region's budget cost (animals: length; flocks: Σ members)
  constructor({ getRegionSize, getVisibleDistance, getKeepDistance, maxItems, buildRegion, countItems }) {
    this.getRegionSize = getRegionSize;
    this.getVisibleDistance = getVisibleDistance;
    this.getKeepDistance = getKeepDistance;
    this.maxItems = maxItems;
    this.buildRegion = buildRegion;
    this.countItems = countItems;
    this.regions = new Map(); // "rx,rz" -> region object (the SAME instance the system reads)
  }

  // Drop regions leaving keepDistance, then build regions entering visibleDistance, up to
  // the item budget. Synchronous (regions are sparse + cheap). Byte-faithful to the loops
  // this replaced — do not reorder the passes or the nested scan.
  update(camX, camZ) {
    const size = this.getRegionSize();
    const hd = halfDiag(size);
    const keep = this.getKeepDistance();
    const visibleDistance = this.getVisibleDistance();
    const visSq = visibleDistance * visibleDistance;

    // Drop pass FIRST: a region dropped this frame can be rebuilt this same frame if it
    // re-enters visibleDistance below. Nearest-corner metric — the SAME one the build
    // gate uses, so [visibleDistance, keepDistance] is a clean hysteresis gap.
    for (const [key, region] of this.regions) {
      if (nearestCornerDistance(region.center.x, region.center.z, camX, camZ, hd) > keep) {
        this.regions.delete(key);
      }
    }

    const { cx, cz } = cellOf(camX, camZ, size);
    const r = Math.ceil(visibleDistance / size) + 1;
    let activeCount = this.itemCount();

    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const rx = cx + dx;
        const rz = cz + dz;
        const key = keyOf(rx, rz);
        if (this.regions.has(key)) continue;

        const centerX = (rx + 0.5) * size;
        const centerZ = (rz + 0.5) * size;
        const dist = nearestCornerDistance(centerX, centerZ, camX, camZ, hd);
        if (dist * dist > visSq && dist > 0) continue;
        if (activeCount >= this.maxItems) continue; // hard cap (checked BEFORE build)

        const region = this.buildRegion(rx, rz, centerX, centerZ);
        this.regions.set(key, region);
        activeCount += this.countItems(region);
      }
    }
  }

  // Total budget cost across active regions (== the systems' old _countAnimals/_countBirds).
  itemCount() {
    let n = 0;
    for (const region of this.regions.values()) n += this.countItems(region);
    return n;
  }

  clear() {
    this.regions.clear();
  }
}
