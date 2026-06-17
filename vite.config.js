import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

// Two entry points: the world builder (index.html) and the self-contained Arsenal Lab
// tool (arsenal.html → src/arsenal/arsenalMain.js). The dev server serves both root
// HTML files automatically; this config makes `vite build` emit both. Defaults are
// otherwise unchanged, so the existing app build is unaffected.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        arsenal: fileURLToPath(new URL("./arsenal.html", import.meta.url)),
      },
    },
  },
});
