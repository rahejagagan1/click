import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCronJobsConfig, saveCronJobsConfig, type CronJobsConfig } from "@/lib/cron-jobs-config";
import { serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

function canManage(session: any): boolean {
    const u = session?.user as any;
    return u?.orgLevel === "ceo" || u?.isDeveloper === true;
}

/** GET — CEO / Developer: list cron job settings */
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!canManage(session)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const config = await getCronJobsConfig();
        const internalDisabled = process.env.DISABLE_INTERNAL_CRON_SCHEDULER === "true";

        return NextResponse.json({
            internalSchedulerDisabled: internalDisabled,
            serverNote: internalDisabled
                ? "Internal 60s poll is OFF (DISABLE_INTERNAL_CRON_SCHEDULER). Use POST /api/cron/youtube-dashboard-sync with CRON_SECRET on a timer, or unset that env on your Node host."
                : "Internal scheduler polls every 60 seconds while this Node process runs (next start). Auto jobs run when enabled below and the interval has passed.",
            jobs: [
                {
                    id: "youtube_dashboard",
                    name: "YouTube dashboard quarter sync",
                    description:
                        "YouTube Analytics + Data API: upserts YoutubeDashboardQuarterMetrics (quarter totals) and YoutubeDashboardChannelQuarterAnalysis (10-day view buckets + uploads) per channel (OAuth). Dashboard reads DB only.",
                    ...config.youtube_dashboard,
                },
            ],
        });
    } catch (error) {
        console.error("[admin/cron-jobs GET]", error);
        return serverError(error, "admin/cron-jobs GET");
    }
}

/** PATCH — CEO / Developer: update job settings (enabled, intervalHours) */
export async function PATCH(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!canManage(session)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const patch = body.youtube_dashboard as Partial<{ enabled: boolean; intervalHours: number }> | undefined;

        const current = await getCronJobsConfig();
        const next: CronJobsConfig = {
            youtube_dashboard: {
                ...current.youtube_dashboard,
                ...(typeof patch?.enabled === "boolean" ? { enabled: patch.enabled } : {}),
                ...(patch?.intervalHours != null
                    ? {
                          intervalHours: Math.min(168, Math.max(1, Math.floor(Number(patch.intervalHours)) || 5)),
                      }
                    : {}),
            },
        };
        await saveCronJobsConfig(next);

        const fresh = await getCronJobsConfig();
        return NextResponse.json({
            ok: true,
            youtube_dashboard: fresh.youtube_dashboard,
        });
    } catch (error) {
        console.error("[admin/cron-jobs PATCH]", error);
        return serverError(error, "admin/cron-jobs PATCH");
    }
}
