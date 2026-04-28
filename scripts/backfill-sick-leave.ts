/**
 * One-off: bring every active employee's Sick Leave balance up to the
 * current IST calendar month for this year, mimicking N months of
 * monthly accrual at +1/month, capped at 12.
 *
 * Run with:  npx tsx scripts/backfill-sick-leave.ts
 *
 * Idempotent — re-running won't overshoot the cap.
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const SL_CAP = 12;

function istMonthIndex(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { year: parseInt(get("year"), 10), month: parseInt(get("month"), 10) };
}

async function main() {
  const sl = await p.leaveType.findUnique({ where: { code: "SL" }, select: { id: true } });
  if (!sl) { console.log("No 'SL' LeaveType — run scripts/seed-leave-types.ts first."); return; }

  const { year, month } = istMonthIndex();
  const target = Math.min(month, SL_CAP);
  console.log(`Backfilling SL → ${target} day(s) for year ${year} (month ${month}/12).`);

  const users = await p.user.findMany({ where: { isActive: true }, select: { id: true, name: true } });
  let raised = 0, alreadyAtOrAbove = 0, created = 0;

  for (const u of users) {
    const existing = await p.leaveBalance.findUnique({
      where: { userId_leaveTypeId_year: { userId: u.id, leaveTypeId: sl.id, year } },
    });
    if (!existing) {
      await p.leaveBalance.create({
        data: { userId: u.id, leaveTypeId: sl.id, year, totalDays: target, usedDays: 0, pendingDays: 0 },
      });
      created++;
      continue;
    }
    const cur = Number(existing.totalDays);
    if (cur >= target) { alreadyAtOrAbove++; continue; }
    await p.leaveBalance.update({ where: { id: existing.id }, data: { totalDays: target } });
    raised++;
  }

  console.log(`\n✅ Done.`);
  console.log(`  • Created new balance row(s):            ${created}`);
  console.log(`  • Raised totalDays to ${target}:                  ${raised}`);
  console.log(`  • Already at ≥${target} (skipped):                ${alreadyAtOrAbove}`);
  console.log(`  • Total active users processed:           ${users.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
