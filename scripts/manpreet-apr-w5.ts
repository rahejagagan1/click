/**
 * Extract writer & editor cases for Manpreet Singh's April Week 5 report.
 * Period: Mon Apr 27 – Sun May 3, 2026
 *
 * Usage: npx tsx scripts/manpreet-apr-w5.ts
 */
import prisma from "../src/lib/prisma";
import { getWeeklyReportPeriod } from "../src/lib/reports/weekly-period";
import { isWriterFirstDraftMilestone } from "../src/lib/clickup/subtask-milestones";

// April 2026, week 5 — month is 0-based index (3 = April)
const YEAR  = 2026;
const MONTH = 3;   // April (0-based)
const WEEK  = 5;

function isRevisionSubtask(name: string): boolean {
    const n = name.toLowerCase();
    return (n.includes("script") && n.includes("revision")) || n.startsWith("revision");
}

function isEditingSubtask(name: string): boolean {
    const n = name.toLowerCase();
    return (
        n === "editing" ||
        n === "video editing" ||
        (n.includes("edit") && !n.includes("revision") && !n.includes("script") && !n.includes("re-edit"))
    );
}

function isEditingRevisionSubtask(name: string): boolean {
    const n = name.toLowerCase();
    return (
        (n.includes("edit") && n.includes("revision")) ||
        n.includes("re-edit") ||
        n === "editing revision" ||
        n.includes("video revision")
    );
}

async function main() {
    const period = getWeeklyReportPeriod(YEAR, MONTH, WEEK);
    if (!period) {
        console.error(`No period found for ${YEAR}/Apr week ${WEEK}`);
        return;
    }
    const { weekStart, weekEnd } = period;
    console.log(`\nManpreet Singh — April Week ${WEEK} report`);
    console.log(`Period: ${weekStart.toDateString()} – ${weekEnd.toDateString()}\n`);

    const manager = await prisma.user.findUnique({
        where: { id: 527 },
        include: {
            teamMembers: {
                where: { isActive: true },
                select: { id: true, name: true, role: true },
            },
        },
    });
    if (!manager) { console.error("Manager id=527 not found."); return; }

    const writers   = manager.teamMembers.filter(m => m.role === "writer");
    const editors   = manager.teamMembers.filter(m => m.role === "editor");
    const writerIds = writers.map(w => w.id);
    const editorIds = editors.map(e => e.id);

    console.log(`Team — Writers: ${writers.map(w => w.name).join(", ") || "(none)"}`);
    console.log(`Team — Editors: ${editors.map(e => e.name).join(", ") || "(none)"}\n`);

    // ── SECTION A1: Writer Cases ──────────────────────────────────────────────
    console.log("═══ SECTION A1 — Writer Cases ═══");
    if (writerIds.length === 0) {
        console.log("  No writers.\n");
    } else {
        const writerCases = await prisma.case.findMany({
            where: {
                writerUserId: { in: writerIds },
                subtasks: { some: { dateDone: { gte: weekStart, lte: weekEnd } } },
            },
            include: {
                writer: { select: { id: true, name: true } },
                subtasks: { orderBy: [{ orderIndex: "asc" }, { dateCreated: "asc" }] },
            },
            orderBy: { dateCreated: "asc" },
        });

        const filtered = writerCases.filter(c => {
            const fd  = c.subtasks.find(s => isWriterFirstDraftMilestone(s.name));
            const rev = c.subtasks.find(s => isRevisionSubtask(s.name));
            const fdIn  = fd?.dateDone  != null && fd.dateDone  >= weekStart && fd.dateDone  <= weekEnd;
            const revIn = rev?.dateDone != null && rev.dateDone >= weekStart && rev.dateDone <= weekEnd;
            return fdIn || revIn;
        });

        console.log(`  ${filtered.length} case(s) matched.\n`);
        for (const c of filtered) {
            const fd  = c.subtasks.find(s => isWriterFirstDraftMilestone(s.name));
            const rev = c.subtasks.find(s => isRevisionSubtask(s.name));
            const isHero = !!(c.caseType?.toLowerCase().includes("hero") || c.name?.toLowerCase().includes("hero"));
            console.log(`  [${c.writer?.name ?? "?"}]  "${c.name}"`);
            console.log(`    status=${c.status}  hero=${isHero ? "yes" : "no"}  clickup=${c.clickupTaskId ?? "—"}`);
            if (fd) {
                const inWeek = fd.dateDone && fd.dateDone >= weekStart && fd.dateDone <= weekEnd;
                console.log(`    First Draft:  done=${fd.dateDone?.toISOString() ?? "—"}${inWeek ? " ✓ IN WEEK" : ""}`);
            }
            if (rev) {
                const inWeek = rev.dateDone && rev.dateDone >= weekStart && rev.dateDone <= weekEnd;
                console.log(`    Revision:     done=${rev.dateDone?.toISOString() ?? "—"}${inWeek ? " ✓ IN WEEK" : ""}`);
            }
            if (c.writerQualityScore != null) console.log(`    Quality score: ${c.writerQualityScore}`);
            console.log("");
        }
    }

    // ── SECTION A2: Editor Cases ──────────────────────────────────────────────
    console.log("═══ SECTION A2 — Editor Cases ═══");
    if (editorIds.length === 0) {
        console.log("  No editors.\n");
    } else {
        const editorCases = await prisma.case.findMany({
            where: {
                editorUserId: { in: editorIds },
                subtasks: { some: { dateDone: { gte: weekStart, lte: weekEnd } } },
            },
            include: {
                editor: { select: { id: true, name: true } },
                subtasks: { orderBy: [{ orderIndex: "asc" }, { dateCreated: "asc" }] },
            },
            orderBy: { dateCreated: "asc" },
        });

        const filtered = editorCases.filter(c => {
            const ed  = c.subtasks.find(s => isEditingSubtask(s.name));
            const rev = c.subtasks.find(s => isEditingRevisionSubtask(s.name));
            const edIn  = ed?.dateDone  != null && ed.dateDone  >= weekStart && ed.dateDone  <= weekEnd;
            const revIn = rev?.dateDone != null && rev.dateDone >= weekStart && rev.dateDone <= weekEnd;
            return edIn || revIn;
        });

        console.log(`  ${filtered.length} case(s) matched.\n`);
        for (const c of filtered) {
            const ed  = c.subtasks.find(s => isEditingSubtask(s.name));
            const rev = c.subtasks.find(s => isEditingRevisionSubtask(s.name));
            const isHero = !!(c.caseType?.toLowerCase().includes("hero") || c.name?.toLowerCase().includes("hero"));
            console.log(`  [${c.editor?.name ?? "?"}]  "${c.name}"`);
            console.log(`    status=${c.status}  hero=${isHero ? "yes" : "no"}  clickup=${c.clickupTaskId ?? "—"}`);
            if (ed) {
                const inWeek = ed.dateDone && ed.dateDone >= weekStart && ed.dateDone <= weekEnd;
                console.log(`    Editing:      done=${ed.dateDone?.toISOString() ?? "—"}${inWeek ? " ✓ IN WEEK" : ""}`);
            }
            if (rev) {
                const inWeek = rev.dateDone && rev.dateDone >= weekStart && rev.dateDone <= weekEnd;
                console.log(`    Edit Revision:done=${rev.dateDone?.toISOString() ?? "—"}${inWeek ? " ✓ IN WEEK" : ""}`);
            }
            if ((c as any).editorQualityScore != null) console.log(`    Quality score: ${(c as any).editorQualityScore}`);
            console.log("");
        }
    }
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
