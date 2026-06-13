import { accessSync, constants } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const PORT = 5199;
const CDP_PORT = 9333;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SCREENSHOT_DIR = path.join(ROOT, "tmp", "browser-smoke");

const chrome = findChrome();
if (!chrome) {
  console.warn("Browser smoke skipped: no Chromium/Chrome binary found. Set CHROME_BIN to enable this test.");
  process.exit(0);
}

await rm(SCREENSHOT_DIR, { recursive: true, force: true });
await mkdir(SCREENSHOT_DIR, { recursive: true });
await mkdtemp(path.join(tmpdir(), "grass-world-chrome-")).then(async (profile) => {
  const vite = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(PORT)], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const browser = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  try {
    await waitForHttp(`${BASE_URL}/`);
    await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
    await runSmoke(`${BASE_URL}/`, "editor", "editor.png");
    await runSmoke(`${BASE_URL}/?runtime=1`, "runtime", "runtime.png");
    console.log("browser readiness smoke passed");
  } finally {
    vite.kill("SIGTERM");
    browser.kill("SIGTERM");
    await rm(profile, { recursive: true, force: true });
  }
});

async function runSmoke(url, expectedMode, screenshotName) {
  const target = await createTarget(url);
  const cdp = await connectCDP(target.webSocketDebuggerUrl);
  const consoleErrors = [];

  cdp.on("Runtime.consoleAPICalled", (event) => {
    if (event.type === "error") consoleErrors.push(event.args?.map((arg) => arg.value ?? arg.description).join(" "));
  });
  cdp.on("Runtime.exceptionThrown", (event) => {
    consoleErrors.push(event.exceptionDetails?.text ?? "Uncaught browser exception");
  });

  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await waitForReady(cdp, expectedMode);

  const loaderVisible = await evalValue(cdp, `
    (() => {
      const loader = document.querySelector("#loader");
      if (!loader) return false;
      const style = getComputedStyle(loader);
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.01;
    })()
  `);
  if (loaderVisible) throw new Error(`${expectedMode} marked ready while loader was still visible`);
  if (consoleErrors.length) throw new Error(`${expectedMode} console errors:\n${consoleErrors.join("\n")}`);

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1365,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(SCREENSHOT_DIR, screenshotName), Buffer.from(shot.data, "base64"));
  await cdp.close();
  await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${target.id}`).catch(() => {});
}

async function waitForReady(cdp, expectedMode) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const ready = await evalValue(cdp, `
      window.__WORLD_READY__ === true &&
      document.body.dataset.worldReady === "true" &&
      window.__WORLD_MODE__ === "${expectedMode}"
    `);
    if (ready) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${expectedMode} readiness markers`);
}

async function evalValue(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function createTarget(url) {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!res.ok) throw new Error(`Failed to create browser target: ${res.status}`);
  return res.json();
}

async function connectCDP(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  ws.addEventListener("message", (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      data.error ? reject(new Error(data.error.message)) : resolve(data.result ?? {});
      return;
    }
    for (const handler of listeners.get(data.method) ?? []) handler(data.params ?? {});
  });

  return {
    send(method, params = {}) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    on(method, handler) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(handler);
    },
    close() {
      ws.close();
    },
  };
}

async function waitForHttp(url) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
