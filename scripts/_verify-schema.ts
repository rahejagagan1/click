/* One-shot DB verification — run on the VPS to confirm every schema
 * change from this session landed correctly. Outputs a pass/fail
 * checklist and exits non-zero on any failure so you can wire it into
 * a deploy gate later if you want.
 *
 *   npx tsx scripts/_verify-schema.ts
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

type Row = { name: string; pass: boolean; detail: string };

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await p.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS exists`,
    table, column,
  );
  return rows[0]?.exists === true;
}

async function tableExists(table: string): Promise<boolean> {
  const rows = await p.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    table,
  );
  return rows[0]?.exists === true;
}

async function migrationApplied(name: string): Promise<boolean> {
  const rows = await p.$queryRawUnsafe<Array<{ finished_at: Date | null }>>(
    `SELECT finished_at FROM "_prisma_migrations" WHERE migration_name = $1 LIMIT 1`,
    name,
  );
  return rows.length > 0 && rows[0].finished_at !== null;
}

async function main() {
  const results: Row[] = [];

  // Migrations expected to be applied by this branch.
  const migrations = [
    "20260515120000_employee_profile_about_blurbs",
    "20260515200000_employee_exit_ok_to_rehire",
  ];
  for (const m of migrations) {
    const ok = await migrationApplied(m);
    results.push({ name: `migration: ${m}`, pass: ok, detail: ok ? "applied" : "MISSING — run `npx prisma migrate deploy`" });
  }

  // EmployeeProfile bios.
  for (const col of ["about", "jobLove", "hobbies"]) {
    const ok = await columnExists("EmployeeProfile", col);
    results.push({ name: `EmployeeProfile.${col}`, pass: ok, detail: ok ? "present" : "MISSING" });
  }

  // EmployeeExit ok-to-rehire.
  const okExit = await columnExists("EmployeeExit", "okToRehire");
  results.push({ name: "EmployeeExit.okToRehire", pass: okExit, detail: okExit ? "present" : "MISSING" });

  // SyncConfig keys created by the new HR toggles (regularization).
  const tableSync = await tableExists("SyncConfig");
  results.push({ name: "Table SyncConfig", pass: tableSync, detail: tableSync ? "present" : "MISSING" });

  // Quick sanity: the EmployeeExit table itself exists (offboard pipeline).
  const tableExits = await tableExists("EmployeeExit");
  results.push({ name: "Table EmployeeExit", pass: tableExits, detail: tableExits ? "present" : "MISSING" });

  // Quick stat: counts so you can eyeball realism.
  const exitsCount: any = await p.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM "EmployeeExit"`);
  const usersCount: any = await p.$queryRawUnsafe(`SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE "isActive") AS active FROM "User"`);
  console.log("─".repeat(78));
  console.log("Stats:");
  console.log(`  Users:    ${usersCount[0]?.n} (${usersCount[0]?.active} active)`);
  console.log(`  Exits:    ${exitsCount[0]?.n}`);
  console.log("─".repeat(78));

  // Pretty-print checklist.
  const PAD = 38;
  for (const r of results) {
    const icon = r.pass ? "✓" : "✗";
    const tone = r.pass ? "\x1b[32m" : "\x1b[31m";
    console.log(`  ${tone}${icon}\x1b[0m ${r.name.padEnd(PAD)} ${r.detail}`);
  }
  console.log("─".repeat(78));
  const failed = results.filter((r) => !r.pass).length;
  if (failed > 0) {
    console.error(`\n${failed} check(s) FAILED. Fix above before serving traffic.`);
    process.exit(1);
  }
  console.log("\nAll checks PASSED ✓");
  await p.$disconnect();
}

main().catch(async (e) => {
  console.error("Verification script crashed:", e);
  await p.$disconnect();
  process.exit(1);
});
