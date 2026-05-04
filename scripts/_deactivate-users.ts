// One-shot: marks the named users isActive=false. They stay in the
// admin Users table (with "Inactive" badge) for record-keeping but
// are excluded from every active-user query: login, email reminders,
// scoring lists, manager dropdowns, reports, attendance.
//
// Run:  npx tsx scripts/_deactivate-users.ts
// Add `--dry` to preview without writing.

import { PrismaClient } from "@prisma/client";

const TARGETS = [
  "contactronitranjan@gmail.com",
  "amishak.work@gmail.com",
  "contact@ronitranjan.com",
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const isDry = process.argv.includes("--dry");
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const matches = await prisma.user.findMany({
      where: { email: { in: TARGETS } },
      select: { id: true, name: true, email: true, isActive: true },
    });

    if (matches.length === 0) {
      console.log("No matching users found — already removed or never existed.");
      return;
    }

    for (const m of matches) {
      console.log(`  ${m.isActive ? "active" : "INACTIVE"}  id=${m.id}  ${m.name}  <${m.email}>`);
    }

    if (isDry) {
      console.log("\n[dry] Would set isActive=false on the active rows above.");
      return;
    }

    const updated = await prisma.user.updateMany({
      where: { email: { in: TARGETS }, isActive: true },
      data:  { isActive: false },
    });
    console.log(`\n✓ Deactivated ${updated.count} user(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
