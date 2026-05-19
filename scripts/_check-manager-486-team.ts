import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const mgrId = 486;

  // Manager identity
  const mgr = await p.user.findUnique({
    where: { id: mgrId },
    select: { id: true, name: true, role: true, orgLevel: true },
  });
  console.log(`Manager: ${mgr?.name} (id=${mgr?.id}, role=${mgr?.role}, orgLevel=${mgr?.orgLevel})`);
  console.log();

  // Current live team
  const live = await p.user.findMany({
    where: { managerId: mgrId, isActive: true },
    select: { id: true, name: true, role: true, orgLevel: true },
    orderBy: { name: "asc" },
  });
  console.log(`Live team (User.managerId === ${mgrId}): ${live.length}`);
  for (const u of live) {
    console.log(`  id=${u.id}  ${u.name?.padEnd(24)} role=${u.role}   orgLevel=${u.orgLevel}`);
  }

  const editors    = live.filter((u) => u.role === "editor").length;
  const writers    = live.filter((u) => u.role === "writer").length;
  const researchers = live.filter((u) => u.role === "researcher").length;
  console.log();
  console.log(`Role breakdown:  editor=${editors}  writer=${writers}  researcher=${researchers}`);

  // Saved snapshots for this manager (every period)
  const snaps = await p.$queryRawUnsafe<Array<{ month: number; year: number; teamSnapshot: any }>>(
    `SELECT month, year, "teamSnapshot" FROM "MonthlyReport"
      WHERE "managerId" = $1 AND "teamSnapshot" IS NOT NULL
      ORDER BY year DESC, month DESC`,
    mgrId,
  );
  console.log();
  console.log(`Saved monthly snapshots for this manager: ${snaps.length}`);
  for (const s of snaps) {
    const arr: any[] = Array.isArray(s.teamSnapshot) ? s.teamSnapshot : [];
    const eds = arr.filter((u) => u.role === "editor").length;
    const wrs = arr.filter((u) => u.role === "writer").length;
    console.log(`  ${s.year}-${String(s.month + 1).padStart(2, "0")}: ${arr.length} members  (editor=${eds}, writer=${wrs})`);
    for (const u of arr) {
      console.log(`     - ${u.name?.padEnd(20)} role=${u.role}`);
    }
  }
}

main().catch(console.error).finally(() => p.$disconnect());
