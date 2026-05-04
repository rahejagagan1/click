// One-shot: rename existing EmployeeProfile.department values from
// "SocialMedia" → "Social Media". The dropdown was renamed to add
// the space + "Content Strategist", and existing stored rows would
// otherwise look like a one-off custom value in the merged options.
//
// Idempotent — safe to re-run; only writes when there's something to fix.
//
// Run:  npx tsx scripts/_rename-socialmedia-department.ts
// Add `--dry` to preview without writing.

import { PrismaClient } from "@prisma/client";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const isDry = process.argv.includes("--dry");
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count
         FROM "EmployeeProfile"
        WHERE "department" = 'SocialMedia'`,
    );
    const count = Number(rows[0]?.count ?? 0n);
    if (count === 0) {
      console.log("No 'SocialMedia' rows to rename — nothing to do.");
      return;
    }
    if (isDry) {
      console.log(`[dry] Would rename ${count} EmployeeProfile rows from 'SocialMedia' → 'Social Media'.`);
      return;
    }
    const updated = await prisma.$executeRawUnsafe(
      `UPDATE "EmployeeProfile" SET "department" = 'Social Media' WHERE "department" = 'SocialMedia'`,
    );
    console.log(`✓ Renamed ${updated} rows.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
