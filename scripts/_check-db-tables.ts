/**
 * Compares every model defined in prisma/schema.prisma against the
 * tables actually present in the Postgres DB. Reports:
 *   • Models in schema but missing from DB (will cause 42P01 errors)
 *   • Tables in DB that aren't in the current schema (orphans)
 *   • Pending migrations that haven't been applied yet
 *
 * Run with:  npx tsx scripts/_check-db-tables.ts
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const p = new PrismaClient();

async function main() {
  // ── 1. Parse model names from schema.prisma ──────────────────────────
  const schemaPath = path.resolve("prisma/schema.prisma");
  const schema = fs.readFileSync(schemaPath, "utf8");
  const modelMatches = [...schema.matchAll(/^\s*model\s+(\w+)\s*\{/gm)];
  const schemaModels = modelMatches.map((m) => m[1]);

  // ── 2. Query the DB for actual tables ───────────────────────────────
  const rows = await p.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  );
  const dbTables = new Set(rows.map((r) => r.table_name));
  const schemaSet = new Set(schemaModels);

  const missingInDb = schemaModels.filter((m) => !dbTables.has(m));
  const orphanInDb  = [...dbTables].filter(
    (t) => !schemaSet.has(t) && !t.startsWith("_prisma")
  );

  // ── 3. Check pending migrations ─────────────────────────────────────
  const migDir = path.resolve("prisma/migrations");
  const allMigs = fs.existsSync(migDir)
    ? fs.readdirSync(migDir).filter((d) => !d.startsWith(".") && d !== "migration_lock.toml")
    : [];
  let appliedMigs: string[] = [];
  try {
    const mrows = await p.$queryRawUnsafe<{ migration_name: string }[]>(
      `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`
    );
    appliedMigs = mrows.map((r) => r.migration_name);
  } catch {
    // _prisma_migrations doesn't exist — fresh DB
  }
  const pendingMigs = allMigs.filter((m) => !appliedMigs.includes(m));

  // ── Report ──────────────────────────────────────────────────────────
  console.log(`\nSchema models:       ${schemaModels.length}`);
  console.log(`DB tables (public):  ${dbTables.size}`);
  console.log(`Applied migrations:  ${appliedMigs.length} / ${allMigs.length}`);

  if (missingInDb.length === 0) {
    console.log("\n✅ No missing tables — schema and DB are in sync.");
  } else {
    console.log(`\n❌ Missing from DB (${missingInDb.length}):`);
    for (const m of missingInDb) console.log(`   - ${m}`);
  }

  if (orphanInDb.length > 0) {
    console.log(`\n⚠  Extra tables in DB not in schema (${orphanInDb.length}):`);
    for (const t of orphanInDb) console.log(`   - ${t}`);
  }

  if (pendingMigs.length > 0) {
    console.log(`\n⏳ Pending migrations (${pendingMigs.length}) — run 'npx prisma migrate deploy':`);
    for (const m of pendingMigs) console.log(`   - ${m}`);
  }

  if (missingInDb.length > 0 || pendingMigs.length > 0) {
    console.log("\nRun:   npx prisma migrate deploy");
    console.log("Then:  npx prisma generate   (to refresh the typed client)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(() => p.$disconnect());
