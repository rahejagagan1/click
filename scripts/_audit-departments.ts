// Lists every department label currently in the DB (EmployeeProfile +
// KpiDocument) and flags anything that doesn't match the canonical
// roster in src/lib/departments.ts. Read-only — no writes.
//
// Run:  npx tsx scripts/_audit-departments.ts

import { PrismaClient } from "@prisma/client";
import { DEPARTMENTS } from "../src/lib/departments";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const canonical = new Set(DEPARTMENTS);

    const profileRows = await prisma.$queryRawUnsafe<Array<{ department: string | null; count: bigint }>>(
      `SELECT "department", COUNT(*)::bigint AS count
         FROM "EmployeeProfile"
        WHERE "department" IS NOT NULL AND "department" <> ''
        GROUP BY "department"
        ORDER BY "department"`,
    );
    const docRows = await prisma.$queryRawUnsafe<Array<{ department: string | null; count: bigint }>>(
      `SELECT "department", COUNT(*)::bigint AS count
         FROM "KpiDocument"
        GROUP BY "department"
        ORDER BY "department"`,
    );

    console.log("EmployeeProfile.department (raw with surround quotes to expose whitespace):");
    for (const r of profileRows) {
      const isCanonical = canonical.has(r.department || "");
      console.log(`  ${(isCanonical ? "✓" : "✗ ORPHAN").padEnd(10)} '${r.department}' (len=${(r.department || "").length})  ${r.count} user(s)`);
    }
    console.log("");
    console.log("Orphan rows — name + email so you can fix them in Edit Profile if needed:");
    const orphans = profileRows.filter((r) => !canonical.has(r.department || ""));
    for (const r of orphans) {
      const users = await prisma.$queryRawUnsafe<Array<{ id: number; name: string; email: string; department: string }>>(
        `SELECT u.id, u.name, u.email, ep."department"
           FROM "EmployeeProfile" ep
           JOIN "User" u ON u.id = ep."userId"
          WHERE ep."department" = $1`,
        r.department,
      );
      console.log(`  '${r.department}':`);
      for (const u of users) console.log(`    · id=${u.id}  ${u.name}  <${u.email}>`);
    }
    console.log("");
    console.log("KpiDocument.department:");
    for (const r of docRows) {
      const isCanonical = canonical.has(r.department || "");
      console.log(`  ${(isCanonical ? "✓" : "✗ ORPHAN").padEnd(10)} '${r.department}' (len=${(r.department || "").length})  ${r.count} doc(s)`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
