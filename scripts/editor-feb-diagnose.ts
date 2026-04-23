/**
 * Diagnose: why does Feb 2026 editor case count seem low?
 * Shows subtasks named "Editing" in Feb across all statuses + date fields.
 */
import prisma from "../src/lib/prisma";

async function main() {
    const monthStart = new Date(Date.UTC(2026, 1, 1));
    const monthEnd   = new Date(Date.UTC(2026, 2, 31, 23, 59, 59)); // include March grace window

    console.log("\n=== 1. ALL Editing subtasks touched between Feb 1 and Mar 31, 2026 ===");
    const all = await prisma.subtask.findMany({
        where: {
            name: { contains: "Editing", mode: "insensitive" },
            OR: [
                { dateDone: { gte: monthStart, lte: monthEnd } },
                { startDate: { gte: monthStart, lte: monthEnd } },
                { dueDate: { gte: monthStart, lte: monthEnd } },
            ],
        },
        select: { id: true, name: true, status: true, dateDone: true, startDate: true, dueDate: true, caseId: true },
        orderBy: { dateDone: "desc" },
    });
    console.log(`Total touched: ${all.length}`);

    const statusCounts = new Map<string, number>();
    for (const s of all) statusCounts.set(s.status, (statusCounts.get(s.status) ?? 0) + 1);
    console.log("By status:", Object.fromEntries(statusCounts));

    console.log("\n=== 2. Editing subtasks with status in done/complete/closed, dateDone in Feb ===");
    const done = await prisma.subtask.findMany({
        where: {
            name: { contains: "Editing", mode: "insensitive" },
            status: { in: ["done", "complete", "closed"] },
            dateDone: { gte: monthStart, lte: monthEnd },
        },
        select: { caseId: true, status: true, dateDone: true, name: true },
    });
    console.log(`Done: ${done.length}`);
    const uniq = new Set(done.map(s => s.caseId));
    console.log(`Unique case IDs: ${uniq.size}`);

    console.log("\n=== 3. Same but dateDone NULL — status done but no done date ===");
    const doneNoDate = await prisma.subtask.findMany({
        where: {
            name: { contains: "Editing", mode: "insensitive" },
            status: { in: ["done", "complete", "closed"] },
            dateDone: null,
        },
        select: { caseId: true, status: true, name: true },
    });
    console.log(`Done-but-no-dateDone: ${doneNoDate.length} subtasks`);

    console.log("\n=== 4. Cases with editorUserId set, completed in Feb window (any way) ===");
    const editorCases = await prisma.case.findMany({
        where: {
            editorUserId: { not: null },
            OR: [
                { caseCompletionDate: { gte: monthStart, lte: monthEnd } },
                { dateDone: { gte: monthStart, lte: monthEnd } },
            ],
        },
        select: { id: true, clickupTaskId: true, editorUserId: true, status: true, caseCompletionDate: true, dateDone: true },
    });
    console.log(`Cases assigned to an editor w/ completion date in Feb: ${editorCases.length}`);

    console.log("\n=== 5. Feb: all subtasks for a sample of those cases ===");
    const sampleCaseIds = editorCases.slice(0, 5).map(c => c.id);
    for (const cid of sampleCaseIds) {
        const subs = await prisma.subtask.findMany({
            where: { caseId: cid },
            select: { name: true, status: true, dateDone: true },
            orderBy: { id: "asc" },
        });
        console.log(`\n  Case #${cid}:`);
        for (const s of subs) {
            console.log(`    - ${s.name.padEnd(30)} [${s.status}] done=${s.dateDone?.toISOString() ?? "—"}`);
        }
    }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
