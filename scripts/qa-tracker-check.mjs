// Canonical QA tracker integrity check (fails closed).
// Validates qa/Feature_Stories.csv against the confirmed-feature contract:
//   - unique, well-formed Feature IDs
//   - no blank required fields
//   - controlled-vocabulary fields (Status / Priority / Code Confidence / Discovery Method)
//   - every Source Evidence file path exists on disk
//   - every Test Evidence `npm run <script>` exists in package.json
//   - Confirmed rows carry Test Evidence
// Exit 0 only when every row passes; exit 1 (with a per-row report) otherwise.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSV = path.join(ROOT, "qa", "Feature_Stories.csv");

const EXPECTED_HEADER = [
  "Feature ID", "Area/Module", "Feature Name", "User Role", "User Story",
  "Expected Behavior", "Source Evidence", "UI/API Entry Point", "Test Evidence",
  "Status", "Priority", "Code Confidence", "Discovery Method", "Dependencies",
  "Notes", "Last Reviewed",
];
const REQUIRED = [
  "Feature ID", "Area/Module", "Feature Name", "User Role", "User Story",
  "Expected Behavior", "Source Evidence", "UI/API Entry Point",
  "Status", "Priority", "Code Confidence", "Discovery Method", "Last Reviewed",
];
const VOCAB = {
  Status: new Set(["Confirmed", "Candidate", "Deferred"]),
  Priority: new Set(["Critical", "High", "Medium", "Low"]),
  "Code Confidence": new Set(["High", "Med", "Low"]),
};
const DISCOVERY_TOKENS = new Set(["route", "component", "test", "doc", "code"]);

// Minimal RFC4180 CSV parser (handles quoted fields, doubled quotes, commas, newlines).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* ignore */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

function sourcePaths(cell) {
  // "src/main.js:1101 (boot); index.html:204 (#loader)" -> ["src/main.js", "index.html"]
  return cell.split(";").map((tok) => {
    const t = tok.trim();
    if (!t) return null;
    // strip a trailing ":line" and any "(note)"; the path is the leading run before ":" or space
    const m = t.match(/^([^\s:()]+)/);
    return m ? m[1] : null;
  }).filter(Boolean);
}

function testScripts(cell) {
  // may hold multiple "npm run x" separated by ; — return script names
  if (!cell.trim()) return [];
  return cell.split(";").map((s) => {
    const m = s.trim().match(/^npm run ([\w:-]+)$/);
    return m ? m[1] : { invalid: s.trim() };
  });
}

const errors = [];
const warnings = [];

if (!existsSync(CSV)) {
  console.error(`[tracker-check] FAIL: ${path.relative(ROOT, CSV)} does not exist`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const scripts = new Set(Object.keys(pkg.scripts ?? {}));

const rows = parseCsv(readFileSync(CSV, "utf8"));
const header = rows[0] ?? [];
if (JSON.stringify(header) !== JSON.stringify(EXPECTED_HEADER)) {
  errors.push(`header mismatch:\n  expected ${JSON.stringify(EXPECTED_HEADER)}\n  got      ${JSON.stringify(header)}`);
}
const col = Object.fromEntries(header.map((h, i) => [h, i]));
const seenIds = new Set();
const dataRows = rows.slice(1);

for (const r of dataRows) {
  const id = r[col["Feature ID"]] ?? `(row ${r})`;
  const at = (name) => (r[col[name]] ?? "").trim();
  if (r.length !== EXPECTED_HEADER.length) {
    errors.push(`${id}: has ${r.length} columns, expected ${EXPECTED_HEADER.length}`);
    continue;
  }
  if (!/^GW-\d{3}$/.test(id)) errors.push(`${id}: Feature ID must match GW-###`);
  if (seenIds.has(id)) errors.push(`${id}: duplicate Feature ID`);
  seenIds.add(id);

  for (const field of REQUIRED) if (!at(field)) errors.push(`${id}: required field "${field}" is blank`);

  for (const [field, set] of Object.entries(VOCAB)) {
    const v = at(field);
    if (v && !set.has(v)) errors.push(`${id}: ${field}="${v}" not in {${[...set].join(", ")}}`);
  }
  for (const tok of at("Discovery Method").split("+").map((t) => t.trim()).filter(Boolean)) {
    if (!DISCOVERY_TOKENS.has(tok)) errors.push(`${id}: Discovery Method token "${tok}" not in {${[...DISCOVERY_TOKENS].join(", ")}}`);
  }

  for (const p of sourcePaths(at("Source Evidence"))) {
    if (!existsSync(path.join(ROOT, p))) errors.push(`${id}: Source Evidence path "${p}" does not exist`);
  }

  const te = at("Test Evidence");
  // A Confirmed feature must EITHER cite a real automated check OR explicitly declare the
  // gap with a NO-AUTOMATED-COVERAGE marker in Notes (no silent gaps — Phase T resolves these).
  if (at("Status") === "Confirmed" && !te && !/NO-AUTOMATED-COVERAGE/.test(at("Notes")))
    errors.push(`${id}: Confirmed row has no Test Evidence and no NO-AUTOMATED-COVERAGE marker in Notes`);
  for (const t of testScripts(te)) {
    if (typeof t === "object") errors.push(`${id}: Test Evidence "${t.invalid}" is not "npm run <script>"`);
    else if (!scripts.has(t)) errors.push(`${id}: Test Evidence script "${t}" not in package.json`);
  }
}

console.log(`[tracker-check] ${path.relative(ROOT, CSV)} — ${dataRows.length} feature rows`);
if (warnings.length) { console.log(`[tracker-check] ${warnings.length} warning(s):`); for (const w of warnings) console.log(`  WARN ${w}`); }
if (errors.length) {
  console.error(`[tracker-check] FAIL — ${errors.length} error(s):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`[tracker-check] PASS — all ${dataRows.length} rows valid`);
