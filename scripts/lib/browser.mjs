// Shared headless-browser harness for the committed browser proofs.
//
// Hygiene guarantees:
//   - Vite is spawned DIRECTLY (node_modules/.bin/vite), not via `npm run dev`,
//     so .kill() actually reaps it — `npm run dev` orphans the vite grandchild
//     and leaves a dev server squatting the port.
//   - withBrowserProof() always tears down vite + chrome + the temp profile in a
//     finally, on success or failure, so no orphaned dev server remains.
//   - SwiftShader/ANGLE flags so WebGL initializes headless.

import { accessSync, constants } from "node:fs";
import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

export function findChrome() {
  const home = process.env.HOME ?? "";
  const candidates = [
    process.env.CHROME_BIN,
    `${home}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`,
    `${home}/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`,
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
  }) ?? null;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForHttp(url, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // retry
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url}`);
}

/**
 * Spawn vite + chrome, run fn({ port, cdpPort }), then ALWAYS tear them down.
 * Returns { skipped: true } (without running fn) when no Chromium is available,
 * so the proof degrades to a no-op on machines without a browser.
 */
export async function withBrowserProof({ root, port, cdpPort, profile }, fn) {
  const chrome = findChrome();
  if (!chrome) {
    console.warn("Browser proof skipped: no Chromium/Chrome found. Set CHROME_BIN to enable.");
    return { skipped: true };
  }
  const vite = spawn(path.join(root, "node_modules/.bin/vite"), ["--host", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const browser = spawn(chrome, [
    "--headless=new",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  try {
    await waitForHttp(`http://127.0.0.1:${port}/`);
    await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`);
    await fn({ port, cdpPort });
    return { skipped: false };
  } finally {
    // Wait for both children to actually exit (escalating to SIGKILL) BEFORE
    // removing the profile, so no vite dev server is orphaned and chrome has
    // released its profile files.
    await Promise.all([terminate(vite), terminate(browser)]);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

function terminate(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(killTimer);
      clearTimeout(hardCap);
      resolve();
    };
    // Resolve only on the REAL exit (so we never return while the process is
    // still alive). Escalate SIGTERM → SIGKILL, with a hard cap as a backstop.
    child.once("exit", finish);
    const killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }, 2500);
    const hardCap = setTimeout(finish, 6000);
    try {
      child.kill("SIGTERM");
    } catch {
      finish();
    }
  });
}

export async function createTarget(cdpPort, url) {
  const res = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!res.ok) throw new Error(`create browser target failed: ${res.status}`);
  return res.json();
}

/**
 * Open a page, returning a CDP session plus a live console-error collector and a
 * close() helper that disposes the target.
 */
export async function openPage(cdpPort, url) {
  const target = await createTarget(cdpPort, url);
  const cdp = await connectCDP(target.webSocketDebuggerUrl);
  const consoleErrors = [];
  cdp.on("Runtime.consoleAPICalled", (event) => {
    if (event.type === "error") consoleErrors.push((event.args ?? []).map((arg) => arg.value ?? arg.description).join(" "));
  });
  cdp.on("Runtime.exceptionThrown", (event) => consoleErrors.push(event.exceptionDetails?.text ?? "Uncaught browser exception"));
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  return {
    cdp,
    consoleErrors,
    close: async () => {
      await cdp.close();
      await fetch(`http://127.0.0.1:${cdpPort}/json/close/${target.id}`).catch(() => {});
    },
  };
}

export async function waitForReady(cdp, mode, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ready = await evalValue(cdp, `window.__WORLD_READY__ === true && window.__WORLD_MODE__ === "${mode}"`);
    if (ready) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${mode} readiness`);
}

export async function evalValue(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text + " " + (result.exceptionDetails.exception?.description ?? ""));
  }
  return result.result.value;
}

export async function connectCDP(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;
  let closed = false;

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  // After the handshake, stay robust through teardown: swallow socket errors,
  // ignore messages once closed, and never throw out of the message handler
  // (a late frame arriving as the browser is killed must not crash the process).
  ws.addEventListener("error", () => {});
  ws.addEventListener("close", () => {
    closed = true;
    // Reject (not just drop) in-flight requests so an awaiting caller unwinds to
    // its finally and teardown runs — otherwise a mid-eval browser crash would
    // hang the caller forever and orphan vite.
    const error = new Error("CDP connection closed");
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  });
  ws.addEventListener("message", (message) => {
    if (closed) return;
    let data;
    try {
      data = JSON.parse(message.data);
    } catch {
      return;
    }
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      data.error ? reject(new Error(data.error.message)) : resolve(data.result ?? {});
      return;
    }
    for (const handler of listeners.get(data.method) ?? []) {
      try {
        handler(data.params ?? {});
      } catch {
        // ignore listener errors during teardown
      }
    }
  });

  return {
    send(method, params = {}) {
      if (closed) return Promise.reject(new Error("CDP connection closed"));
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    on(method, handler) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(handler);
    },
    close() {
      closed = true;
      try {
        ws.close();
      } catch {
        // already closing
      }
    },
  };
}
