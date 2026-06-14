// Human-facing artifacts for a playable build: the README, the JSON validation
// report, a standalone launcher page, and a short summary string for the editor
// "Show Last Export Report" action. All pure text builders — Node-safe.

/**
 * Multi-line summary for the editor status line / console.
 */
export function summarizeExport(manifest, validation) {
  const lines = [
    `${manifest.worldName} — playable build`,
    `objects ${manifest.objectCount} · assets ${manifest.assetCount} · prefabs ${manifest.prefabCount}` +
      (manifest.missingAssetCount ? ` · missing ${manifest.missingAssetCount}` : ""),
    `runtime: ${manifest.requiredCapabilities.join(", ")}`,
    `validation: ${validation.ok ? "PASS" : "FAIL"}` +
      (validation.warnings.length ? ` (${validation.warnings.length} warning${validation.warnings.length === 1 ? "" : "s"})` : ""),
  ];
  for (const error of validation.errors) lines.push(`  ✗ ${error}`);
  for (const warning of validation.warnings.slice(0, 6)) lines.push(`  • ${warning}`);
  return lines.join("\n");
}

/**
 * docs/validation-report.json content (the structured report plus the manifest).
 */
export function buildValidationReport(manifest, validation) {
  return {
    generatedAt: manifest.exportedAt,
    world: manifest.worldName,
    ok: validation.ok,
    errors: validation.errors,
    warnings: validation.warnings,
    criteria: validation.report.criteria,
    manifest,
  };
}

/**
 * docs/README.txt — explains the package and how to run it, and is honest about
 * the in-browser limitation: the runtime JS bundle is produced by the project's
 * `npm run build`; the data package here is consumed by that runtime.
 */
export function buildReadme(manifest, validation) {
  const assetLines = manifest.assetReferences.length
    ? manifest.assetReferences.map((ref) =>
        `    - ${ref.id} (${ref.type ?? "?"}) ${ref.missing ? "MISSING — placeholder at runtime" : `${formatBytes(ref.sizeBytes)} embedded`}`)
    : ["    (none — this world uses procedural primitives only)"];

  return [
    `${manifest.worldName} — Playable Build`,
    `Exported ${manifest.exportedAt}`,
    `Format ${manifest.format} v${manifest.buildVersion} · WorldDocument v${manifest.worldDocumentVersion}`,
    "",
    "CONTENTS",
    "  index.html                  launcher (loads the worldpack, links to the runtime)",
    "  world.worldpack.json        self-contained world + assets + manifest (single file)",
    "  world/world.json            the WorldDocument v2 on its own",
    "  world/manifest.json         build manifest (counts, capabilities, asset refs)",
    "  assets/                     decoded external asset blobs (if any)",
    "  docs/README.txt             this file",
    "  docs/validation-report.json the validation report",
    "",
    "SUMMARY",
    `  Objects:  ${manifest.objectCount}`,
    `  Assets:   ${manifest.assetCount} embedded${manifest.missingAssetCount ? `, ${manifest.missingAssetCount} missing` : ""}`,
    `  Prefabs:  ${manifest.prefabCount}`,
    `  Runtime:  ${manifest.requiredCapabilities.join(", ")}`,
    `  Validation: ${validation.ok ? "PASS" : "FAIL"}`,
    "",
    "ASSETS",
    ...assetLines,
    "",
    "HOW TO RUN",
    "  This package is a self-contained DATA build. The 3D runtime itself is the",
    "  World Builder app bundle produced by `npm run build` (Vite). To play:",
    "",
    "    1. Build the app:           npm run build",
    "    2. Serve the build output:  npm run preview   (or any static server)",
    "    3. Open the runtime with this world:",
    "         <app-url>/?runtime=1&worldpack=<url-to-world.worldpack.json>",
    "",
    "  The included index.html is a launcher that loads world.worldpack.json and",
    "  links into that runtime URL. Serve this folder alongside the built app.",
    "",
    "LIMITATION",
    "  In-browser export cannot bundle the runtime JavaScript, so this package",
    "  ships world data (not a standalone JS engine). The runtime loader consumes",
    "  world.worldpack.json directly via `?worldpack=`.",
    ...(validation.warnings.length ? ["", "WARNINGS", ...validation.warnings.map((w) => `  • ${w}`)] : []),
    "",
  ].join("\n");
}

/**
 * A small standalone launcher page. It fetches the sibling worldpack, shows the
 * manifest + validation summary, and links into the World Builder runtime with
 * `?worldpack=`. Real behaviour (no fake controls): the runtime base is editable
 * because the launcher does not know where the app bundle is hosted.
 */
export function buildLauncherHtml(manifest, validation) {
  // Escape every "<" so an attacker-controlled worldName/warning cannot break out
  // of the inline <script> with "</script>" (the manifest is untrusted input).
  const data = JSON.stringify({ manifest, validation: { ok: validation.ok, warnings: validation.warnings, errors: validation.errors } })
    .replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(manifest.worldName)} — Playable Build</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; background:radial-gradient(120% 120% at 50% 20%,#14201a,#0b0f0d 70%);
    color:#d7e6dc; font:14px/1.6 ui-monospace,Menlo,Consolas,monospace; display:grid; place-items:center; padding:32px; }
  .card { width:min(640px,100%); background:rgba(8,13,11,.8); border:1px solid rgba(120,200,140,.24);
    border-radius:14px; padding:24px 26px; backdrop-filter:blur(8px); }
  h1 { font-size:16px; letter-spacing:.12em; color:#7fdca0; margin:0 0 4px; text-transform:uppercase; }
  .sub { color:#8fa899; font-size:12px; margin-bottom:18px; }
  dl { display:grid; grid-template-columns:auto 1fr; gap:4px 16px; margin:0 0 18px; }
  dt { color:#8fa899; } dd { margin:0; }
  .row { display:flex; gap:10px; align-items:center; margin-top:8px; flex-wrap:wrap; }
  input { flex:1; min-width:200px; font:inherit; font-size:12px; padding:8px 10px; color:#d7e6dc;
    background:rgba(127,220,160,.08); border:1px solid rgba(120,200,140,.25); border-radius:8px; }
  a.play, button { cursor:pointer; font:inherit; font-size:12px; padding:9px 16px; color:#0b0f0d; background:#7fdca0;
    border:0; border-radius:8px; text-decoration:none; font-weight:600; }
  .warn { color:#ffce85; font-size:12px; margin-top:6px; }
  .ok { color:#7fdca0; } .fail { color:#ff8f8f; }
  code { color:#9fe0b6; }
</style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(manifest.worldName)}</h1>
    <div class="sub">Playable build · exported ${escapeHtml(manifest.exportedAt)}</div>
    <dl>
      <dt>Objects</dt><dd>${manifest.objectCount}</dd>
      <dt>Assets</dt><dd>${manifest.assetCount} embedded${manifest.missingAssetCount ? `, ${manifest.missingAssetCount} missing` : ""}</dd>
      <dt>Prefabs</dt><dd>${manifest.prefabCount}</dd>
      <dt>Runtime</dt><dd>${escapeHtml(manifest.requiredCapabilities.join(", "))}</dd>
      <dt>Validation</dt><dd class="${validation.ok ? "ok" : "fail"}">${validation.ok ? "PASS" : "FAIL"}</dd>
    </dl>
    <div class="sub">Set the URL of your built World Builder app, then launch this world in its runtime.</div>
    <div class="row">
      <input id="base" value="../" />
      <a class="play" id="play" href="#">▶ Launch in runtime</a>
    </div>
    <div id="messages"></div>
  </div>
<script>
  const DATA = ${data};
  const pack = "world.worldpack.json";
  const messages = document.getElementById("messages");
  for (const w of DATA.validation.warnings || []) {
    const el = document.createElement("div"); el.className = "warn"; el.textContent = "• " + w; messages.appendChild(el);
  }
  document.getElementById("play").addEventListener("click", (e) => {
    e.preventDefault();
    const base = document.getElementById("base").value.trim() || "../";
    const packUrl = new URL(pack, location.href).href;
    const sep = base.includes("?") ? "&" : "?";
    location.href = base + sep + "runtime=1&worldpack=" + encodeURIComponent(packUrl);
  });
</script>
</body>
</html>`;
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
