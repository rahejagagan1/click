/**
 * One-shot cleanup for testing:
 *   • Deletes every pending WFHRequest and OnDutyRequest row + their
 *     notifications, so you can resubmit from scratch.
 *   • Clears `clockOut` on TODAY's attendance rows (IST), resets
 *     `totalMinutes` and status, keeps `clockIn` intact.
 *
 * Nothing pre-existing gets touched:
 *   • Past-day attendance rows are untouched.
 *   • Already-approved or rejected WFH / OD rows are untouched.
 *   • Leave / regularization requests are untouched.
 *
 * Run:
 *   npx tsx scripts/reset-wfh-and-clockout.ts
 */

import prisma from "../src/lib/prisma";
import { istTodayDateOnly } from "../src/lib/ist-date";

async function main() {
    // 1. Show + delete pending WFH / OD requests.
    const pendingWfh = await prisma.wFHRequest.findMany({
        where: { status: "pending" },
        select: { id: true, userId: true, date: true, reason: true },
    });
    const pendingOd  = await prisma.onDutyRequest.findMany({
        where: { status: "pending" },
        select: { id: true, userId: true, date: true, purpose: true },
    });
    console.log(`[reset] ${pendingWfh.length} pending WFH, ${pendingOd.length} pending OnDuty`);
    for (const r of pendingWfh) console.log(`  - WFH id=${r.id} userId=${r.userId} date=${r.date.toISOString().slice(0, 10)}`);
    for (const r of pendingOd)  console.log(`  - OD  id=${r.id} userId=${r.userId} date=${r.date.toISOString().slice(0, 10)}`);

    const wfhIds = pendingWfh.map((r) => r.id);
    const odIds  = pendingOd.map((r) => r.id);

    if (wfhIds.length > 0) {
        const nWfh = await prisma.notification.deleteMany({
            where: { type: "wfh", entityId: { in: wfhIds } },
        });
        console.log(`[reset] Deleted ${nWfh.count} WFH notification(s).`);
    }
    if (odIds.length > 0) {
        const nOd = await prisma.notification.deleteMany({
            where: { type: "on_duty", entityId: { in: odIds } },
        });
        console.log(`[reset] Deleted ${nOd.count} On-Duty notification(s).`);
    }

    const dWfh = await prisma.wFHRequest.deleteMany({ where: { status: "pending" } });
    const dOd  = await prisma.onDutyRequest.deleteMany({ where: { status: "pending" } });
    console.log(`[reset] Deleted ${dWfh.count} WFH and ${dOd.count} OnDuty pending request(s).`);

    // 2. Clear clockOut on TODAY's attendance rows, keep clockIn.
    const today = istTodayDateOnly();
    const todayRows = await prisma.attendance.findMany({
        where: { date: today, clockOut: { not: null } },
        select: { id: true, userId: true, clockIn: true, clockOut: true },
    });
    console.log(`[reset] ${todayRows.length} attendance row(s) for today have a clockOut to clear.`);
    for (const a of todayRows) {
        console.log(`  - Attendance id=${a.id} userId=${a.userId} in=${a.clockIn?.toISOString()} out=${a.clockOut?.toISOString()}`);
    }
    const upd = await prisma.attendance.updateMany({
        where: { date: today, clockOut: { not: null } },
        data:  { clockOut: null, totalMinutes: 0, status: "present" },
    });
    console.log(`[reset] Cleared clockOut on ${upd.count} row(s). clockIn preserved.`);

    console.log("[reset] Done.");
}

main()
    .catch((e) => { console.error("[reset] fatal:", e); process.exit(1); })
    .finally(() => prisma.$disconnect());
