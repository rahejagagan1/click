/**
 * Give Arpit Sharma (or any user matched by email substring) a 2-day
 * Sick Leave balance for the current year. Idempotent — reruns just reset
 * the totalDays back to 2, don't duplicate rows.
 *
 * Run:
 *   npx tsx scripts/_set-sick-leave-balance.ts
 */
import prisma from "../src/lib/prisma";

async function main() {
    const year = new Date().getFullYear();

    // Find Arpit Sharma. Match on name fragment — adjust if there are multiple.
    const user = await prisma.user.findFirst({
        where: {
            isActive: true,
            OR: [
                { name:  { contains: "Arpit", mode: "insensitive" } },
                { email: { contains: "arpit", mode: "insensitive" } },
            ],
        },
        select: { id: true, name: true, email: true },
    });
    if (!user) {
        console.error("[balance] No user found matching 'Arpit'. Aborting.");
        process.exit(1);
    }
    console.log(`[balance] Target user: id=${user.id} name="${user.name}" email="${user.email}"`);

    // Resolve the Sick Leave type. Match on name or code "SL".
    const sickLeaveType = await prisma.leaveType.findFirst({
        where: {
            isActive: true,
            OR: [
                { name: { contains: "sick",   mode: "insensitive" } },
                { code: { equals:   "SL",     mode: "insensitive" } },
            ],
        },
        select: { id: true, name: true, code: true },
    });
    if (!sickLeaveType) {
        console.error('[balance] No Sick Leave type found. Create one first (name: "Sick Leave", code: "SL").');
        process.exit(1);
    }
    console.log(`[balance] Sick leave type: id=${sickLeaveType.id} name="${sickLeaveType.name}" code="${sickLeaveType.code}"`);

    const row = await prisma.leaveBalance.upsert({
        where: { userId_leaveTypeId_year: { userId: user.id, leaveTypeId: sickLeaveType.id, year } },
        create: { userId: user.id, leaveTypeId: sickLeaveType.id, year, totalDays: 2, usedDays: 0, pendingDays: 0 },
        update: { totalDays: 2 },
    });
    console.log(`[balance] LeaveBalance id=${row.id} set to totalDays=${row.totalDays} for year=${year}. Used=${row.usedDays}, Pending=${row.pendingDays}.`);
    console.log("[balance] Done.");
}

main()
    .catch((e) => { console.error("[balance] fatal:", e); process.exit(1); })
    .finally(() => prisma.$disconnect());
