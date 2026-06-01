/**
 * Probe the current DB for everything the hiring/wizard/preboarding/
 * archive work expects, report what's missing, then auto-apply the
 * recent migration files (all idempotent — IF NOT EXISTS).
 *
 *   npx tsx scripts/_probe-and-fix-hiring-schema.ts
 *
 * Safe to run repeatedly. Anything already in place is reported and
 * skipped.
 */
import prisma from "../src/lib/prisma";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ── What we expect ──────────────────────────────────────────────────
// Tables and the columns / indexes added by each migration in this
// session. Used both for the diagnostic pass and to know which
// migration file to re-run if something is missing.

type TableExpect = {
  table: string;
  columns: string[];
  /** Migration file whose IF-NOT-EXISTS statements create this. */
  source: string;
};

const EXPECTED: TableExpect[] = [
  // Per-job Application Form (Hiring Setup tab)
  {
    table: "JobOpeningQuestion",
    columns: ["id", "jobOpeningId", "text", "type", "options", "required", "sortOrder", "createdAt", "updatedAt"],
    source: "20260529150000_job_opening_form_setup",
  },
  {
    table: "JobOpeningFieldConfig",
    columns: ["id", "jobOpeningId", "channel", "fieldKey", "visibility", "sortOrder", "createdAt", "updatedAt"],
    source: "20260529150000_job_opening_form_setup",
  },

  // Wizard schema additions
  {
    table: "JobOpeningLocation",
    columns: ["id", "jobOpeningId", "name", "startHireDate", "targetHireDate", "positions", "sortOrder", "createdAt"],
    source: "20260529180000_job_wizard_v1",
  },
  {
    table: "JobOpeningRecruiterJoin",
    columns: ["jobOpeningId", "userId", "createdAt"],
    source: "20260529180000_job_wizard_v1",
  },
  {
    table: "JobOpeningHiringManagerJoin",
    columns: ["jobOpeningId", "userId", "createdAt"],
    source: "20260529180000_job_wizard_v1",
  },
];

type ColumnAdd = {
  table: string;
  columns: string[];
  source: string;
};

const COLUMN_ADDS: ColumnAdd[] = [
  // Wizard fields on JobOpening
  {
    table: "JobOpening",
    columns: [
      "currency", "salaryMin", "salaryMax", "salaryUnit",
      "allowReapplyDays", "archiveAfterFilled",
      "inboundOwnerStrategy", "inboundOwnerUserId",
      "interviewFeedbackVisibility",
      "recruitersAccessOwnOnly", "interviewersAccessOwnOnly",
      "notifyRecruiterOnNewCandidate", "notifyHiringMgrOnNewCandidate",
      "publishChannels",
    ],
    source: "20260529180000_job_wizard_v1",
  },
  // Tags
  {
    table: "JobApplication",
    columns: ["tags"],
    source: "20260529160000_jobapplication_tags",
  },
  // Owner
  {
    table: "JobApplication",
    columns: ["recruiterOwnerId"],
    source: "20260529170000_jobapplication_owner",
  },
  // Archive
  {
    table: "JobApplication",
    columns: ["archiveReason", "archiveNote", "archivedAt"],
    source: "20260529190000_candidate_archive_reason",
  },
];

// ── DB introspection ────────────────────────────────────────────────

async function tableExists(t: string): Promise<boolean> {
  const r = await prisma.$queryRawUnsafe<any[]>(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
    t,
  );
  return r.length > 0;
}

async function tableColumns(t: string): Promise<string[]> {
  const r = await prisma.$queryRawUnsafe<any[]>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    t,
  );
  return r.map((x) => x.column_name);
}

// ── Migration runner — per-statement (handles trailing commas, etc.) ─

async function applyMigration(name: string): Promise<{ applied: number; skipped: number }> {
  const sqlPath = resolve("prisma/migrations", name, "migration.sql");
  if (!existsSync(sqlPath)) {
    console.log(`    ⚠ migration file not found: ${sqlPath}`);
    return { applied: 0, skipped: 0 };
  }
  const raw = readFileSync(sqlPath, "utf8");
  const stripped = raw
    .split("\n")
    .map((l) => {
      const i = l.indexOf("--");
      return i >= 0 ? l.slice(0, i) : l;
    })
    .join("\n");

  // Split on semicolons that end a statement. DO $$ blocks span
  // multiple semicolons internally so we keep them together using a
  // crude balanced-$$ counter.
  const stmts: string[] = [];
  let cur = "";
  let inDollar = false;
  for (const tok of stripped.split(/(\$\$|;)/)) {
    if (tok === "$$") {
      inDollar = !inDollar;
      cur += tok;
      continue;
    }
    if (tok === ";" && !inDollar) {
      const s = cur.trim();
      if (s.length) stmts.push(s);
      cur = "";
      continue;
    }
    cur += tok;
  }
  if (cur.trim().length) stmts.push(cur.trim());

  let applied = 0, skipped = 0;
  for (const sql of stmts) {
    const preview = sql.slice(0, 70).replace(/\s+/g, " ");
    try {
      await prisma.$executeRawUnsafe(sql);
      applied++;
      console.log(`    ✓ ${preview}${sql.length > 70 ? "…" : ""}`);
    } catch (e: any) {
      const msg = String(e?.meta?.message || e?.message || e);
      if (/already exists|duplicate/i.test(msg)) {
        skipped++;
        console.log(`    ⊘ ${preview}…  (already applied)`);
        continue;
      }
      if (/permission denied|must be owner/i.test(msg)) {
        console.log(`    ⚠ ${preview}…  (permission denied — run as the owning role)`);
        continue;
      }
      console.error(`    ✗ ${preview}…\n      ${msg}`);
      // keep going — other statements may still apply
    }
  }
  return { applied, skipped };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("══════════════════════════════════════════════════════════════");
  console.log(" Probing hiring schema state");
  console.log("══════════════════════════════════════════════════════════════\n");

  const missingTables: TableExpect[] = [];
  const tablesWithMissingCols: { exp: TableExpect; missing: string[] }[] = [];

  // Pass 1 — tables created this session
  for (const exp of EXPECTED) {
    const has = await tableExists(exp.table);
    if (!has) {
      console.log(`  ✗ TABLE  "${exp.table}"   — MISSING (from ${exp.source})`);
      missingTables.push(exp);
      continue;
    }
    const cols = await tableColumns(exp.table);
    const missing = exp.columns.filter((c) => !cols.includes(c));
    if (missing.length) {
      console.log(`  ⚠ TABLE  "${exp.table}"   — present but missing cols: ${missing.join(", ")}`);
      tablesWithMissingCols.push({ exp, missing });
    } else {
      console.log(`  ✓ TABLE  "${exp.table}"   — ok (${cols.length} cols)`);
    }
  }

  // Pass 2 — column-adds on existing tables
  const colsMissingByMigration = new Map<string, string[]>();
  for (const add of COLUMN_ADDS) {
    const has = await tableExists(add.table);
    if (!has) {
      console.log(`  ✗ COLUMNS for "${add.table}"  — base table missing!?`);
      continue;
    }
    const present = new Set(await tableColumns(add.table));
    const missing = add.columns.filter((c) => !present.has(c));
    if (missing.length === 0) {
      console.log(`  ✓ COLS   "${add.table}".{${add.columns.join(", ")}}  — ok`);
    } else {
      console.log(`  ✗ COLS   "${add.table}"  — missing: ${missing.join(", ")}  (from ${add.source})`);
      colsMissingByMigration.set(add.source, [
        ...(colsMissingByMigration.get(add.source) ?? []),
        ...missing.map((c) => `${add.table}.${c}`),
      ]);
    }
  }

  // ── Auto-fix ────────────────────────────────────────────────────
  const migrationsToRun = new Set<string>([
    ...missingTables.map((m) => m.source),
    ...tablesWithMissingCols.map((m) => m.exp.source),
    ...colsMissingByMigration.keys(),
  ]);

  if (migrationsToRun.size === 0) {
    console.log("\n══════════════════════════════════════════════════════════════");
    console.log("  ✅  Schema is up to date — nothing to do.");
    console.log("══════════════════════════════════════════════════════════════");
    return;
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`  Applying ${migrationsToRun.size} migration(s)`);
  console.log("══════════════════════════════════════════════════════════════");
  // Sort so multiple migrations run in timestamp order.
  for (const name of [...migrationsToRun].sort()) {
    console.log(`\n  ▸ ${name}`);
    await applyMigration(name);
  }

  // ── Re-verify ────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  Re-checking after fixes");
  console.log("══════════════════════════════════════════════════════════════\n");
  let allGood = true;
  for (const exp of EXPECTED) {
    const has = await tableExists(exp.table);
    const cols = has ? await tableColumns(exp.table) : [];
    const missing = exp.columns.filter((c) => !cols.includes(c));
    if (!has || missing.length) {
      console.log(`  ✗ "${exp.table}"   ${has ? `missing cols: ${missing.join(", ")}` : "still missing"}`);
      allGood = false;
    } else {
      console.log(`  ✓ "${exp.table}"   ok`);
    }
  }
  for (const add of COLUMN_ADDS) {
    const cols = await tableColumns(add.table);
    const missing = add.columns.filter((c) => !cols.includes(c));
    if (missing.length) {
      console.log(`  ✗ "${add.table}".[${missing.join(", ")}]   still missing`);
      allGood = false;
    } else {
      console.log(`  ✓ "${add.table}".[${add.columns.join(", ")}]   ok`);
    }
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(allGood
    ? "  ✅  All migrations applied successfully."
    : "  ⚠  Some items still missing — check the log above. The most\n      common cause is owner-only permissions; re-run as the role\n      that owns the legacy tables (often `gagan` on this VPS).");
  console.log("══════════════════════════════════════════════════════════════");
}

main()
  .catch((e) => {
    console.error("Probe failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
