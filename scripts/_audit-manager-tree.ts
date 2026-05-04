// Lists every active user grouped by their manager so you can spot
// who's missing a managerId (those users won't show up in any
// manager's rating list). Read-only.

import { PrismaClient } from "@prisma/client";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, email: true, orgLevel: true, role: true,
        managerId: true,
        manager: { select: { id: true, name: true, orgLevel: true } },
      },
      orderBy: { name: "asc" },
    });

    const orphans = users.filter(u => !u.managerId && u.orgLevel !== "ceo");
    const teams = new Map<string, typeof users>();
    for (const u of users) {
      if (!u.managerId || u.orgLevel === "ceo") continue;
      const key = u.manager ? `${u.manager.id} ${u.manager.name}` : "(unknown manager)";
      if (!teams.has(key)) teams.set(key, []);
      teams.get(key)!.push(u);
    }

    console.log("=== Members grouped by their manager ===\n");
    for (const [mgr, members] of teams) {
      console.log(`Manager #${mgr}  →  ${members.length} report(s)`);
      for (const m of members) {
        console.log(`  · id=${String(m.id).padEnd(3)} ${m.name?.padEnd(28) || "(no name)"} orgLevel=${m.orgLevel}`);
      }
      console.log("");
    }

    if (orphans.length > 0) {
      console.log("=== ORPHANS — no manager assigned (will not appear in any rating list) ===");
      for (const u of orphans) {
        console.log(`  · id=${String(u.id).padEnd(3)} ${u.name?.padEnd(28) || "(no name)"} orgLevel=${u.orgLevel}  role=${u.role}`);
      }
      console.log(`\nTotal orphans: ${orphans.length}`);
    } else {
      console.log("✓ Every active user (other than CEO) has a managerId set.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
