/**
 * Destructive: delete ALL MonthlyRating rows for writer + editor, every month.
 * Usage: npx tsx scripts/delete-writer-editor-ratings.ts
 */
import prisma from "../src/lib/prisma";

async function main() {
    const before = await prisma.monthlyRating.groupBy({
        by: ["roleType"],
        _count: { _all: true },
        where: { roleType: { in: ["writer", "editor"] } },
    });

    console.log("\nBefore delete:");
    for (const r of before) console.log(`  ${r.roleType.padEnd(10)} ${r._count._all} rows`);
    const total = before.reduce((s, r) => s + r._count._all, 0);
    console.log(`  TOTAL      ${total} rows\n`);

    if (total === 0) {
        console.log("Nothing to delete.");
        return;
    }

    const result = await prisma.monthlyRating.deleteMany({
        where: { roleType: { in: ["writer", "editor"] } },
    });
    console.log(`Deleted ${result.count} MonthlyRating rows (writer + editor, all months).`);

    const after = await prisma.monthlyRating.count({
        where: { roleType: { in: ["writer", "editor"] } },
    });
    console.log(`Remaining writer/editor rows: ${after}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
