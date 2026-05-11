/**
 * Extract Section 2 data for Manpreet Singh's April 2026 monthly report.
 * Usage: npx tsx scripts/manpreet-apr-monthly.ts
 */
import prisma from "../src/lib/prisma";
import { getMonthlyReportWindow } from "../src/lib/reports/monthly-window";
import { normalizeTeamCapsuleInput, findCapsulesMatchingTeamCapsule } from "../src/lib/capsule-matching";

const MANAGER_ID = 527;
const YEAR       = 2026;
const MONTH      = 2; // 0-based: March

async function main() {
    const { windowStart, windowEnd } = getMonthlyReportWindow(YEAR, MONTH);
    console.log(`\nManpreet Singh — March 2026 Monthly Report`);
    console.log(`Reporting window: ${windowStart.toISOString()} → ${windowEnd.toISOString()}\n`);

    // ── Saved report (if any) ─────────────────────────────────────────────────
    const saved = await prisma.monthlyReport.findUnique({
        where: { managerId_month_year: { managerId: MANAGER_ID, month: MONTH, year: YEAR } },
    });
    console.log(`Saved report: ${saved ? (saved.isLocked ? "LOCKED/submitted" : "draft") : "none"}\n`);

    // ── Total Video Completed + Hero Content ──────────────────────────────────
    // Cases whose Video QA1 subtask was done in the window AND belong to manager's capsule
    const manager = await prisma.user.findUnique({
        where: { id: MANAGER_ID },
        select: { teamCapsule: true, name: true },
    });
    console.log(`Manager: ${manager?.name}  |  teamCapsule: "${manager?.teamCapsule ?? "(none)"}"\n`);

    const tc = normalizeTeamCapsuleInput(manager?.teamCapsule ?? "");
    let listIds: number[] = [];
    if (tc) {
        const byName = await prisma.productionList.findMany({
            where: { name: { equals: tc, mode: "insensitive" } },
            select: { id: true, name: true },
        });
        if (byName.length > 0) {
            listIds = byName.map(l => l.id);
            console.log(`Matched production list(s) by name: ${byName.map(l => `"${l.name}" (id=${l.id})`).join(", ")}`);
        } else {
            const capsules = await findCapsulesMatchingTeamCapsule(tc);
            if (capsules.length > 0) {
                const lists = await prisma.productionList.findMany({
                    where: { capsuleId: { in: capsules.map(c => c.id) } },
                    select: { id: true, name: true },
                });
                listIds = lists.map(l => l.id);
                console.log(`Matched via capsule: ${capsules.map(c => c.name).join(", ")}`);
                console.log(`Production lists: ${lists.map(l => `"${l.name}" (id=${l.id})`).join(", ")}`);
            } else {
                console.log(`WARNING: teamCapsule "${tc}" matched no list or capsule.`);
            }
        }
    } else {
        console.log(`No teamCapsule set — no list filter applied.`);
    }

    // Video QA1 subtasks done in window
    const qa1Subtasks = await prisma.subtask.findMany({
        where: {
            OR: [
                { name: { contains: "Video QA1",   mode: "insensitive" } },
                { name: { contains: "Video QA 1",  mode: "insensitive" } },
            ],
            status: { in: ["done", "complete", "closed"] },
            dateDone: { gte: windowStart, lte: windowEnd },
        },
        select: { caseId: true, name: true, dateDone: true },
    });
    const qa1CaseIds = [...new Set(qa1Subtasks.map(s => s.caseId))];
    console.log(`\nVideo QA1 subtasks done in window: ${qa1Subtasks.length} (across ${qa1CaseIds.length} unique cases)`);

    // Filter by capsule/list
    const caseFilter: any = { id: { in: qa1CaseIds } };
    if (listIds.length > 0) caseFilter.productionListId = { in: listIds };

    const qualifiedCases = await prisma.case.findMany({
        where: caseFilter,
        select: { id: true, name: true, caseType: true, status: true },
        orderBy: { name: "asc" },
    });

    const totalVideo  = qualifiedCases.length;
    const heroCases   = qualifiedCases.filter(c => (c.caseType ?? "").toLowerCase().includes("hero"));
    const heroContent = heroCases.length;

    console.log(`\n═══ SECTION 2A — Production Volume ═══`);
    console.log(`  Total Video Completed (Actual): ${totalVideo}`);
    console.log(`  Hero Content Completed (Actual): ${heroContent}`);

    if (qualifiedCases.length > 0) {
        console.log(`\n  Qualified cases (${totalVideo}):`);
        for (const c of qualifiedCases) {
            const isHero = (c.caseType ?? "").toLowerCase().includes("hero");
            console.log(`    [${isHero ? "HERO" : "    "}] "${c.name}"  status=${c.status}  type=${c.caseType ?? "—"}`);
        }
    }

    // ── Videos Published ──────────────────────────────────────────────────────
    let videosPublished = 0;
    if (listIds.length > 0) {
        const publishedCases = await prisma.case.findMany({
            where: {
                productionListId: { in: listIds },
                youtubeStats: { is: { publishedAt: { gte: windowStart, lte: windowEnd } } },
            },
            select: {
                id: true, name: true,
                youtubeStats: { select: { videoTitle: true, publishedAt: true, viewCount: true } },
            },
            orderBy: { name: "asc" },
        });
        videosPublished = publishedCases.length;
        console.log(`\n  Videos Published (Actual): ${videosPublished}`);
        if (publishedCases.length > 0) {
            console.log(`\n  Published videos (${videosPublished}):`);
            for (const c of publishedCases) {
                const yt = c.youtubeStats;
                console.log(`    "${yt?.videoTitle || c.name}"  publishedAt=${yt?.publishedAt?.toISOString() ?? "—"}  views=${yt?.viewCount ?? "—"}`);
            }
        }
    } else {
        console.log(`\n  Videos Published: N/A (no production list matched)`);
    }

    // ── Saved overrides ───────────────────────────────────────────────────────
    if (saved) {
        console.log(`\n═══ SAVED REPORT OVERRIDES ═══`);
        console.log(`  totalVideoActual:         ${(saved as any).totalVideoActual ?? "—"}  (overridden: ${!!(saved as any).totalVideoActualOverridden})`);
        console.log(`  heroContentActual:        ${(saved as any).heroContentActual ?? "—"}  (overridden: ${!!(saved as any).heroContentActualOverridden})`);
        console.log(`  videosPublishedActual:    ${(saved as any).videosPublishedActual ?? "—"}  (overridden: ${!!(saved as any).videosPublishedActualOverridden})`);
        console.log(`  totalVideoTarget:         ${(saved as any).totalVideoTarget ?? "—"}`);
        console.log(`  heroContentTarget:        ${(saved as any).heroContentTarget ?? "—"}`);
        console.log(`  videosPublishedTarget:    ${(saved as any).videosPublishedTarget ?? "—"}`);
    }

    console.log("");
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
