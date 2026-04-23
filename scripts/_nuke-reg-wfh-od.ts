/**
 * Full-slate reset: wipe every AttendanceRegularization, WFHRequest, and
 * OnDutyRequest row (any status — pending / approved / rejected) plus their
 * notifications. Also clears the isRegularized flag + synthetic clock times
 * on past attendance rows that were filled by an approval.
 *
 * Run:
 *   npx tsx scripts/_nuke-reg-wfh-od.ts
 */
import prisma from "../src/lib/prisma";

async function main() {
    const regs  = await prisma.attendanceRegularization.findMany({ select: { id: true, userId: true, date: true, status: true } });
    const wfhs  = await prisma.wFHRequest.findMany({ select: { id: true, userId: true, date: true, status: true } });
    const ods   = await prisma.onDutyRequest.findMany({ select: { id: true, userId: true, date: true, status: true } });
    console.log(`[nuke] Regularization=${regs.length} | WFH=${wfhs.length} | OnDuty=${ods.length}`);

    if (regs.length > 0) {
        await prisma.notification.deleteMany({ where: { type: "regularization", entityId: { in: regs.map(r => r.id) } } });
    }
    if (wfhs.length > 0) {
        await prisma.notification.deleteMany({ where: { type: "wfh", entityId: { in: wfhs.map(r => r.id) } } });
    }
    if (ods.length > 0) {
        await prisma.notification.deleteMany({ where: { type: "on_duty", entityId: { in: ods.map(r => r.id) } } });
    }

    const dReg = await prisma.attendanceRegularization.deleteMany({});
    const dWfh = await prisma.wFHRequest.deleteMany({});
    const dOd  = await prisma.onDutyRequest.deleteMany({});
    console.log(`[nuke] Deleted: regularization=${dReg.count}, wfh=${dWfh.count}, on-duty=${dOd.count}`);

    // Any attendance row that was regularized ends up with synthetic clock times
    // seeded by the approval path. Reset those back to null so the next round
    // of tests starts clean.
    const reset = await prisma.attendance.updateMany({
        where: { isRegularized: true },
        data:  { isRegularized: false, clockIn: null, clockOut: null, totalMinutes: 0, status: "absent" },
    });
    console.log(`[nuke] Cleared synthetic clock data on ${reset.count} attendance row(s).`);

    console.log("[nuke] Done.");
}

main()
    .catch((e) => { console.error("[nuke] fatal:", e); process.exit(1); })
    .finally(() => prisma.$disconnect());
