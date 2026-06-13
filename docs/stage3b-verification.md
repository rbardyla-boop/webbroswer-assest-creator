# Stage 3B Verification

Use this procedure when checking the editor/runtime split in a real browser.

1. Run `npm run build`.
2. Run `npm run test:world`.
3. Start Vite with `npm run dev -- --host 127.0.0.1`.
4. Open `http://127.0.0.1:5173/` or the port Vite reports.
5. In DevTools, wait for `window.__WORLD_READY__ === true`.
6. Confirm `window.__WORLD_MODE__ === "editor"` and `document.body.dataset.worldReady === "true"`.
7. Confirm `document.querySelector("#loader") === null`.
8. Open World Builder, place a primitive and a relief, set collider types, save, export `.world.json`, then import it again.
9. Open `http://127.0.0.1:5173/?runtime=1`.
10. Wait for `window.__WORLD_READY__ === true`.
11. Confirm `window.__WORLD_MODE__ === "runtime"`.
12. Confirm `document.querySelector("#toolbar")?.offsetParent === null`.
13. Confirm there are no red console errors.
14. Capture screenshots only after readiness is true.

Runtime mode intentionally imports `WorldEditor` dynamically only in non-runtime mode, so editor-only UI and transform controls are not loaded for `?runtime=1`.
