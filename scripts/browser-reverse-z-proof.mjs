// Stage 15 browser proof: the reverse-Z depth gate. Two parts, both must run
// clean in a real (SwiftShader) WebGL context:
//
//   A. Depth-precision scene — an offscreen renderer constructed with
//      reverseDepthBuffer:true renders a near (green) quad over a far (red) quad
//      at a large near/far ratio. We read back the centre and assert the FRONT
//      quad wins with NO z-fighting speckle. This is mode-agnostic: it passes
//      whether reverse-Z is active (real GPU with EXT_clip_control) or the gate
//      fell back to normal depth (e.g. SwiftShader). It also asserts the gate
//      invariant: capabilities.reverseDepthBuffer === EXT_clip_control present.
//
//   B. Runtime boot — the real app boots with reverse-Z requested; the debug
//      snapshot reports status; terrain/grass/bushes still render; no console
//      errors. The wider proof suite (particles/anim/interaction/undo/lighting)
//      is re-run by the stage sweep to confirm no regression under this renderer.
//
// Shared SwiftShader harness; skips cleanly when no Chromium is present.

import assert from "node:assert/strict";
import path from "node:path";
import { withBrowserProof, openPage, waitForReady, evalValue, sleep } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5209;
const CDP_PORT = 9343;
const BASE = `http://127.0.0.1:${PORT}`;

// Runs in the page: render a near-over-far depth scene through an offscreen
// renderer and read back the centre, for a given reverseDepthBuffer request.
// Run once with reverse-Z requested and once forced off, so BOTH the enabled
// and the disabled/unavailable depth paths are exercised deterministically.
const DEPTH_SCENE = `(async () => {
  // Bare 'three' won't resolve in a raw eval context (no Vite transform); the
  // self-contained build module is served directly by the dev server.
  const THREE = await import('/node_modules/three/build/three.module.js');

  const probe = (requestReverse) => {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, reverseDepthBuffer: requestReverse });
    renderer.setSize(64, 64, false);

    const scene = new THREE.Scene();
    // Large near/far ratio — the regime where depth precision actually matters.
    const cam = new THREE.PerspectiveCamera(60, 1, 0.5, 6000);
    cam.position.set(0, 0, 0);
    cam.lookAt(0, 0, -1);

    const quad = (z, hex) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(200000, 200000), new THREE.MeshBasicMaterial({ color: hex }));
      m.position.z = z;
      return m;
    };
    const back = quad(-1000, 0xff0000);  // red, far
    const front = quad(-500, 0x00ff00);  // green, near — must occlude red
    scene.add(back, front);
    renderer.render(scene, cam);

    const gl = renderer.getContext();
    const px = new Uint8Array(64 * 64 * 4);
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const glError = gl.getError();

    // Sample a 16x16 centre block: count green (front) vs red (back) pixels.
    let green = 0, red = 0;
    for (let y = 24; y < 40; y++) {
      for (let x = 24; x < 40; x++) {
        const i = (y * 64 + x) * 4;
        if (px[i + 1] > 150 && px[i] < 100) green++;
        else if (px[i] > 150 && px[i + 1] < 100) red++;
      }
    }

    const caps = renderer.capabilities.reverseDepthBuffer === true;
    const ext = !!gl.getExtension('EXT_clip_control');
    renderer.dispose();
    return { requested: requestReverse, caps, ext, green, red, glError };
  };

  return { on: probe(true), off: probe(false) };
})()`;

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "reversez-profile") },
  async () => {
    // Part A — depth-precision scene (run on the editor page; it has THREE).
    const editor = await openPage(CDP_PORT, `${BASE}/`);
    try {
      await waitForReady(editor.cdp, "editor");
      const { on, off } = await evalValue(editor.cdp, DEPTH_SCENE);

      // Enabled path: reverse-Z is active iff EXT_clip_control is present (the
      // capability gate), and the scene orders correctly with no z-fighting.
      assert.equal(on.glError, 0, `WebGL error (reverse-Z requested): ${on.glError}`);
      assert.equal(on.caps, on.ext, `reverse-Z gate mismatch: caps=${on.caps} ext=${on.ext}`);
      assert.ok(on.green >= 240, `front quad should fill the centre (reverse-Z), green=${on.green}/256`);
      assert.equal(on.red, 0, `back quad must not bleed through (reverse-Z z-fight), red=${on.red}`);

      // Disabled path (reverse-Z forced off = the unavailable case for the
      // pipeline): always normal depth, boots + orders correctly all the same.
      assert.equal(off.glError, 0, `WebGL error (reverse-Z off): ${off.glError}`);
      assert.equal(off.caps, false, "reverse-Z must be inactive when not requested");
      assert.ok(off.green >= 240, `front quad should fill the centre (normal-Z), green=${off.green}/256`);
      assert.equal(off.red, 0, `back quad must not bleed through (normal-Z z-fight), red=${off.red}`);

      console.log(`  depth scene: reverse-Z ${on.caps ? "ACTIVE" : "fell back"} (EXT_clip_control ${on.ext ? "present" : "absent"}); both paths order cleanly (on red=${on.red}, off red=${off.red})`);
    } finally {
      await editor.close();
    }

    // Part B — the real runtime boots with reverse-Z requested.
    const rt = await openPage(CDP_PORT, `${BASE}/?runtime=1`);
    try {
      await waitForReady(rt.cdp, "runtime");
      await sleep(400); // let several frames render

      const render = await evalValue(rt.cdp, `window.__RENDER_DEBUG__()`);
      assert.equal(render.requested, true, "runtime requests reverse-Z");
      assert.ok(render.mode === "reverse-z" || render.mode === "normal-z", `unexpected depth mode: ${render.mode}`);
      assert.equal(render.active, render.mode === "reverse-z", "active flag agrees with mode");
      // Active iff the extension resolved — consistent with Part A's gate.
      assert.equal(render.active, render.extensionAvailable, "runtime gate: active iff extension available");

      // The streamed systems still render under the reverse-Z renderer.
      const terrain = await evalValue(rt.cdp, `window.__TERRAIN_DEBUG__()`);
      assert.equal(terrain.hasUpgrade, true, "terrain renders");
      const grass = await evalValue(rt.cdp, `window.__GRASS_DEBUG__()`);
      assert.ok(grass.activePatches > 0, `grass renders, activePatches=${grass.activePatches}`);
      const bushDeadline = Date.now() + 15000;
      let bush = await evalValue(rt.cdp, `window.__BUSH_DEBUG__()`);
      while (bush.activePatches === 0 && Date.now() < bushDeadline) {
        await sleep(250);
        bush = await evalValue(rt.cdp, `window.__BUSH_DEBUG__()`);
      }
      assert.ok(bush.activePatches > 0, `bushes render, activePatches=${bush.activePatches}`);

      if (rt.consoleErrors.length) {
        throw new Error(`console errors during reverse-Z proof:\n${rt.consoleErrors.join("\n")}`);
      }
      console.log(`  runtime: depth mode=${render.mode}, terrain+grass+bushes render, no console errors`);
    } finally {
      await rt.close();
    }
  }
);

if (run.skipped) console.log("browser reverse-Z proof skipped (no browser)");
else console.log("browser reverse-Z proof passed");
