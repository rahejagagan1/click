/**
 * One-off: show every editor's Feb 2026 Monthly Targets autopick.
 * Usage: npx tsx scripts/editor-feb-targets.ts
 */
import prisma from "../src/lib/prisma";
import { getQualifiedCasesForRole } from "../src/lib/ratings/data-resolver";
import {
    getEditorQualityBrackets,
    getEditorMonthlyTargetsMatrix,
} from "../src/lib/ratings/editor-calculator";
import { computeMonthlyTargetsScore } from "../src/lib/ratings/writer-calculator";

function customRound(v: number) {
    if (v === 0) return 0;
    const d = v - Math.floor(v);
    return d > 0.5 ? Math.ceil(v) : Math.floor(v);
}
function valueToStars(v: number, brackets: { min: number; max: number; stars: number }[]) {
    for (const b of brackets) if (v >= b.min && v <= b.max) return b.stars;
    if (v <= (brackets[0]?.min ?? 0)) return 1;
    return 5;
}

async function main() {
    const monthStart = new Date(Date.UTC(2026, 1, 1));                    // Feb 1 2026 UTC
    const monthEnd   = new Date(Date.UTC(2026, 2, 0, 23, 59, 59));        // Feb 28 2026

    const [editors, qualityBrackets, targetsMatrix, allCases] = await Promise.all([
        prisma.user.findMany({
            where: { role: "editor", isActive: true },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
        }),
        getEditorQualityBrackets(),
        getEditorMonthlyTargetsMatrix(),
        getQualifiedCasesForRole(monthStart, monthEnd, "editor"),
    ]);

    // bucket cases per editor
    const byEditor = new Map<number, typeof allCases>();
    for (const c of allCases) {
        const uid = (c as any).editorUserId as number | null;
        if (!uid) continue;
        const bucket = byEditor.get(uid) ?? [];
        bucket.push(c);
        byEditor.set(uid, bucket);
    }

    console.log("\nFeb 2026 — Editor Monthly Targets (autopick)");
    console.log("─".repeat(100));
    console.log(
        "Name".padEnd(28) +
        "Cases".padStart(7) +
        "  Q.Avg".padStart(10) +
        "  Q★".padStart(6) +
        "  Target★".padStart(10) +
        "   Details"
    );
    console.log("─".repeat(100));

    const rows: { name: string; cases: number; qAvg: number | null; qStars: number | null; tgt: number | null }[] = [];

    for (const e of editors) {
        const cases = byEditor.get(e.id) ?? [];
        const qs    = cases.map((c: any) => c.editorQualityScore).filter((v: any): v is number => v !== null);
        const qAvg  = qs.length ? qs.reduce((s, v) => s + v, 0) / qs.length : null;
        const qStars = qAvg !== null ? valueToStars(customRound(qAvg), qualityBrackets) : null;
        const tgt   = computeMonthlyTargetsScore(cases.length, qStars, targetsMatrix);

        rows.push({ name: e.name ?? `#${e.id}`, cases: cases.length, qAvg, qStars, tgt });
    }

    // print sorted: biggest target stars first, then most cases
    rows.sort((a, b) => (b.tgt ?? -1) - (a.tgt ?? -1) || b.cases - a.cases || a.name.localeCompare(b.name));

    for (const r of rows) {
        const details =
            r.cases <= 1 ? "≤1 case → 0★"
            : r.qStars === null ? "pending quality score"
            : `${r.cases} cases × ${r.qStars}★ quality`;
        console.log(
            r.name.padEnd(28) +
            String(r.cases).padStart(7) +
            (r.qAvg !== null ? r.qAvg.toFixed(1) : "—").padStart(10) +
            (r.qStars !== null ? `${r.qStars}★` : "—").padStart(6) +
            (r.tgt !== null ? `${r.tgt}★` : "—").padStart(10) +
            "   " + details
        );
    }

    const withCases = rows.filter(r => r.cases > 0).length;
    console.log("─".repeat(100));
    console.log(`${rows.length} active editors — ${withCases} with cases in Feb 2026.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
