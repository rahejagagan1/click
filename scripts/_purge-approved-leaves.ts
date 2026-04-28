/**
 * One-off: delete every approved LeaveApplication and roll back the
 * matching LeaveBalance.usedDays so the books stay consistent.
 *
 * Run with:  npx tsx scripts/_purge-approved-leaves.ts
 *
 * Destructive — only intended for dev / test data cleanup.
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const approved = await p.leaveApplication.findMany({
    where: { status: "approved" },
    select: { id: true, userId: true, leaveTypeId: true, fromDate: true, totalDays: true },
  });

  console.log(`Found ${approved.length} approved leave row(s).`);
  if (approved.length === 0) return;

  // Aggregate per (userId, leaveTypeId, year) so we can decrement usedDays
  // in one update per balance row.
  const adjust = new Map<string, { userId: number; leaveTypeId: number; year: number; days: number }>();
  for (const a of approved) {
    const year = a.fromDate.getFullYear();
    const key  = `${a.userId}:${a.leaveTypeId}:${year}`;
    const days = parseFloat(String(a.totalDays));
    const cur  = adjust.get(key);
    if (cur) cur.days += days;
    else     adjust.set(key, { userId: a.userId, leaveTypeId: a.leaveTypeId, year, days });
  }

  console.log(`Will roll back used-days on ${adjust.size} balance row(s).`);

  const ops: any[] = [
    p.leaveApplication.deleteMany({ where: { status: "approved" } }),
  ];
  for (const v of adjust.values()) {
    ops.push(
      p.leaveBalance.updateMany({
        where: { userId: v.userId, leaveTypeId: v.leaveTypeId, year: v.year },
        // Clamp via raw decrement; if the balance row went negative for any
        // reason we accept that — caller can fix totals via the admin grid.
        data:  { usedDays: { decrement: v.days } },
      }),
    );
  }

  const results = await p.$transaction(ops);
  console.log(`\n✅ Deleted ${(results[0] as any).count} approved leave row(s).`);
  console.log(`✅ Decremented usedDays on ${results.length - 1} balance row(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => p.$disconnect());
