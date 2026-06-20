// PagedGeometryStream — Geometry Stream Gate-0 core.
//
// A deterministic chunked geometry streaming layer. A procedural producer hands the stream
// a batch of page descriptors (each <= maxVerticesPerChunk vertices); the stream validates
// the batch transactionally, then COMMITS pages incrementally — one (or a budget's worth)
// per commitNext() — so a large procedural surface uploads as bounded chunks instead of one
// stalling buffer. Every committed page is its own mesh sharing the caller's single material.
//
// Ownership: the stream owns its scene Group + the per-page geometries + meshes (it disposes
// them on clear()/dispose()). The MATERIAL is caller-owned and never disposed here. Generated
// pages are RUNTIME PROJECTIONS — the stream never touches the world document, so paging adds
// nothing to the saved world file.
//
// This is upload/CPU-stall infrastructure. It does NOT replace LOD: per-page culling +
// incremental commit reduce buffer-size pressure and frame hitches, but triangle/vertex/
// shadow/overdraw cost is still governed by the Performance Contract and (later) LOD work.

import * as THREE from "three";

import { MAX_VERTICES_PER_CHUNK, DEFAULT_COMMIT_MAX_PAGES } from "./PagedGeometryTypes.js";
import { validatePages, validateBuiltGeometry } from "./PagedGeometryValidation.js";
import { summarizePages } from "./PagedGeometryStats.js";

/**
 * @param {{ maxVerticesPerChunk?:number, material:THREE.Material, sceneRoot:THREE.Object3D }} opts
 */
export function createPagedGeometryStream({ maxVerticesPerChunk = MAX_VERTICES_PER_CHUNK, material, sceneRoot } = {}) {
  if (!sceneRoot || typeof sceneRoot.add !== "function" || typeof sceneRoot.remove !== "function") {
    throw new Error("createPagedGeometryStream: sceneRoot must be a THREE.Object3D");
  }
  if (!material || material.isMaterial !== true) {
    throw new Error("createPagedGeometryStream: a THREE.Material is required");
  }
  const cap = Math.max(1, Math.floor(maxVerticesPerChunk));

  const group = new THREE.Group();
  group.name = "PagedGeometryStream";
  sceneRoot.add(group);

  /** @type {Array<{id:string,bounds:object,vertexCount:number,indexCount:number,build:Function}>} */
  let pending = [];
  /** @type {Array<{descriptor:object,mesh:THREE.Mesh}>} */
  let committed = [];

  function disposeCommitted() {
    for (const entry of committed) {
      group.remove(entry.mesh);
      entry.mesh.geometry?.dispose();
    }
    committed = [];
  }

  function commitOne() {
    const descriptor = pending[0];
    const geometry = descriptor.build();
    const check = validateBuiltGeometry(geometry, descriptor, { maxVerticesPerChunk: cap });
    if (!check.ok) {
      geometry?.dispose?.();
      pending.shift(); // drop the poison page so it cannot block subsequent commits
      throw new Error(check.reason);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "PagedGeometryPage";
    mesh.frustumCulled = true; // per-page distance/frustum culling is the stream's cheap win
    mesh.userData.isPagedGeometry = true;
    mesh.userData.pageId = descriptor.id;
    group.add(mesh);
    committed.push({ descriptor, mesh });
    pending.shift();
  }

  return {
    group,

    /**
     * Replace the whole page set. Validates the batch BEFORE mutating anything (a bad batch
     * leaves the stream unchanged), then disposes the prior committed pages and queues the
     * new set for incremental commit.
     */
    replacePages(descriptors) {
      const result = validatePages(descriptors, { maxVerticesPerChunk: cap });
      if (!result.ok) throw new Error(result.reason);
      disposeCommitted();
      pending = [...result.descriptors];
      return { pending: pending.length };
    },

    /**
     * Commit pending pages incrementally. By default commits up to `maxPages`
     * (DEFAULT_COMMIT_MAX_PAGES) pages. If `budgetMs` is given WITH an injected `now()`
     * clock, commits until the time budget is spent instead (the module itself never reads
     * a wall clock, keeping the emission path deterministic + scan-clean).
     */
    commitNext({ maxPages = DEFAULT_COMMIT_MAX_PAGES, budgetMs, now } = {}) {
      const before = committed.length;
      const useBudget = Number.isFinite(budgetMs) && typeof now === "function";
      if (useBudget) {
        const start = now();
        let guard = pending.length;
        while (pending.length && now() - start < budgetMs && guard-- > 0) commitOne();
      } else {
        const n = Math.min(pending.length, Math.max(0, Math.floor(maxPages)));
        for (let i = 0; i < n; i++) commitOne();
      }
      return { committed: committed.length - before, pending: pending.length };
    },

    /** Dispose every committed page + clear the queue; keep the (reusable) group attached. */
    clear() {
      disposeCommitted();
      pending = [];
    },

    /** clear() + detach the group from the scene root. The caller-owned material is NOT disposed. */
    dispose() {
      disposeCommitted();
      pending = [];
      sceneRoot.remove(group);
    },

    /** Deterministic stat summary (shared with __PERF__.paged via summarizePages). */
    snapshot() {
      const summary = summarizePages({
        maxVerticesPerChunk: cap,
        committed: committed.map((c) => ({ vertexCount: c.descriptor.vertexCount, indexCount: c.descriptor.indexCount })),
        pending: pending.map((d) => ({ vertexCount: d.vertexCount, indexCount: d.indexCount })),
      });
      return { ...summary, committedIds: committed.map((c) => c.descriptor.id) };
    },
  };
}
