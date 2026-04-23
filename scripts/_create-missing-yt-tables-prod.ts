import { PrismaClient } from "@prisma/client";

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error("DATABASE_URL is not set");
        process.exit(1);
    }

    const prisma = new PrismaClient({ datasources: { db: { url } } });

    const video = `
        CREATE TABLE "YoutubeDashboardVideo" (
            "id" SERIAL NOT NULL,
            "youtubeVideoId" TEXT NOT NULL,
            "channelId" TEXT NOT NULL,
            "channelName" TEXT NOT NULL,
            "title" TEXT NOT NULL,
            "publishedAt" TIMESTAMP(3),
            "viewCount" BIGINT NOT NULL,
            "likeCount" BIGINT,
            "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "YoutubeDashboardVideo_pkey" PRIMARY KEY ("id")
        );
    `;
    const videoIdx1 = `CREATE UNIQUE INDEX "YoutubeDashboardVideo_youtubeVideoId_key" ON "YoutubeDashboardVideo"("youtubeVideoId");`;
    const videoIdx2 = `CREATE INDEX "YoutubeDashboardVideo_channelId_idx" ON "YoutubeDashboardVideo"("channelId");`;
    const videoIdx3 = `CREATE INDEX "YoutubeDashboardVideo_publishedAt_idx" ON "YoutubeDashboardVideo"("publishedAt");`;
    const videoIdx4 = `CREATE INDEX "YoutubeDashboardVideo_syncedAt_idx" ON "YoutubeDashboardVideo"("syncedAt");`;

    const quarter = `
        CREATE TABLE "YoutubeDashboardQuarterMetrics" (
            "id" SERIAL NOT NULL,
            "channelId" TEXT NOT NULL,
            "year" INTEGER NOT NULL,
            "quarter" INTEGER NOT NULL,
            "analyticsStartStr" TEXT NOT NULL,
            "analyticsEndStr" TEXT NOT NULL,
            "viewsGainedInQuarter" BIGINT,
            "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "YoutubeDashboardQuarterMetrics_pkey" PRIMARY KEY ("id")
        );
    `;
    const quarterIdx1 = `CREATE UNIQUE INDEX "YoutubeDashboardQuarterMetrics_channelId_year_quarter_key" ON "YoutubeDashboardQuarterMetrics"("channelId", "year", "quarter");`;
    const quarterIdx2 = `CREATE INDEX "YoutubeDashboardQuarterMetrics_year_quarter_idx" ON "YoutubeDashboardQuarterMetrics"("year", "quarter");`;

    try {
        await prisma.$transaction([
            prisma.$executeRawUnsafe(video),
            prisma.$executeRawUnsafe(videoIdx1),
            prisma.$executeRawUnsafe(videoIdx2),
            prisma.$executeRawUnsafe(videoIdx3),
            prisma.$executeRawUnsafe(videoIdx4),
            prisma.$executeRawUnsafe(quarter),
            prisma.$executeRawUnsafe(quarterIdx1),
            prisma.$executeRawUnsafe(quarterIdx2),
        ]);
        console.log("✓ Created YoutubeDashboardVideo + 4 indexes");
        console.log("✓ Created YoutubeDashboardQuarterMetrics + 2 indexes");

        const check = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
            `SELECT table_name::text FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('YoutubeDashboardVideo', 'YoutubeDashboardQuarterMetrics') ORDER BY table_name;`
        );
        console.log(`\nVerification: ${check.length}/2 tables present:`);
        for (const r of check) console.log(`  ✓ ${r.table_name}`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
