import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

// Entry points: the world builder (index.html), the playable-slice catalog
// (catalog.html → src/catalog/catalogMain.js — Slice Select-1's player front door),
// the self-contained Arsenal Lab tool (arsenal.html → src/arsenal/arsenalMain.js), and
// the isolated WebGPU Feasibility Lab (webgpu-lab.html → src/feasibility/webgpu/webgpuLabMain.js
// — a research gate, not a production renderer). The dev server serves all root HTML files
// automatically; this config makes `vite build` emit them all. Defaults are otherwise
// unchanged, so the existing app build is unaffected.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        catalog: fileURLToPath(new URL("./catalog.html", import.meta.url)),
        arsenal: fileURLToPath(new URL("./arsenal.html", import.meta.url)),
        webgpu: fileURLToPath(new URL("./webgpu-lab.html", import.meta.url)),
      },
    },
  },
});
