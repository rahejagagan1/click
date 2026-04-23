/**
 * Delete stale zero-case writer/editor MonthlyRating rows (kept only if admin override).
 */
import prisma from "../src/lib/prisma";

async function main() {
    const before = await prisma.monthlyRating.count({
        where: {
            roleType: { in: ["writer", "editor"] },
            casesCompleted: 0,
            isManualOverride: false,
        },
    });
    console.log(`Stale zero-case rows (writer+editor, not overridden): ${before}`);

    if (before === 0) { console.log("Nothing to delete."); return; }

    const res = await prisma.monthlyRating.deleteMany({
        where: {
            roleType: { in: ["writer", "editor"] },
            casesCompleted: 0,
            isManualOverride: false,
        },
    });
    console.log(`Deleted ${res.count} rows.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
