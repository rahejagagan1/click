/**
 * Deeper diagnose: what subtask names actually exist on Feb editor cases?
 */
import prisma from "../src/lib/prisma";

async function main() {
    const monthStart = new Date(Date.UTC(2026, 1, 1));
    const graceEnd   = new Date(Date.UTC(2026, 2, 4, 23, 59, 59)); // ~3 working days into March

    console.log("\n=== 1. All distinct subtask names containing 'edit' (any case) ===");
    const editSubs = await prisma.subtask.findMany({
        where: { name: { contains: "edit", mode: "insensitive" } },
        select: { name: true, status: true, dateDone: true },
    });
    const nameCounts = new Map<string, number>();
    for (const s of editSubs) nameCounts.set(s.name, (nameCounts.get(s.name) ?? 0) + 1);
    for (const [n, c] of [...nameCounts.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(c).padStart(4)}  ${n}`);
    }

    console.log(`\nTotal subtasks with 'edit' in name: ${editSubs.length}`);
    const withDateDoneInFeb = editSubs.filter(s =>
        s.dateDone && s.dateDone >= monthStart && s.dateDone <= graceEnd
    ).length;
    console.log(`  — with dateDone in Feb+grace (Feb 1 → Mar 4): ${withDateDoneInFeb}`);

    console.log("\n=== 2. For 28 cases with editor + Feb completion: what subtasks do they have? ===");
    const editorCases = await prisma.case.findMany({
        where: {
            editorUserId: { not: null },
            OR: [
                { caseCompletionDate: { gte: monthStart, lte: new Date(Date.UTC(2026, 2, 31, 23, 59, 59)) } },
                { dateDone: { gte: monthStart, lte: new Date(Date.UTC(2026, 2, 31, 23, 59, 59)) } },
            ],
        },
        select: {
            id: true,
            editorUserId: true,
            subtasks: { select: { name: true, status: true, dateDone: true } },
        },
    });

    const subtaskNameCount = new Map<string, number>();
    const casesWithEditing: number[] = [];
    const casesWithoutEditing: number[] = [];
    for (const c of editorCases) {
        let hasEditing = false;
        for (const s of c.subtasks) {
            subtaskNameCount.set(s.name, (subtaskNameCount.get(s.name) ?? 0) + 1);
            if (s.name.toLowerCase().includes("editing")) hasEditing = true;
        }
        if (hasEditing) casesWithEditing.push(c.id);
        else casesWithoutEditing.push(c.id);
    }

    console.log("\nDistinct subtask names across those 28 cases (ranked by frequency):");
    for (const [n, c] of [...subtaskNameCount.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(c).padStart(4)}  ${n}`);
    }

    console.log(`\nCases WITH any 'Editing' subtask: ${casesWithEditing.length}  (IDs: ${casesWithEditing.join(", ")})`);
    console.log(`Cases WITHOUT any 'Editing' subtask: ${casesWithoutEditing.length}  (IDs: ${casesWithoutEditing.slice(0,15).join(", ")}${casesWithoutEditing.length>15?"...":""})`);

    console.log("\n=== 3. Of the 'Editing' subtasks that do exist on these cases — their statuses + dateDone ===");
    const editingSubsOnCases = await prisma.subtask.findMany({
        where: {
            caseId: { in: casesWithEditing },
            name: { contains: "editing", mode: "insensitive" },
        },
        select: { caseId: true, name: true, status: true, dateDone: true },
    });
    for (const s of editingSubsOnCases) {
        console.log(`  case #${String(s.caseId).padStart(4)}  ${s.name.padEnd(30)} [${s.status.padEnd(10)}] dateDone=${s.dateDone?.toISOString() ?? "NULL"}`);
    }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
