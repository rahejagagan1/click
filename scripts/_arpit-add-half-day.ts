/**
 * One-off: give Arpit one Half Day in his leave balance for the current year.
 * Run with:  npx tsx scripts/_arpit-add-half-day.ts
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const arpit = await p.user.findFirst({
    where: {
      OR: [
        { email: { contains: "arpit", mode: "insensitive" } },
        { name:  { contains: "arpit", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true },
  });
  if (!arpit) { console.log("No Arpit found."); return; }
  console.log(`Matched: ${arpit.name} <${arpit.email}> (id ${arpit.id})`);

  const hd = await p.leaveType.findUnique({ where: { code: "HD" }, select: { id: true, name: true } });
  if (!hd) { console.log("No HD leave type — run scripts/seed-leave-types.ts first."); return; }

  const year = new Date().getFullYear();
  const row = await p.leaveBalance.upsert({
    where: { userId_leaveTypeId_year: { userId: arpit.id, leaveTypeId: hd.id, year } },
    create: { userId: arpit.id, leaveTypeId: hd.id, year, totalDays: 1, usedDays: 0, pendingDays: 0 },
    update: { totalDays: 1 },
  });

  console.log(`\n✅ Set ${hd.name} balance to 1 for year ${year}.`);
  console.log(`   id=${row.id}  total=${row.totalDays}  used=${row.usedDays}  pending=${row.pendingDays}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => p.$disconnect());
