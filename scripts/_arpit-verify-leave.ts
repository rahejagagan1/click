import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const user = await p.user.findUnique({
    where: { email: "arpit@nbmediaproductions.com" },
    select: { id: true, name: true },
  });
  if (!user) return;

  const all = await p.leaveApplication.findMany({
    where: { userId: user.id },
    include: { leaveType: true },
    orderBy: { id: "asc" },
  });

  console.log(`All leave applications for ${user.name} (id=${user.id}):`);
  if (all.length === 0) {
    console.log("  (none)");
  } else {
    for (const lv of all) {
      console.log(`  id=${lv.id}  ${lv.leaveType.code}  ${lv.fromDate.toISOString().slice(0,10)} → ${lv.toDate.toISOString().slice(0,10)}  status=${lv.status}`);
    }
  }

  // Also explicitly look for anything touching 2026-04-22
  const yesterdayHits = await p.leaveApplication.findMany({
    where: {
      userId: user.id,
      fromDate: { lte: new Date("2026-04-22T00:00:00.000Z") },
      toDate:   { gte: new Date("2026-04-22T00:00:00.000Z") },
    },
  });
  console.log(`\nApplications covering 2026-04-22: ${yesterdayHits.length}`);

  const bal = await p.leaveBalance.findMany({
    where: { userId: user.id, year: 2026 },
    include: { leaveType: true },
  });
  console.log(`\nLeave balances for 2026:`);
  for (const b of bal) {
    console.log(`  ${b.leaveType.code}: total=${b.totalDays}  used=${b.usedDays}  pending=${b.pendingDays}`);
  }
}
main().catch(console.error).finally(() => p.$disconnect());
