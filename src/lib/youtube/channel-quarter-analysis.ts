import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import type { ChannelConfig } from "./youtube-analytics";
import {
    getChannelDailyViewsSeries,
    fetchChannelUploadsInRange,
    type DailyViewPoint,
    type UploadSnippet,
} from "./youtube-analytics";

function parseYmdUtc(s: string): Date {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

function formatShortUtc(d: Date): string {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export type QuarterAnalysisBucket = {
    key: string;
    label: string;
    endDay: string;
    views: number;
    uploads: UploadSnippet[];
};

export function buildTenDayBuckets(
    dailies: DailyViewPoint[],
    startStr: string,
    endStr: string,
    uploads: UploadSnippet[]
): QuarterAnalysisBucket[] {
    const dailyMap = new Map(dailies.map((p) => [p.day, p.views]));
    const start = parseYmdUtc(startStr);
    const end = parseYmdUtc(endStr);
    const buckets: QuarterAnalysisBucket[] = [];

    let cursor = new Date(start);
    while (cursor <= end) {
        const bStart = new Date(cursor);
        const bEnd = new Date(cursor);
        bEnd.setUTCDate(bEnd.getUTCDate() + 9);
        if (bEnd > end) bEnd.setTime(end.getTime());

        let sum = 0;
        for (let t = new Date(bStart); t <= bEnd; t.setUTCDate(t.getUTCDate() + 1)) {
            const key = t.toISOString().slice(0, 10);
            sum += dailyMap.get(key) ?? 0;
        }

        const b0 = bStart.toISOString().slice(0, 10);
        const b1 = bEnd.toISOString().slice(0, 10);
        const upsInBucket = uploads.filter((u) => {
            const d = u.publishedAt.slice(0, 10);
            return d >= b0 && d <= b1;
        });

        buckets.push({
            key: bEnd.toISOString().slice(0, 10),
            label: `${formatShortUtc(bStart)} – ${formatShortUtc(bEnd)}`,
            endDay: bEnd.toISOString().slice(0, 10),
            views: sum,
            uploads: upsInBucket,
        });

        cursor.setUTCDate(cursor.getUTCDate() + 10);
    }

    return buckets;
}

export type StoredChartJson = {
    analyticsStartStr: string;
    analyticsEndStr: string;
    buckets: QuarterAnalysisBucket[];
    uploadsTotal: number;
};

/**
 * Fetches YouTube Analytics daily series + upload list, builds 10-day buckets, persists (cron path).
 */
export async function upsertChannelQuarterAnalysisFromApis(
    channel: ChannelConfig,
    year: number,
    quarter: number,
    startStr: string,
    endStr: string
): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
        const dailies = await getChannelDailyViewsSeries(channel, startStr, endStr);
        if (dailies == null) {
            return { ok: false, message: "YouTube Analytics daily series failed" };
        }
        const uploads = await fetchChannelUploadsInRange(channel.channelId, startStr, endStr);
        const buckets = buildTenDayBuckets(dailies, startStr, endStr, uploads);
        const headlineViews = buckets.length ? buckets[buckets.length - 1].views : 0;

        const chartJson: StoredChartJson = {
            analyticsStartStr: startStr,
            analyticsEndStr: endStr,
            buckets,
            uploadsTotal: uploads.length,
        };

        await prisma.youtubeDashboardChannelQuarterAnalysis.upsert({
            where: {
                channelId_year_quarter: {
                    channelId: channel.channelId,
                    year,
                    quarter,
                },
            },
            create: {
                channelId: channel.channelId,
                year,
                quarter,
                chartJson: chartJson as Prisma.InputJsonValue,
                headlineViews,
            },
            update: {
                chartJson: chartJson as Prisma.InputJsonValue,
                headlineViews,
            },
        });

        return { ok: true };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, message: msg };
    }
}
