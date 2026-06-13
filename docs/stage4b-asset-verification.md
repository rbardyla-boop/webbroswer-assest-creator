# Stage 4B Asset Verification

Automated checks:

- `npm run test:world` covers asset metadata normalization, duplicate asset IDs, rename persistence, library refresh, relief blob resolution, shared `assetRef` placement, missing asset placeholders, legacy world compatibility, and world document export/import safety.
- `npm run test:browser` drives a Chromium-compatible browser through CDP when `CHROME_BIN` or a system Chromium/Chrome binary is available. It waits for `window.__WORLD_READY__`, checks `document.body.dataset.worldReady`, verifies `window.__WORLD_MODE__`, fails if the loading veil remains visible, checks browser console errors, and captures screenshots after readiness.

Manual browser workflow:

1. Run `npm run dev -- --host 127.0.0.1`.
2. Open the editor URL and wait for `window.__WORLD_READY__ === true`.
3. Import an image, place it, save the world, reload the page, load the world, and confirm the image card restores.
4. Create a relief asset, place it twice, save the world, reload the page, load the world, and confirm both objects share the same `assetRef`.
5. Open `?runtime=1` and confirm the image/relief objects render without editor UI.
6. Delete a used asset and confirm the editor warns before deletion.
7. Export `.world.json` and confirm the asset manifest is present. Large binary blobs remain in IndexedDB and are not embedded by default.

GLB/GLTF manual fixture workflow:

1. Import a small `.glb` or `.gltf` file through World Builder.
2. Place it, save the world, reload, and load the world.
3. Open `?runtime=1` and confirm the placed object resolves from IndexedDB.
4. Clear the asset blob from IndexedDB and confirm the runtime shows a placeholder instead of crashing.

Runtime boundary:

- Runtime mode imports `AssetLibrary` and `AssetStore`, which are shared runtime-safe services.
- Runtime mode does not import `WorldEditor`, `AssetImporter`, `AssetPreview`, or `AssetThumbnails`.
- Editor-only import and thumbnail work remains behind the dynamic `WorldEditor` import.
