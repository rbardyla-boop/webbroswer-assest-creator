#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const outDir = path.join(root, 'qa/artifacts');
fs.mkdirSync(outDir, { recursive: true });

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    console.warn('WARN browser smoke skipped: Playwright is not installed. Install with: npm i -D playwright && npx playwright install chromium');
    process.exit(0);
  }
}

function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch {}
      if (Date.now() - start > timeoutMs) return reject(new Error(`server did not become ready: ${url}`));
      setTimeout(tick, 250);
    };
    tick();
  });
}

async function main() {
  const { chromium } = await loadPlaywright();
  const port = process.env.PORT || '5173';
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', port], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  let serverLog = '';
  server.stdout.on('data', (d) => { serverLog += d.toString(); });
  server.stderr.on('data', (d) => { serverLog += d.toString(); });

  try {
    await waitForServer(baseUrl);
    const browser = await chromium.launch({ headless: true });
    const viewports = [
      { name: 'desktop', width: 1280, height: 720 },
      { name: 'mobile', width: 390, height: 844 },
    ];

    const evidence = [];
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport });
      const pageErrors = [];
      const consoleErrors = [];
      page.on('pageerror', (err) => pageErrors.push(String(err)));
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      await page.waitForSelector('canvas', { timeout: 10000 });
      await page.waitForTimeout(1200);

      const canvasInfo = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return { exists: false };
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        let nonBlank = null;
        let sample = null;
        if (gl) {
          const w = Math.max(1, Math.min(32, gl.drawingBufferWidth));
          const h = Math.max(1, Math.min(32, gl.drawingBufferHeight));
          const pixels = new Uint8Array(w * h * 4);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let max = 0;
          let alphaMax = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            max = Math.max(max, pixels[i], pixels[i + 1], pixels[i + 2]);
            alphaMax = Math.max(alphaMax, pixels[i + 3]);
          }
          nonBlank = max > 0 && alphaMax > 0;
          sample = { width: w, height: h, maxRgb: max, maxAlpha: alphaMax };
        }
        return {
          exists: true,
          width: canvas.width,
          height: canvas.height,
          clientWidth: canvas.clientWidth,
          clientHeight: canvas.clientHeight,
          nonBlank,
          sample,
          bodyText: document.body.innerText.slice(0, 500),
        };
      });

      const screenshotPath = path.join(outDir, `browser-smoke-${viewport.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      await page.close();

      if (!canvasInfo.exists) throw new Error(`${viewport.name}: no canvas found`);
      if (canvasInfo.nonBlank === false) throw new Error(`${viewport.name}: WebGL canvas sample appears blank`);
      if (pageErrors.length) throw new Error(`${viewport.name}: page errors: ${pageErrors.join('\n')}`);
      if (consoleErrors.length) throw new Error(`${viewport.name}: console errors: ${consoleErrors.join('\n')}`);

      evidence.push({ viewport, canvasInfo, screenshot: path.relative(root, screenshotPath) });
    }

    await browser.close();
    const reportPath = path.join(outDir, 'browser-smoke-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({ ok: true, evidence }, null, 2));
    console.log(`PASS browser smoke: ${path.relative(root, reportPath)}`);
  } finally {
    server.kill('SIGTERM');
    fs.writeFileSync(path.join(outDir, 'vite-dev.log'), serverLog);
  }
}

main().catch((err) => {
  console.error(`FAIL browser smoke: ${err.stack || err.message}`);
  process.exit(1);
});
