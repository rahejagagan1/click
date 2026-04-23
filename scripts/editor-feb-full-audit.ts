/**
 * Full audit: every possible way editor cases can be counted for Feb 2026.
 */
import prisma from "../src/lib/prisma";

async function main() {
    const monthStart = new Date(Date.UTC(2026, 1, 1));
    const monthEnd   = new Date(Date.UTC(2026, 1, 28, 23, 59, 59));
    const graceEnd   = new Date(Date.UTC(2026, 2, 4, 23, 59, 59));

    console.log("\n=== A. Every subtask with dateDone in Feb (+grace) by distinct name ===");
    const allSubsFeb = await prisma.subtask.findMany({
        where: {
            status: { in: ["done", "complete", "closed"] },
            dateDone: { gte: monthStart, lte: graceEnd },
        },
        select: { name: true, caseId: true, status: true, dateDone: true },
    });
    const byName = new Map<string, number>();
    for (const s of allSubsFeb) byName.set(s.name, (byName.get(s.name) ?? 0) + 1);
    for (const [n, c] of [...byName.entries()].sort((a,b) => b[1]-a[1])) {
        console.log(`  ${String(c).padStart(4)}  ${n}`);
    }

    console.log("\n=== B. Monthly calculator match (name contains 'Editing') ===");
    const monthlyMatch = allSubsFeb.filter(s => s.name.toLowerCase().includes("editing"));
    console.log(`  Count: ${monthlyMatch.length}`);

    console.log("\n=== C. Weekly route broader match (edit but not revision/script/re-edit) ===");
    const weeklyMatch = allSubsFeb.filter(s => {
        const n = s.name.toLowerCase();
        return n === "editing" || n === "video editing" ||
               (n.includes("edit") && !n.includes("revision") && !n.includes("script") && !n.includes("re-edit"));
    });
    console.log(`  Count: ${weeklyMatch.length}`);
    const weeklyNames = new Set(weeklyMatch.map(s => s.name));
    console.log(`  Names matched: ${[...weeklyNames].join(", ")}`);

    console.log("\n=== D. Cases with editorUserId set AND ANY subtask done in Feb ===");
    const withAnySubtaskDone = await prisma.case.findMany({
        where: {
            editorUserId: { not: null },
            subtasks: { some: { dateDone: { gte: monthStart, lte: graceEnd } } },
        },
        select: {
            id: true, editorUserId: true,
            editor: { select: { name: true } },
            subtasks: {
                where: { dateDone: { gte: monthStart, lte: graceEnd } },
                select: { name: true, status: true, dateDone: true },
            },
        },
    });
    console.log(`  Cases: ${withAnySubtaskDone.length}`);
    console.log(`  Per-editor case counts:`);
    const perEditor = new Map<string, number>();
    for (const c of withAnySubtaskDone) {
        const key = c.editor?.name ?? `#${c.editorUserId}`;
        perEditor.set(key, (perEditor.get(key) ?? 0) + 1);
    }
    for (const [n, c] of [...perEditor.entries()].sort((a,b) => b[1]-a[1])) {
        console.log(`    ${n.padEnd(28)}  ${c} case(s)`);
    }

    console.log("\n=== E. Total subtasks in DB vs last sync time ===");
    const totalSubtasks = await prisma.subtask.count();
    const totalCases    = await prisma.case.count();
    console.log(`  Cases total: ${totalCases}`);
    console.log(`  Subtasks total: ${totalSubtasks}`);

    const lastSyncs = await prisma.subtask.findMany({
        orderBy: { lastSyncedAt: "desc" },
        take: 3,
        select: { lastSyncedAt: true, name: true, caseId: true },
    });
    console.log(`  Last synced subtasks:`);
    for (const s of lastSyncs) console.log(`    ${s.lastSyncedAt.toISOString()}  case #${s.caseId}  ${s.name}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
