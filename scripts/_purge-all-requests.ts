/**
 * One-off: wipe every request row across all approval modules.
 * Run with:  npx tsx scripts/_purge-all-requests.ts
 *
 * Tables cleared:
 *   • LeaveApplication
 *   • AttendanceRegularization
 *   • WFHRequest
 *   • OnDutyRequest
 *   • CompOffRequest
 *
 * Side effect: resets LeaveBalance.usedDays and pendingDays to 0 across
 * the board (totalDays config is preserved). Wiping leave applications
 * without resetting these would leave balances looking "consumed" against
 * applications that no longer exist.
 *
 * Destructive — only intended for dev / test data cleanup.
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const counts = {
    leaves:       await p.leaveApplication.count(),
    regularize:   await p.attendanceRegularization.count(),
    wfh:          await p.wFHRequest.count(),
    onDuty:       await p.onDutyRequest.count(),
    compOff:      await p.compOffRequest.count(),
    balanceRows:  await p.leaveBalance.count(),
  };

  console.log("Pre-purge counts:");
  console.log(`  • LeaveApplication:        ${counts.leaves}`);
  console.log(`  • AttendanceRegularization:${counts.regularize}`);
  console.log(`  • WFHRequest:              ${counts.wfh}`);
  console.log(`  • OnDutyRequest:           ${counts.onDuty}`);
  console.log(`  • CompOffRequest:          ${counts.compOff}`);
  console.log(`  • LeaveBalance rows (will reset used/pending → 0): ${counts.balanceRows}`);

  const total = counts.leaves + counts.regularize + counts.wfh + counts.onDuty + counts.compOff;
  if (total === 0 && counts.balanceRows === 0) {
    console.log("\nNothing to do.");
    return;
  }

  console.log("\nDeleting …");

  const [delLeaves, delReg, delWfh, delOd, delCo, resetBal] = await p.$transaction([
    p.leaveApplication.deleteMany({}),
    p.attendanceRegularization.deleteMany({}),
    p.wFHRequest.deleteMany({}),
    p.onDutyRequest.deleteMany({}),
    p.compOffRequest.deleteMany({}),
    p.leaveBalance.updateMany({ data: { usedDays: 0, pendingDays: 0 } }),
  ]);

  console.log("\n✅ Done.");
  console.log(`  • LeaveApplication deleted:        ${delLeaves.count}`);
  console.log(`  • AttendanceRegularization deleted:${delReg.count}`);
  console.log(`  • WFHRequest deleted:              ${delWfh.count}`);
  console.log(`  • OnDutyRequest deleted:           ${delOd.count}`);
  console.log(`  • CompOffRequest deleted:          ${delCo.count}`);
  console.log(`  • LeaveBalance reset (used/pending → 0): ${resetBal.count}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => p.$disconnect());
