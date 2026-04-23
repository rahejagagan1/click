import { PrismaClient } from "@prisma/client";

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error("DATABASE_URL is not set");
        process.exit(1);
    }

    const prisma = new PrismaClient({ datasources: { db: { url } } });

    const targets = [
        "YoutubeStats",
        "YoutubeStatsHistory",
        "YtVideoLookup",
        "YoutubeDashboardVideo",
        "YoutubeDashboardQuarterMetrics",
        "YoutubeDashboardChannelQuarterAnalysis",
        "YoutubeDashUserQuarterChannel",
        "YoutubeDashboardVideoSnapshot",
    ];

    try {
        const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
            `SELECT table_name::text FROM information_schema.tables WHERE table_schema = 'public' AND (table_name ILIKE '%youtube%' OR table_name ILIKE 'yt%') ORDER BY table_name;`
        );

        const found = new Set(rows.map((r) => r.table_name));

        console.log(`\nAll YT-named tables in information_schema (${rows.length}):`);
        for (const name of Array.from(found).sort()) console.log(`  - ${name}`);

        console.log(`\nExpected-per-schema check:`);
        for (const t of targets) {
            console.log(`  ${found.has(t) ? "✓ present" : "✗ MISSING"}  ${t}`);
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
