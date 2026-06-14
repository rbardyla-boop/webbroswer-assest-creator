// Boot smoke: editor and runtime reach readiness with no console errors, the
// loader is gone, and a screenshot is captured. Uses the shared harness (direct
// vite spawn + SwiftShader WebGL + guaranteed teardown — no orphaned dev server).
// Skips cleanly when no Chromium is available.

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import { withBrowserProof, openPage, waitForReady, evalValue } from "./lib/browser.mjs";

const ROOT = process.cwd();
const PORT = 5199;
const CDP_PORT = 9333;
const BASE = `http://127.0.0.1:${PORT}`;
const SCREENSHOT_DIR = path.join(ROOT, "tmp", "browser-smoke");

const run = await withBrowserProof(
  { root: ROOT, port: PORT, cdpPort: CDP_PORT, profile: path.join(ROOT, "tmp", "smoke-profile") },
  async () => {
    await rm(SCREENSHOT_DIR, { recursive: true, force: true });
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    await smoke(`${BASE}/`, "editor", "editor.png");
    await smoke(`${BASE}/?runtime=1`, "runtime", "runtime.png");
  }
);

if (run.skipped) console.log("browser readiness smoke skipped (no browser)");
else console.log("browser readiness smoke passed");

async function smoke(url, mode, screenshot) {
  const page = await openPage(CDP_PORT, url);
  try {
    await waitForReady(page.cdp, mode);
    const loaderVisible = await evalValue(page.cdp, `
      (() => {
        const loader = document.querySelector("#loader");
        if (!loader) return false;
        const style = getComputedStyle(loader);
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.01;
      })()
    `);
    if (loaderVisible) throw new Error(`${mode} marked ready while the loader was still visible`);
    if (page.consoleErrors.length) throw new Error(`${mode} console errors:\n${page.consoleErrors.join("\n")}`);
    await page.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1365, height: 768, deviceScaleFactor: 1, mobile: false });
    const captured = await page.cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(path.join(SCREENSHOT_DIR, screenshot), Buffer.from(captured.data, "base64"));
  } finally {
    await page.close();
  }
}
