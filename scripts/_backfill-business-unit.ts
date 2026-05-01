// One-shot backfill: sets EmployeeProfile.businessUnit = "NB Media"
// for every row where it's currently NULL or empty. Idempotent — safe
// to re-run; only writes when there's something to fix.
//
// Run:  npx tsx scripts/_backfill-business-unit.ts
// Add `--dry` to preview without writing.

import { PrismaClient } from "@prisma/client";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const isDry = process.argv.includes("--dry");
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    if (isDry) {
      const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count
           FROM "EmployeeProfile"
          WHERE "businessUnit" IS NULL OR "businessUnit" = ''`,
      );
      console.log(`[dry] Would update ${rows[0]?.count ?? 0n} rows.`);
      return;
    }
    const result = await prisma.$executeRawUnsafe(
      `UPDATE "EmployeeProfile"
         SET "businessUnit" = 'NB Media'
       WHERE "businessUnit" IS NULL OR "businessUnit" = ''`,
    );
    console.log(`✓ Updated ${result} EmployeeProfile rows to businessUnit='NB Media'.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
