/**
 * Lists folder names under the ClickUp space whose name contains "research" (case-insensitive).
 * Uses CLICKUP_API_TOKEN from .env and workspace id from this file (same as api-client).
 *
 * Run: node scripts/list-researcher-space-folders.mjs
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const WORKSPACE_ID = "9016734871";
const CLICKUP_API = "https://api.clickup.com/api/v2";

function loadEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    console.error("Missing .env — cannot call ClickUp API.");
    process.exit(1);
  }
  const txt = readFileSync(envPath, "utf8");
  for (const line of txt.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

async function clickupGet(path) {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) {
    console.error("CLICKUP_API_TOKEN not set in .env");
    process.exit(1);
  }
  const res = await fetch(`${CLICKUP_API}${path}`, {
    headers: { Authorization: token, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json();
}

loadEnv();

const spacesRes = await clickupGet(`/team/${WORKSPACE_ID}/space?archived=false`);
const spaces = spacesRes.spaces || [];
const researchSpaces = spaces.filter((s) =>
  (s.name || "").toLowerCase().includes("research"),
);

if (researchSpaces.length === 0) {
  console.log('No space with "research" in its name in this workspace. All space names:');
  for (const s of spaces.sort((a, b) => (a.name || "").localeCompare(b.name || ""))) {
    console.log(`  • ${s.name}  (id: ${s.id})`);
  }
  process.exit(0);
}

for (const sp of researchSpaces) {
  console.log(`\nSpace: "${sp.name}"`);
  console.log(`  ClickUp space id: ${sp.id}`);
  const folderRes = await clickupGet(`/space/${sp.id}/folder?archived=false`);
  const folders = folderRes.folders || [];
  console.log(`  Folders: ${folders.length}`);
  for (const f of folders.sort((a, b) => (a.name || "").localeCompare(b.name || ""))) {
    console.log(`    • ${f.name}`);
  }
}
