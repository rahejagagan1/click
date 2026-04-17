import { getCronJobsConfig, saveCronJobsConfig, type CronJobsConfig } from "@/lib/cron-jobs-config";
import { runYoutubeDashboardSync } from "./yt-dashboard-sync";

const TICK_MS = 60_000;

let schedulerStarted = false;

/**
 * If auto-sync is enabled in DB and interval has elapsed, runs sync and updates lastAutoRunAt.
 */
export async function maybeRunYoutubeDashboardAutoSync(): Promise<void> {
    const cfg = await getCronJobsConfig();
    const job = cfg.youtube_dashboard;
    if (!job.enabled) return;

    const intervalMs = job.intervalHours * 60 * 60 * 1000;
    const last = job.lastAutoRunAt ? new Date(job.lastAutoRunAt).getTime() : 0;
    const due = last === 0 || Date.now() - last >= intervalMs;
    if (!due) return;

    await runYoutubeDashboardSync();

    const next: CronJobsConfig = {
        ...cfg,
        youtube_dashboard: {
            ...job,
            lastAutoRunAt: new Date().toISOString(),
        },
    };
    await saveCronJobsConfig(next);
}

/**
 * Polls DB every 60s. Requires long-running Node (`next start`).
 * Set DISABLE_INTERNAL_CRON_SCHEDULER=true to skip (e.g. serverless + external cron only).
 */
export function startInternalCronScheduler(): void {
    if (schedulerStarted) return;
    schedulerStarted = true;

    console.log("[CronScheduler] 60s poll started (YouTube dashboard job reads DB flags)");

    setInterval(() => {
        maybeRunYoutubeDashboardAutoSync().catch((e) => console.error("[CronScheduler]", e));
    }, TICK_MS);
}
