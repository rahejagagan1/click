/**
 * Do the 44 editor-active cases have an Editing - First Draft subtask at all?
 */
import prisma from "../src/lib/prisma";

async function main() {
    const monthStart = new Date(Date.UTC(2026, 1, 1));
    const graceEnd   = new Date(Date.UTC(2026, 2, 4, 23, 59, 59));

    const cases = await prisma.case.findMany({
        where: {
            editorUserId: { not: null },
            subtasks: { some: { dateDone: { gte: monthStart, lte: graceEnd } } },
        },
        select: {
            id: true,
            editor: { select: { name: true } },
            subtasks: { select: { name: true, status: true, dateDone: true } },
        },
    });

    console.log(`Total cases: ${cases.length}\n`);

    let hasEditingSubtask = 0;
    let hasEditingDone = 0;
    let noEditingSubtask = 0;
    const missingFromEditor = new Map<string, number>();

    for (const c of cases) {
        const editSubs = c.subtasks.filter(s => s.name.toLowerCase().includes("editing"));
        const editDone = editSubs.some(s => ["done","complete","closed"].includes(s.status) && s.dateDone);
        if (editSubs.length > 0) {
            hasEditingSubtask++;
            if (editDone) hasEditingDone++;
        } else {
            noEditingSubtask++;
            const k = c.editor?.name ?? "?";
            missingFromEditor.set(k, (missingFromEditor.get(k) ?? 0) + 1);
        }
    }

    console.log(`Cases that HAVE any 'editing' subtask (any status): ${hasEditingSubtask}`);
    console.log(`   — of which marked done with dateDone: ${hasEditingDone}`);
    console.log(`Cases that have NO 'editing' subtask at all: ${noEditingSubtask}\n`);

    console.log("Cases missing the Editing subtask, grouped by editor:");
    for (const [k, v] of [...missingFromEditor.entries()].sort((a,b)=>b[1]-a[1])) {
        console.log(`  ${k.padEnd(28)}  ${v} cases`);
    }

    console.log("\n=== What's the latest sync timestamp per subtask name? ===");
    const subtaskFreshness = await prisma.subtask.groupBy({
        by: ["name"],
        _max: { lastSyncedAt: true },
        _count: { _all: true },
    });
    for (const g of subtaskFreshness.sort((a, b) => (b._max.lastSyncedAt?.getTime() ?? 0) - (a._max.lastSyncedAt?.getTime() ?? 0))) {
        console.log(`  ${g.name.padEnd(30)} count=${String(g._count._all).padStart(4)}  last_sync=${g._max.lastSyncedAt?.toISOString() ?? "—"}`);
    }

    console.log("\n=== Pick one case missing an Editing subtask, show its full subtask list ===");
    const sample = cases.find(c => !c.subtasks.some(s => s.name.toLowerCase().includes("editing")));
    if (sample) {
        console.log(`Case #${sample.id} — editor: ${sample.editor?.name}`);
        console.log(`ClickUp URL needs manual check — here's all synced subtasks:`);
        for (const s of sample.subtasks.sort((a,b) => (a.dateDone?.getTime() ?? 0) - (b.dateDone?.getTime() ?? 0))) {
            console.log(`  ${s.name.padEnd(32)} [${s.status.padEnd(10)}] done=${s.dateDone?.toISOString() ?? "—"}`);
        }
    }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
