import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { listConfiguredChannels } from "@/lib/youtube/channels-config";

export const dynamic = "force-dynamic";

/**
 * Per-channel current-quarter / year-to-date view totals + their
 * HR-set targets. Visible to any authenticated user — this powers
 * the dashboard tile every employee sees, not an HR-admin surface.
 *
 * Calendar quarters: Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec.
 *
 * Year-to-date views = sum of all quarter buckets for the current
 * calendar year up to and including the current quarter — exactly
 * what the YoutubeDashboardQuarterMetrics table stores per channel.
 */
export async function GET() {
    try {
        const { session, errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;
        void session;

        const now = new Date();
        const year = now.getUTCFullYear();
        const month = now.getUTCMonth(); // 0-based
        const quarter = Math.floor(month / 3) + 1;

        const configured = listConfiguredChannels();
        if (configured.length === 0) {
            return NextResponse.json({ channels: [], year, quarter });
        }

        const [currentQuarterRows, ytdRows, targetRows] = await Promise.all([
            prisma.youtubeDashboardQuarterMetrics.findMany({
                where: { year, quarter },
            }),
            prisma.youtubeDashboardQuarterMetrics.findMany({
                where: { year, quarter: { lte: quarter } },
            }),
            prisma.channelViewTarget.findMany({
                where: { year, quarter: { in: [0, quarter] } },
            }),
        ]);

        const currentByChannel = new Map<string, number>();
        for (const row of currentQuarterRows) {
            currentByChannel.set(row.channelId, Number(row.viewsGainedInQuarter ?? 0n));
        }

        const ytdByChannel = new Map<string, number>();
        for (const row of ytdRows) {
            const prev = ytdByChannel.get(row.channelId) ?? 0;
            ytdByChannel.set(row.channelId, prev + Number(row.viewsGainedInQuarter ?? 0n));
        }

        const quarterTargetByChannel = new Map<string, number>();
        const yearTargetByChannel = new Map<string, number>();
        for (const row of targetRows) {
            if (row.quarter === 0) {
                yearTargetByChannel.set(row.channelId, Number(row.target));
            } else if (row.quarter === quarter) {
                quarterTargetByChannel.set(row.channelId, Number(row.target));
            }
        }

        const channels = configured.map((c) => ({
            channelId: c.channelId,
            channelName: c.name,
            quarterViews: currentByChannel.get(c.channelId) ?? 0,
            yearViews:    ytdByChannel.get(c.channelId) ?? 0,
            quarterTarget: quarterTargetByChannel.get(c.channelId) ?? 0,
            yearTarget: yearTargetByChannel.get(c.channelId) ?? 0,
            quarter,
            year,
        }));

        return NextResponse.json({ channels, year, quarter });
    } catch (error) {
        return serverError(error, "GET /api/me/view-targets");
    }
}
