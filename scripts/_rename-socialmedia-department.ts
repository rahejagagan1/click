// One-shot: renames stale EmployeeProfile.department values to the
// new canonical labels in src/lib/departments.ts. Idempotent — safe
// to re-run; only writes when there's something to fix.
//
// Run:  npx tsx scripts/_rename-socialmedia-department.ts
// Add `--dry` to preview without writing.

import { PrismaClient } from "@prisma/client";

// old → new department label rewrites. Add new entries when the
// canonical list in src/lib/departments.ts evolves.
const RENAMES: Array<[string, string]> = [
  ["SocialMedia",                  "Social Media Team"],   // missing space + now suffixed "Team"
  ["Social Media",                 "Social Media Team"],   // earlier rename, now suffixed
  ["Researcher",                   "Researchers"],         // singular → plural
  ["Editor",                       "Editors"],             // singular → plural
  ["Researcher Manager",           "Research Manager"],    // wording change
  ["AI",                           "AI Team"],             // suffixed "Team"
  ["Content Strategy & Research",  "Content Strategist"],  // legacy label
  ["Content Strategy",             "Content Strategist"],  // legacy label
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const isDry = process.argv.includes("--dry");
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  let totalUpdated = 0;
  try {
    // Strip leading/trailing whitespace first — Keka exports occasionally
    // sneak a trailing space in (e.g. "AI ") which then dodges the
    // exact-match rename below.
    if (isDry) {
      const trimRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM "EmployeeProfile"
          WHERE "department" IS NOT NULL AND "department" <> TRIM("department")`,
      );
      const tcount = Number(trimRows[0]?.count ?? 0n);
      if (tcount > 0) console.log(`[dry] Would TRIM whitespace on ${tcount} rows.`);
    } else {
      const trimmed = await prisma.$executeRawUnsafe(
        `UPDATE "EmployeeProfile" SET "department" = TRIM("department")
          WHERE "department" IS NOT NULL AND "department" <> TRIM("department")`,
      );
      if (Number(trimmed) > 0) {
        console.log(`✓ Trimmed whitespace on ${trimmed} rows.`);
        totalUpdated += Number(trimmed);
      }
    }

    for (const [from, to] of RENAMES) {
      const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM "EmployeeProfile" WHERE "department" = $1`,
        from,
      );
      const count = Number(rows[0]?.count ?? 0n);
      if (count === 0) continue;

      if (isDry) {
        console.log(`[dry] Would rename ${count} rows: '${from}' → '${to}'`);
      } else {
        const updated = await prisma.$executeRawUnsafe(
          `UPDATE "EmployeeProfile" SET "department" = $1 WHERE "department" = $2`,
          to,
          from,
        );
        console.log(`✓ Renamed ${updated} rows: '${from}' → '${to}'`);
        totalUpdated += Number(updated);
      }
    }
    if (!isDry) {
      console.log("");
      console.log(totalUpdated === 0 ? "Nothing to rename — DB is already clean." : `✓ Total: ${totalUpdated} rows renamed.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
