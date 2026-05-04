// Re-aligns every active employee's EmployeeProfile.department based
// on their designation (job title), using the same heuristic the
// bulk Keka import uses (deriveDepartment in src/lib/keka-import.ts).
//
// Skips:
//   • Users whose designation maps to "" (heuristic doesn't recognise
//     the title — manual fix needed).
//   • Users whose computed department equals the stored one — already
//     aligned, no write.
//   • Users whose orgLevel is "ceo" — they don't sit under any KPI dept.
//
// Run:  npx tsx scripts/_align-departments-from-designation.ts
// Add `--dry` to preview without writing.

import { PrismaClient } from "@prisma/client";
import { deriveDepartment } from "../src/lib/keka-import";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const isDry = process.argv.includes("--dry");
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      userId: number;
      name: string | null;
      orgLevel: string | null;
      designation: string | null;
      department: string | null;
    }>>(
      `SELECT u.id AS "userId", u.name, u."orgLevel"::text AS "orgLevel",
              ep."designation", ep."department"
         FROM "EmployeeProfile" ep
         JOIN "User" u ON u.id = ep."userId"
        WHERE u."isActive" = true
        ORDER BY u.name ASC`,
    );

    type Plan = { userId: number; name: string; from: string | null; to: string; designation: string | null };
    const updates: Plan[] = [];
    const noDesignation: Plan[] = [];
    const unrecognised: Plan[] = [];
    let alreadyAligned = 0;

    for (const r of rows) {
      if (r.orgLevel === "ceo") continue;
      const computed = deriveDepartment(r.designation || "", "");
      if (!r.designation || !r.designation.trim()) {
        noDesignation.push({ userId: r.userId, name: r.name || "", from: r.department, to: "", designation: r.designation });
        continue;
      }
      if (!computed) {
        unrecognised.push({ userId: r.userId, name: r.name || "", from: r.department, to: "", designation: r.designation });
        continue;
      }
      if ((r.department || "") === computed) {
        alreadyAligned++;
        continue;
      }
      updates.push({ userId: r.userId, name: r.name || "", from: r.department, to: computed, designation: r.designation });
    }

    console.log(`Already aligned:        ${alreadyAligned}`);
    console.log(`Would update:           ${updates.length}`);
    console.log(`Designation blank:      ${noDesignation.length}  (skipped — fill in Edit Profile)`);
    console.log(`Designation unmatched:  ${unrecognised.length}  (skipped — extend the heuristic)`);
    console.log("");

    if (updates.length > 0) {
      console.log("Proposed updates:");
      for (const u of updates) {
        const fromS = (u.from || "(empty)").padEnd(30);
        const toS   = u.to.padEnd(30);
        console.log(`  id=${String(u.userId).padStart(4)}  ${(u.name).padEnd(28)}  '${fromS}' → '${toS}'   designation='${u.designation}'`);
      }
      console.log("");
    }

    if (unrecognised.length > 0) {
      console.log("Designations the heuristic doesn't recognise (left untouched):");
      for (const u of unrecognised) {
        console.log(`  id=${String(u.userId).padStart(4)}  ${(u.name).padEnd(28)}  designation='${u.designation}'   stored dept='${u.from || "(empty)"}'`);
      }
      console.log("");
    }

    if (noDesignation.length > 0) {
      console.log("Users with no designation set (left untouched):");
      for (const u of noDesignation) {
        console.log(`  id=${String(u.userId).padStart(4)}  ${(u.name).padEnd(28)}  stored dept='${u.from || "(empty)"}'`);
      }
      console.log("");
    }

    if (isDry) {
      console.log("[dry] No changes written.");
      return;
    }

    if (updates.length === 0) {
      console.log("Nothing to update.");
      return;
    }

    let applied = 0;
    for (const u of updates) {
      await prisma.$executeRawUnsafe(
        `UPDATE "EmployeeProfile" SET "department" = $1 WHERE "userId" = $2`,
        u.to, u.userId,
      );
      applied++;
    }
    console.log(`✓ Updated ${applied} employee(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
