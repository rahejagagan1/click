import prisma from "../src/lib/prisma";
(async () => {
    const rows = await prisma.wFHRequest.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, userId: true, date: true, status: true, reason: true, createdAt: true },
    });
    console.log(`[wfh] ${rows.length} most-recent WFH row(s):`);
    for (const r of rows) {
        console.log(`  - id=${r.id} userId=${r.userId} date=${r.date.toISOString().slice(0, 10)} status=${r.status} reason="${(r.reason ?? "").slice(0, 60)}"`);
    }
    await prisma.$disconnect();
})();
