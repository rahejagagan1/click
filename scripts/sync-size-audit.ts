import prisma from "../src/lib/prisma";

async function main() {
    const [
        lists,
        cases,
        subtasks,
        subtasksClosed,
        subtasksClosedNullDone,
        subtasksOpen,
    ] = await Promise.all([
        prisma.productionList.count(),
        prisma.case.count(),
        prisma.subtask.count(),
        prisma.subtask.count({ where: { statusType: "closed" } }),
        prisma.subtask.count({ where: { statusType: "closed", dateDone: null } }),
        prisma.subtask.count({ where: { statusType: { not: "closed" } } }),
    ]);

    // per-list case counts for pagination math
    const perList = await prisma.productionList.findMany({
        select: {
            id: true,
            name: true,
            _count: { select: { cases: true } },
        },
        orderBy: { name: "asc" },
    });

    console.log("=== DB totals ===");
    console.log(`Lists           : ${lists}`);
    console.log(`Cases           : ${cases}`);
    console.log(`Subtasks        : ${subtasks}`);
    console.log(`  ↳ closed      : ${subtasksClosed}`);
    console.log(`  ↳ open        : ${subtasksOpen}`);
    console.log(`  ↳ closed w/ null dateDone : ${subtasksClosedNullDone}`);

    const pagesPerList = perList.map((l) => Math.max(1, Math.ceil(l._count.cases / 100)));
    const totalPages = pagesPerList.reduce((a, b) => a + b, 0);
    console.log(`\nTotal /list/.../task pagination pages (100 per page) : ${totalPages}`);

    console.log("\n=== Per-list case counts ===");
    for (const l of perList) {
        console.log(`  ${String(l._count.cases).padStart(5)}  ${l.name}`);
    }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
