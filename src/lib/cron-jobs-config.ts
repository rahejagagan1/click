import prisma from "@/lib/prisma";

export const CRON_JOBS_SYNC_KEY = "cron_jobs";

export type YoutubeDashboardCronState = {
    enabled: boolean;
    intervalHours: number;
    lastAutoRunAt: string | null;
    lastManualRunAt: string | null;
};

export type CronJobsConfig = {
    youtube_dashboard: YoutubeDashboardCronState;
};

const DEFAULT: CronJobsConfig = {
    youtube_dashboard: {
        enabled: false,
        intervalHours: 5,
        lastAutoRunAt: null,
        lastManualRunAt: null,
    },
};

function clampHours(n: number): number {
    if (!Number.isFinite(n)) return DEFAULT.youtube_dashboard.intervalHours;
    return Math.min(168, Math.max(1, Math.floor(n)));
}

export async function getCronJobsConfig(): Promise<CronJobsConfig> {
    const row = await prisma.syncConfig.findUnique({ where: { key: CRON_JOBS_SYNC_KEY } });
    const raw = row?.value as Partial<{ youtube_dashboard?: Partial<YoutubeDashboardCronState> }> | null;
    const y = raw?.youtube_dashboard;
    return {
        youtube_dashboard: {
            enabled: typeof y?.enabled === "boolean" ? y.enabled : DEFAULT.youtube_dashboard.enabled,
            intervalHours: clampHours(Number(y?.intervalHours)),
            lastAutoRunAt: typeof y?.lastAutoRunAt === "string" ? y.lastAutoRunAt : null,
            lastManualRunAt: typeof y?.lastManualRunAt === "string" ? y.lastManualRunAt : null,
        },
    };
}

export async function saveCronJobsConfig(config: CronJobsConfig): Promise<void> {
    const normalized: CronJobsConfig = {
        youtube_dashboard: {
            ...config.youtube_dashboard,
            intervalHours: clampHours(config.youtube_dashboard.intervalHours),
        },
    };
    await prisma.syncConfig.upsert({
        where: { key: CRON_JOBS_SYNC_KEY },
        create: { key: CRON_JOBS_SYNC_KEY, value: normalized as object },
        update: { value: normalized as object },
    });
}
