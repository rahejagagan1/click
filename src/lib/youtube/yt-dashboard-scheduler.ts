import { getCronJobsConfig, saveCronJobsConfig, type CronJobsConfig } from "@/lib/cron-jobs-config";
import { runYoutubeDashboardSync } from "./yt-dashboard-sync";
import { closeMissedClockOuts } from "@/lib/hr/close-missed-clockouts";

const TICK_MS    = 60_000;
const HOUR_MS    = 60 * 60 * 1000;

let schedulerStarted    = false;
let lastMissedCloseRun  = 0;

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

    console.log("[CronScheduler] 60s poll started (YouTube dashboard + HR missed-clockout sweeper)");

    setInterval(() => {
        maybeRunYoutubeDashboardAutoSync().catch((e) => console.error("[CronScheduler/yt]", e));

        // HR: sweep stale clock-ins once an hour. Cheap single UPDATE; usually 0 rows.
        const now = Date.now();
        if (now - lastMissedCloseRun >= HOUR_MS) {
            lastMissedCloseRun = now;
            closeMissedClockOuts()
                .then((n) => {
                    if (n > 0) console.log(`[CronScheduler/hr] Flagged ${n} missed clock-out(s)`);
                })
                .catch((e) => console.error("[CronScheduler/hr]", e));
        }
    }, TICK_MS);
}
