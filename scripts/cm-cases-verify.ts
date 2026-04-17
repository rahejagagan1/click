/**
 * One-off: list CM-qualified cases + CM Check4 / CM Check 4 done dates for a user/month.
 * Usage: npx tsx scripts/cm-cases-verify.ts [userNameSubstring] [YYYY-MM]
 * Defaults: "Tanya", "2026-02"
 */
import prisma from "../src/lib/prisma";
import { getQualifiedCasesForRole } from "../src/lib/ratings/data-resolver";

async function main() {
    const nameQ = process.argv[2] ?? "Tanya";
    const period = process.argv[3] ?? "2026-02";
    const [y, m] = period.split("-").map(Number);
    if (!y || !m) {
        console.error("Bad period, use YYYY-MM");
        process.exit(1);
    }

    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const monthEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59));

    const user = await prisma.user.findFirst({
        where: {
            role: "production_manager",
            name: { contains: nameQ, mode: "insensitive" },
        },
        select: { id: true, name: true, email: true, teamCapsule: true },
    });

    if (!user) {
        console.error(`No production_manager found matching name containing "${nameQ}"`);
        process.exit(1);
    }

    console.log("User:", user.name, `(id ${user.id})`, user.email);
    console.log("teamCapsule:", user.teamCapsule ?? "(empty — no list filter)");
    console.log("Period:", period, "UTC range", monthStart.toISOString(), "→", monthEnd.toISOString());
    console.log("");

    const cases = await getQualifiedCasesForRole(monthStart, monthEnd, "production_manager", user.id);
    console.log("Qualified case count (same as cm pipeline):", cases.length);
    console.log("");

    if (cases.length === 0) {
        await prisma.$disconnect();
        return;
    }

    const ids = cases.map((c) => c.id);
    const rows = await prisma.case.findMany({
        where: { id: { in: ids } },
        select: {
            id: true,
            name: true,
            clickupUrl: true,
            productionList: { select: { name: true, capsule: { select: { name: true } } } },
        },
        orderBy: { name: "asc" },
    });

    const cmSubs = await prisma.subtask.findMany({
        where: {
            caseId: { in: ids },
            OR: [
                { name: { contains: "CM Check 4", mode: "insensitive" } },
                { name: { contains: "CM Check4", mode: "insensitive" } },
            ],
            status: { in: ["done", "complete", "closed"] },
        },
        select: { caseId: true, name: true, dateDone: true, status: true },
    });

    const subByCase = new Map<number, (typeof cmSubs)[0]>();
    for (const s of cmSubs) {
        const prev = subByCase.get(s.caseId);
        if (!prev || (s.dateDone && (!prev.dateDone || s.dateDone > prev.dateDone))) {
            subByCase.set(s.caseId, s);
        }
    }

    let i = 1;
    for (const c of rows) {
        const st = subByCase.get(c.id);
        const done = st?.dateDone ? st.dateDone.toISOString() : "—";
        const subName = st?.name ?? "—";
        const list = c.productionList?.name ?? "—";
        const cap = c.productionList?.capsule?.name ?? "—";
        console.log(
            `${String(i++).padStart(2)}. [${c.id}] ${c.name}\n` +
                `    CM subtask: "${subName}" | dateDone (UTC): ${done} | status: ${st?.status ?? "—"}\n` +
                `    List: ${list} | Capsule: ${cap}\n` +
                `    URL: ${c.clickupUrl ?? "—"}`,
        );
    }

    await prisma.$disconnect();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
