import prisma from "@/lib/prisma";
import { upsertChannelQuarterAnalysisFromApis } from "@/lib/youtube/channel-quarter-analysis";
import {
    getChannelConfigs,
    getChannelViewsInRange,
    getQuarterDateStrings,
    getQuarterKeysToRefreshOnSync,
    type ChannelConfig,
} from "@/lib/youtube/youtube-analytics";

export type YoutubeDashboardSyncResult = {
    /** Legacy field — always 0 (per-video Data API sync removed). */
    upserted: number;
    shortsSkipped: number;
    channelsProcessed: number;
    quarterMetricsUpserted: number;
    /** Stored 10-day bucket charts (same cron as quarter metrics). */
    channelQuarterAnalysisUpserted: number;
    errors: string[];
};

async function syncQuarterMetricsForChannels(
    configs: ChannelConfig[]
): Promise<{ upserted: number; channelQuarterAnalysisUpserted: number; errors: string[] }> {
    const errors: string[] = [];
    if (configs.length === 0) return { upserted: 0, channelQuarterAnalysisUpserted: 0, errors };

    const keys = getQuarterKeysToRefreshOnSync(new Date(), 5);
    let upserted = 0;
    let channelQuarterAnalysisUpserted = 0;

    for (const { year, quarter } of keys) {
        const { startStr, endStr } = getQuarterDateStrings(year, quarter);
        const results = await Promise.all(
            configs.map(async (c) => {
                try {
                    const views = await getChannelViewsInRange(c, startStr, endStr);
                    await prisma.youtubeDashboardQuarterMetrics.upsert({
                        where: {
                            channelId_year_quarter: {
                                channelId: c.channelId,
                                year,
                                quarter,
                            },
                        },
                        create: {
                            channelId: c.channelId,
                            year,
                            quarter,
                            analyticsStartStr: startStr,
                            analyticsEndStr: endStr,
                            viewsGainedInQuarter: views != null ? BigInt(views) : null,
                        },
                        update: {
                            analyticsStartStr: startStr,
                            analyticsEndStr: endStr,
                            viewsGainedInQuarter: views != null ? BigInt(views) : null,
                        },
                    });

                    const analysis = await upsertChannelQuarterAnalysisFromApis(c, year, quarter, startStr, endStr);
                    if (!analysis.ok) {
                        errors.push(`${c.name} quarter chart Q${quarter} ${year}: ${analysis.message}`);
                    }

                    return { ok: true as const, channel: c.name, chartStored: analysis.ok };
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    errors.push(`${c.name} Q${quarter} ${year}: ${msg}`);
                    return { ok: false as const, channel: c.name, chartStored: false };
                }
            })
        );
        upserted += results.filter((r) => r.ok).length;
        channelQuarterAnalysisUpserted += results.filter((r) => r.ok && r.chartStored).length;
    }

    return { upserted, channelQuarterAnalysisUpserted, errors };
}

/**
 * Refreshes YouTube Analytics quarter view totals into YoutubeDashboardQuarterMetrics (per-channel OAuth).
 */
export async function runYoutubeDashboardSync(): Promise<YoutubeDashboardSyncResult> {
    const configs = getChannelConfigs();
    if (configs.length === 0) {
        return {
            upserted: 0,
            shortsSkipped: 0,
            channelsProcessed: 0,
            quarterMetricsUpserted: 0,
            channelQuarterAnalysisUpserted: 0,
            errors: ["YOUTUBE_CHANNELS is empty"],
        };
    }

    console.log("[yt-dashboard-sync] Syncing YouTube Analytics quarter metrics + stored channel charts…");
    const quarterResult = await syncQuarterMetricsForChannels(configs);

    return {
        upserted: 0,
        shortsSkipped: 0,
        channelsProcessed: configs.length,
        quarterMetricsUpserted: quarterResult.upserted,
        channelQuarterAnalysisUpserted: quarterResult.channelQuarterAnalysisUpserted,
        errors: quarterResult.errors,
    };
}
