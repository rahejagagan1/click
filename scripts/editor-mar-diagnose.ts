/**
 * Mar 2026 editor diagnosis
 */
import prisma from "../src/lib/prisma";

async function main() {
    const monthStart = new Date(Date.UTC(2026, 2, 1));
    const graceEnd   = new Date(Date.UTC(2026, 3, 5, 23, 59, 59)); // ~3 working days into April

    console.log("\n=== 1. All 'Editing - First Draft' subtasks with dateDone in Mar 2026 + grace ===");
    const editSubs = await prisma.subtask.findMany({
        where: {
            name: { contains: "Editing", mode: "insensitive" },
            status: { in: ["done", "complete", "closed"] },
            dateDone: { gte: monthStart, lte: graceEnd },
        },
        select: { caseId: true, name: true, status: true, dateDone: true },
        orderBy: { dateDone: "asc" },
    });
    console.log(`Count: ${editSubs.length}`);
    for (const s of editSubs) {
        console.log(`  case #${String(s.caseId).padStart(4)}  ${s.name.padEnd(26)} ${s.status.padEnd(10)} ${s.dateDone?.toISOString() ?? "NULL"}`);
    }

    console.log("\n=== 2. Cases those subtasks belong to — editor + channel + quality score ===");
    const caseIds = [...new Set(editSubs.map(s => s.caseId))];
    const cases = await prisma.case.findMany({
        where: { id: { in: caseIds } },
        select: {
            id: true, clickupTaskId: true,
            editorUserId: true, editorQualityScore: true,
            channel: true, caseType: true,
            editor: { select: { id: true, name: true } },
            youtubeStats: { select: { viewCount: true, last30DaysViews: true, publishedAt: true } },
        },
    });
    for (const c of cases) {
        const ev = c.youtubeStats?.viewCount ? BigInt(c.youtubeStats.viewCount.toString()).toString() : "—";
        const e30 = c.youtubeStats?.last30DaysViews ? BigInt(c.youtubeStats.last30DaysViews.toString()).toString() : "—";
        console.log(`  case #${c.id}  editor=${c.editor?.name ?? "NONE"} (#${c.editorUserId ?? "—"})  qScore=${c.editorQualityScore ?? "—"}  channel=${c.channel ?? "—"}  views=${ev} / 30d=${e30}`);
    }

    console.log("\n=== 3. Per-editor summary for Mar 2026 ===");
    const byEditor = new Map<number, typeof cases>();
    for (const c of cases) {
        if (!c.editorUserId) continue;
        const bucket = byEditor.get(c.editorUserId) ?? [];
        bucket.push(c);
        byEditor.set(c.editorUserId, bucket);
    }
    for (const [uid, arr] of byEditor) {
        const name = arr[0].editor?.name ?? `#${uid}`;
        const qScores = arr.map(c => c.editorQualityScore).filter((v): v is number => v !== null);
        const qAvg = qScores.length ? qScores.reduce((s, v) => s + v, 0) / qScores.length : null;
        console.log(`  ${name.padEnd(28)}  cases=${arr.length}  qScores=${JSON.stringify(qScores)}  qAvg=${qAvg?.toFixed(1) ?? "—"}`);
    }

    console.log("\n=== 4. Current MonthlyRating rows for Mar 2026 editor role ===");
    const rows = await prisma.monthlyRating.findMany({
        where: { month: monthStart, roleType: "editor" },
        select: {
            userId: true, casesCompleted: true, overallRating: true,
            manualRatingsPending: true, isManualOverride: true,
            user: { select: { name: true } },
        },
    });
    console.log(`Rows: ${rows.length}`);
    for (const r of rows) {
        console.log(`  ${r.user.name?.padEnd(28)}  cases=${r.casesCompleted}  overall=${r.overallRating ?? "—"}  pending=${r.manualRatingsPending}  override=${r.isManualOverride}`);
    }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
