// PagedGeometryStats — Geometry Stream Gate-0 stat summary.
//
// One pure derivation of a stream's chunk/vertex/geometry/draw counts, shared by the
// stream's snapshot() and the runtime __PERF__.paged field so the Performance Contract
// reads ONE definition (no duplicated counting). PURE: no THREE, no wall-clock.
//
// `draws` = one draw call per committed page mesh (each page is its own mesh). `geometries`
// likewise = committed pages (one BufferGeometry per page). These feed the contract as
// REPORTED stability metrics — the real safety gate is the per-page <= 64k cap, enforced
// in validation, not a fixed ceiling on the total.

function sum(list, field) {
  let total = 0;
  for (const item of list ?? []) total += Number.isFinite(item?.[field]) ? item[field] : 0;
  return total;
}

/**
 * @param {{ maxVerticesPerChunk?: number, committed?: Array<{vertexCount:number,indexCount:number}>, pending?: Array<{vertexCount:number,indexCount:number}> }} state
 */
export function summarizePages({ maxVerticesPerChunk = 0, committed = [], pending = [] } = {}) {
  const committedPages = committed.length;
  const pendingPages = pending.length;
  return {
    maxVerticesPerChunk,
    pages: committedPages + pendingPages,
    committedPages,
    pendingPages,
    committedVertices: sum(committed, "vertexCount"),
    pendingVertices: sum(pending, "vertexCount"),
    committedIndices: sum(committed, "indexCount"),
    geometries: committedPages, // one BufferGeometry per committed page
    draws: committedPages, // one draw call per committed page mesh
  };
}
