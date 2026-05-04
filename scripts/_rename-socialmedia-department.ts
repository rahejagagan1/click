// One-shot: renames stale department labels to the canonical names
// in src/lib/departments.ts, on BOTH the EmployeeProfile.department
// column and the KpiDocument.department column. Idempotent — safe to
// re-run; only writes when there's something to fix.
//
// Run:  npx tsx scripts/_rename-socialmedia-department.ts
// Add `--dry` to preview without writing.

import { PrismaClient } from "@prisma/client";

// EmployeeProfile.department renames (legacy label → canonical).
// Add new entries when the canonical list in src/lib/departments.ts
// evolves.
const PROFILE_RENAMES: Array<[string, string]> = [
  ["SocialMedia",                  "Social Media"],        // missing space
  ["Social Media Team",            "Social Media"],        // dropped "Team" suffix
  ["Researcher",                   "Researchers"],         // singular → plural
  ["Editor",                       "Editors"],             // singular → plural
  ["Researcher Manager",           "Research Manager"],    // wording change
  ["AI",                           "AI Team"],             // suffixed "Team"
  ["Content Strategy & Research",  "Content Strategist"],  // legacy label
  ["Content Strategy",             "Content Strategist"],  // legacy label
  ["Scripting",                    "Writers"],             // merged — same team
  ["Content Database Executive",   "Content Operations Executive"],  // renamed
  ["IT SUPPORT",                   "IT"],                  // shortened
  ["IT Support",                   "IT"],                  // case variant
];

// KpiDocument.department renames — the upload form already constrains
// new uploads to the canonical roster, but old docs uploaded under
// previous labels still show up as orphan cards. Renaming keeps the
// existing PDF visible under the new card.
const DOC_RENAMES: Array<[string, string]> = [
  ["Social Media Team",            "Social Media"],
  ["Content Database Executive",   "Content Operations Executive"],
];

async function renameTable(
  prisma: PrismaClient,
  table: "EmployeeProfile" | "KpiDocument",
  renames: Array<[string, string]>,
  isDry: boolean,
): Promise<number> {
  let totalUpdated = 0;
  for (const [from, to] of renames) {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "${table}" WHERE "department" = $1`,
      from,
    );
    const count = Number(rows[0]?.count ?? 0n);
    if (count === 0) continue;
    if (isDry) {
      console.log(`[dry] Would rename ${count} ${table} row(s): '${from}' → '${to}'`);
    } else {
      const updated = await prisma.$executeRawUnsafe(
        `UPDATE "${table}" SET "department" = $1 WHERE "department" = $2`,
        to,
        from,
      );
      console.log(`✓ Renamed ${updated} ${table} row(s): '${from}' → '${to}'`);
      totalUpdated += Number(updated);
    }
  }
  return totalUpdated;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const isDry = process.argv.includes("--dry");
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  let totalUpdated = 0;
  try {
    // 1. Strip leading/trailing whitespace on EmployeeProfile.department —
    //    Keka exports occasionally sneak a trailing space in (e.g. "AI ")
    //    which then dodges the exact-match rename.
    if (isDry) {
      const trimRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM "EmployeeProfile"
          WHERE "department" IS NOT NULL AND "department" <> TRIM("department")`,
      );
      const tcount = Number(trimRows[0]?.count ?? 0n);
      if (tcount > 0) console.log(`[dry] Would TRIM whitespace on ${tcount} EmployeeProfile rows.`);
    } else {
      const trimmed = await prisma.$executeRawUnsafe(
        `UPDATE "EmployeeProfile" SET "department" = TRIM("department")
          WHERE "department" IS NOT NULL AND "department" <> TRIM("department")`,
      );
      if (Number(trimmed) > 0) {
        console.log(`✓ Trimmed whitespace on ${trimmed} EmployeeProfile rows.`);
        totalUpdated += Number(trimmed);
      }
    }

    // 2. Rename EmployeeProfile + KpiDocument rows.
    totalUpdated += await renameTable(prisma, "EmployeeProfile", PROFILE_RENAMES, isDry);
    totalUpdated += await renameTable(prisma, "KpiDocument",     DOC_RENAMES,     isDry);

    if (!isDry) {
      console.log("");
      console.log(totalUpdated === 0 ? "Nothing to rename — DB is already clean." : `✓ Total: ${totalUpdated} row(s) renamed.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
