import { PrismaClient } from "@prisma/client";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ designation: string; department: string | null; cnt: bigint }>>(
      `SELECT COALESCE("designation", '(null)') AS designation,
              "department",
              COUNT(*)::bigint AS cnt
         FROM "EmployeeProfile" ep
         JOIN "User" u ON u.id = ep."userId"
        WHERE u."isActive" = true
        GROUP BY "designation", "department"
        ORDER BY "designation", "department"`,
    );
    for (const r of rows) {
      console.log(`  ${(r.designation || "").padEnd(45)}  →  ${(r.department || "(none)").padEnd(28)}  (${r.cnt} user(s))`);
    }
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
