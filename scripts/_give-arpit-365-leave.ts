/**
 * Give Arpit 365 days balance for EVERY active leave type, current year.
 * Use this for testing so leave submission never fails on insufficient balance.
 *
 * Run:
 *   npx tsx scripts/_give-arpit-365-leave.ts
 */
import prisma from "../src/lib/prisma";

async function main() {
    const year = new Date().getFullYear();

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
        console.error("[365] No user found matching 'Arpit'. Aborting.");
        process.exit(1);
    }
    console.log(`[365] Target: id=${user.id} "${user.name}" <${user.email}>`);

    const leaveTypes = await prisma.leaveType.findMany({
        where:  { isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: { name: "asc" },
    });
    console.log(`[365] Found ${leaveTypes.length} active leave type(s).`);

    for (const lt of leaveTypes) {
        const row = await prisma.leaveBalance.upsert({
            where: { userId_leaveTypeId_year: { userId: user.id, leaveTypeId: lt.id, year } },
            create: { userId: user.id, leaveTypeId: lt.id, year, totalDays: 365, usedDays: 0, pendingDays: 0 },
            update: { totalDays: 365 },
        });
        console.log(`  + ${lt.name.padEnd(24)} (${lt.code}) → totalDays=${row.totalDays} used=${row.usedDays} pending=${row.pendingDays}`);
    }
    console.log(`[365] Done for year=${year}.`);
}

main()
    .catch((e) => { console.error("[365] fatal:", e); process.exit(1); })
    .finally(() => prisma.$disconnect());
