/**
 * All cases assigned to Rahul Mehra as editor — active in Mar 2026.
 */
import prisma from "../src/lib/prisma";

async function main() {
    const monthStart = new Date(Date.UTC(2026, 2, 1));
    const graceEnd   = new Date(Date.UTC(2026, 3, 5, 23, 59, 59));

    const rahul = await prisma.user.findFirst({
        where: { name: { contains: "Rahul Mehra", mode: "insensitive" }, role: "editor" },
        select: { id: true, name: true },
    });
    if (!rahul) { console.log("Rahul Mehra editor not found."); return; }
    console.log(`\nEditor: ${rahul.name} (#${rahul.id})`);

    const cases = await prisma.case.findMany({
        where: {
            editorUserId: rahul.id,
            OR: [
                { subtasks: { some: { dateDone: { gte: monthStart, lte: graceEnd } } } },
                { dateDone: { gte: monthStart, lte: graceEnd } },
                { caseCompletionDate: { gte: monthStart, lte: graceEnd } },
            ],
        },
        include: {
            subtasks: {
                select: { name: true, status: true, dateDone: true },
                orderBy: { dateDone: "asc" },
            },
        },
        orderBy: { id: "asc" },
    });

    console.log(`Cases active in Mar 2026 window: ${cases.length}\n`);

    for (const c of cases) {
        console.log(`── Case #${c.id}  "${c.name ?? "?"}"  clickup=${c.clickupTaskId}`);
        console.log(`   status=${c.status}  clickupUrl=${c.clickupUrl ?? "—"}`);
        if (c.subtasks.length === 0) {
            console.log("   (no subtasks synced)");
        } else {
            for (const s of c.subtasks) {
                const tag = s.name.toLowerCase().includes("editing") ? "  ← EDITING" : "";
                console.log(`   ${s.name.padEnd(28)} [${s.status.padEnd(10)}] done=${s.dateDone?.toISOString() ?? "—"}${tag}`);
            }
        }
        console.log("");
    }

    // Also show which cases have editor=Rahul regardless of Mar activity
    const total = await prisma.case.count({ where: { editorUserId: rahul.id } });
    console.log(`Total lifetime cases assigned to Rahul: ${total}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
