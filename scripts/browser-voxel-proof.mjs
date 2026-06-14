// Stage 16 browser proof: the Voxel Debug Lab inside the editor. Loads the sample
// world, selects an object, voxelizes it, and proves: occupancy builds with a
// BOUNDED draw call (one instanced cube mesh, never a mesh per voxel), the result
// is deterministic, a ray traverses the grid to a stable first hit, clearing tears
// the debug mesh down — all with zero console errors. Finally it confirms the lab
// is UNAVAILABLE in the production runtime (the editor chunk is never loaded there).
//
// Shared SwiftShader harness; skips cleanly when no Chromium is present.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5210;
const CDP_PORT = 9344;
const BASE = `http://127.0.0.1:${PORT}`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "voxel-profile") },
  async () => {
    // --- Editor: voxelize a selected mesh -----------------------------------
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor");

      const setup = await evalValue(editor.cdp, `(async () => {
        const editor = window.__WORLD_EDITOR__;
        if (!editor) throw new Error("editor debug hook missing");
        if (!editor.voxelLab) throw new Error("voxel lab missing");
        editor.open();
        await editor._loadSample();
        const obj = [...editor.manager.objects.values()][0];
        editor._select(obj);
        return { objects: editor.manager.objects.size, hasSelection: !!editor.selection.primary };
      })()`);
      assert.ok(setup.objects >= 1, "sample world populated");
      assert.equal(setup.hasSelection, true, "an object is selected");

      // Voxelize twice → deterministic; one instanced draw call; bounded instances.
      const vox = await evalValue(editor.cdp, `(() => {
        const lab = window.__WORLD_EDITOR__.voxelLab;
        const a = lab.voxelize();
        const aOcc = a.occupied, aDims = a.dims;
        const b = lab.voxelize();
        return {
          occupied: a.occupied,
          deterministic: aOcc === b.occupied && JSON.stringify(aDims) === JSON.stringify(b.dims),
          dims: a.dims,
          resolution: a.resolution,
          drawCalls: lab.getDebugDrawCalls(),
          debugInstances: b.debugInstances,
          truncated: a.truncated,
          sceneVoxelMeshes: window.__WORLD_EDITOR__.scene.children.filter(c => c.name === "VoxelDebug").length,
        };
      })()`);
      assert.ok(vox.occupied > 0, `voxelization produced occupied cells, got ${vox.occupied}`);
      assert.equal(vox.deterministic, true, "voxelization is deterministic across runs");
      assert.ok(vox.resolution <= 64, `resolution capped, got ${vox.resolution}`);
      assert.equal(vox.drawCalls, 1, `occupancy is ONE instanced draw call, got ${vox.drawCalls}`);
      assert.ok(vox.debugInstances <= vox.occupied, "debug instances do not exceed occupied cells");
      assert.equal(vox.sceneVoxelMeshes, 1, "exactly one voxel debug mesh in the scene (no re-add leak)");

      // Ray traversal: a stable first hit, plus a guarded miss.
      const ray = await evalValue(editor.cdp, `(() => {
        const lab = window.__WORLD_EDITOR__.voxelLab;
        const s = lab.getOccupiedSample();
        const hit = lab.raycast({ x: s.center.x - 1000, y: s.center.y, z: s.center.z }, { x: 1, y: 0, z: 0 });
        const hit2 = lab.raycast({ x: s.center.x - 1000, y: s.center.y, z: s.center.z }, { x: 1, y: 0, z: 0 });
        const miss = lab.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
        return {
          hit: hit.hit, face: hit.face, voxel: hit.voxel, normal: hit.normal,
          stable: JSON.stringify(hit) === JSON.stringify(hit2),
          missHit: miss.hit, missReason: miss.reason,
        };
      })()`);
      assert.equal(ray.hit, true, "ray finds a first hit through the occupied grid");
      assert.ok(ray.voxel && typeof ray.face === "string", "hit reports voxel coord + face");
      assert.equal(ray.stable, true, "identical ray yields identical hit (stable first-hit)");
      assert.equal(ray.missHit, false, "zero-direction ray misses cleanly");
      assert.equal(ray.missReason, "zero-direction", "zero-direction handled, not NaN-traversed");

      // Clear tears the debug mesh down.
      const cleared = await evalValue(editor.cdp, `(() => {
        const lab = window.__WORLD_EDITOR__.voxelLab;
        lab.clear();
        return {
          drawCalls: lab.getDebugDrawCalls(),
          sceneVoxelMeshes: window.__WORLD_EDITOR__.scene.children.filter(c => c.name === "VoxelDebug").length,
        };
      })()`);
      assert.equal(cleared.drawCalls, 0, "clear removes the draw call");
      assert.equal(cleared.sceneVoxelMeshes, 0, "clear removes the debug mesh from the scene");

      if (editor.consoleErrors.length) {
        throw new Error(`console errors during voxel proof:\n${editor.consoleErrors.join("\n")}`);
      }
      console.log(`  editor: ${vox.occupied} voxels in ${vox.dims.x}×${vox.dims.y}×${vox.dims.z}, 1 draw call, ray hit face ${ray.face}`);
    } finally {
      await editor.close();
    }

    // --- Runtime: the lab is unavailable (editor chunk never loaded) ---------
    const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt.cdp, "runtime");
      const inert = await evalValue(rt.cdp, `({
        editor: typeof window.__WORLD_EDITOR__,
      })`);
      assert.equal(inert.editor, "undefined", "voxel lab (and editor) absent in production runtime");
      if (rt.consoleErrors.length) {
        throw new Error(`console errors in runtime:\n${rt.consoleErrors.join("\n")}`);
      }
      console.log("  runtime: voxel lab unavailable (editor not loaded), no console errors");
    } finally {
      await rt.close();
    }
  }
);

if (run.skipped) console.log("browser voxel proof skipped (no browser)");
else console.log("browser voxel proof passed");
