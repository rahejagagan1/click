// Lists every user who'd be returned by /api/managers under the
// tightened filter, so we can verify the "Manager Reports" sidebar
// will show only true managers. Read-only — no writes.

import { PrismaClient } from "@prisma/client";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const rows = await prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { orgLevel: { in: ["ceo", "special_access", "hod", "manager", "hr_manager"] } },
          { role: { in: ["admin", "manager", "production_manager", "researcher_manager", "hr_manager"] } },
        ],
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, orgLevel: true, role: true },
    });
    for (const r of rows) {
      console.log(
        `  ${String(r.id).padStart(3)}  ${(r.name || "").padEnd(28)} orgLevel=${(r.orgLevel || "").padEnd(15)} role=${r.role}`,
      );
    }
    console.log(`\nTotal managers: ${rows.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
