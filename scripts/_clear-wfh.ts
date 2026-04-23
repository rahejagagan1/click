import prisma from "../src/lib/prisma";
(async () => {
    const rows = await prisma.wFHRequest.findMany({ select: { id: true, userId: true, date: true, status: true } });
    console.log(`[clear-wfh] ${rows.length} WFH row(s) to delete:`);
    for (const r of rows) console.log(`  - id=${r.id} userId=${r.userId} date=${r.date.toISOString().slice(0, 10)} status=${r.status}`);

    if (rows.length > 0) {
        const ids = rows.map((r) => r.id);
        const n = await prisma.notification.deleteMany({ where: { type: "wfh", entityId: { in: ids } } });
        console.log(`[clear-wfh] Deleted ${n.count} WFH notification(s).`);
    }
    const d = await prisma.wFHRequest.deleteMany({});
    console.log(`[clear-wfh] Deleted ${d.count} WFH row(s). Done.`);
    await prisma.$disconnect();
})();
