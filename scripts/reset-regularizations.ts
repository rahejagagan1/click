/**
 * One-shot cleanup so a fresh regularization flow can be tested end-to-end.
 *
 * Deletes:
 *   • Every AttendanceRegularization row (pending / approved / rejected).
 *   • Every Notification row with type="regularization".
 *   • Resets Attendance rows where isRegularized=true — clears the clockIn /
 *     clockOut / totalMinutes that were seeded by an approval, and flips
 *     isRegularized back to false. Keeps the row so the original (pre-regularize)
 *     data survives if any.
 *
 * Leaves WFH / On-Duty / Leave / Comp-off rows untouched.
 *
 * Run:
 *   npx tsx scripts/reset-regularizations.ts
 */

import prisma from "../src/lib/prisma";

async function main() {
    const regs = await prisma.attendanceRegularization.findMany({
        select: { id: true, userId: true, date: true, status: true },
    });
    console.log(`[reset-reg] Found ${regs.length} regularization row(s).`);
    for (const r of regs) {
        console.log(`  - id=${r.id} userId=${r.userId} date=${r.date.toISOString().slice(0, 10)} status=${r.status}`);
    }

    const notifs = await prisma.notification.deleteMany({ where: { type: "regularization" } });
    console.log(`[reset-reg] Deleted ${notifs.count} regularization notification(s).`);

    const regDel = await prisma.attendanceRegularization.deleteMany({});
    console.log(`[reset-reg] Deleted ${regDel.count} regularization row(s).`);

    const attReset = await prisma.attendance.updateMany({
        where: { isRegularized: true },
        data:  { isRegularized: false, clockIn: null, clockOut: null, totalMinutes: 0, status: "absent" },
    });
    console.log(`[reset-reg] Reset ${attReset.count} previously-regularized attendance row(s).`);

    console.log("[reset-reg] Done.");
}

main()
    .catch((e) => { console.error("[reset-reg] fatal:", e); process.exit(1); })
    .finally(() => prisma.$disconnect());
