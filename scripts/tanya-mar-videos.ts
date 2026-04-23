/**
 * All videos published in March 2026 under production manager Tanya's capsule,
 * ranked by first-30-day views (falls back to lifetime viewCount when null).
 */
import prisma from "../src/lib/prisma";
import {
    normalizeTeamCapsuleInput,
    findCapsulesMatchingTeamCapsule,
} from "../src/lib/capsule-matching";

async function main() {
    const monthStart = new Date(Date.UTC(2026, 1, 1));
    const monthEnd   = new Date(Date.UTC(2026, 1, 28, 23, 59, 59, 999));

    const tanya = await prisma.user.findFirst({
        where: {
            name: { contains: "Tanya", mode: "insensitive" },
            role: "production_manager",
        },
        select: { id: true, name: true, teamCapsule: true },
    });
    if (!tanya) { console.log("Tanya (production_manager) not found."); return; }

    console.log(`\nPM: ${tanya.name} (#${tanya.id})  teamCapsule="${tanya.teamCapsule ?? ""}"`);

    const tc = normalizeTeamCapsuleInput(tanya.teamCapsule ?? "");
    if (!tc) { console.log("No teamCapsule on record — cannot resolve lists."); return; }

    let listIds: number[] = [];
    const byList = await prisma.productionList.findMany({
        where: { name: { equals: tc, mode: "insensitive" } },
        select: { id: true, name: true },
    });
    if (byList.length > 0) {
        listIds = byList.map((l) => l.id);
        console.log(`Matched ${byList.length} production list(s) by name: ${byList.map(l => l.name).join(", ")}`);
    } else {
        const caps = await findCapsulesMatchingTeamCapsule(tc);
        if (caps.length > 0) {
            const lists = await prisma.productionList.findMany({
                where: { capsuleId: { in: caps.map((c) => c.id) } },
                select: { id: true, name: true, capsule: { select: { name: true } } },
            });
            listIds = lists.map((l) => l.id);
            console.log(`Matched capsule(s): ${caps.map(c => c.name).join(", ")}  → ${lists.length} list(s)`);
        }
    }

    if (listIds.length === 0) { console.log("No production lists matched — 0 cases."); return; }

    const cases = await prisma.case.findMany({
        where: {
            productionListId: { in: listIds },
            youtubeStats: {
                is: { publishedAt: { gte: monthStart, lte: monthEnd } },
            },
        },
        select: {
            id: true,
            name: true,
            channel: true,
            clickupUrl: true,
            productionList: { select: { name: true, capsule: { select: { name: true } } } },
            youtubeStats: {
                select: {
                    videoTitle: true,
                    videoUrl: true,
                    viewCount: true,
                    last30DaysViews: true,
                    publishedAt: true,
                },
            },
        },
    });

    console.log(`\nCases with videos published in Mar 2026: ${cases.length}\n`);

    const rows = cases.map((c) => {
        const yt = c.youtubeStats!;
        const f30  = yt.last30DaysViews != null ? BigInt(yt.last30DaysViews.toString()) : null;
        const life = yt.viewCount != null ? BigInt(yt.viewCount.toString()) : BigInt(0);
        const ranked = f30 != null && f30 > BigInt(0) ? f30 : life;
        return {
            id: c.id,
            title: yt.videoTitle || c.name,
            publishedAt: yt.publishedAt,
            first30: f30,
            lifetime: life,
            ranked,
            capsule: c.productionList?.capsule?.name ?? c.channel ?? "—",
            videoUrl: yt.videoUrl,
        };
    }).sort((a, b) => (b.ranked > a.ranked ? 1 : b.ranked < a.ranked ? -1 : 0));

    for (const r of rows) {
        const pub = r.publishedAt?.toISOString().split("T")[0] ?? "—";
        const f30 = r.first30 == null ? "—" : r.first30.toString();
        console.log(`#${r.id}  ${pub}  first30=${f30.padStart(8)}  lifetime=${r.lifetime.toString().padStart(8)}  [${r.capsule}]`);
        console.log(`      ${r.title}`);
        console.log(`      ${r.videoUrl}`);
    }

    const totalFirst30 = rows.reduce((s, r) => s + (r.first30 ?? BigInt(0)), BigInt(0));
    const totalLife    = rows.reduce((s, r) => s + r.lifetime, BigInt(0));
    console.log(`\nTotals: first30=${totalFirst30}  lifetime=${totalLife}  (${rows.length} videos)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
