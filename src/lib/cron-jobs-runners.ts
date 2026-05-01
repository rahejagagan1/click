// Per-job runner functions invoked by both the internal scheduler and
// the manual "Run now" admin button. Kept in a separate file so the
// scheduler doesn't import every sync's heavy dependency tree just to
// list job ids.

import { runFullSync, syncUsers as runUsersSync } from "@/lib/clickup/sync-engine";
import { syncYoutubeStats } from "@/lib/youtube/sync";
import { calculateMonthlyRatings } from "@/lib/ratings/calculator";
import { runYoutubeDashboardSync } from "@/lib/youtube/yt-dashboard-sync";
import { sendViolationInProgressReminders } from "@/lib/hr/violation-reminders";
import type { CronJobId } from "@/lib/cron-jobs-registry";

export const CRON_JOB_RUNNERS: Record<CronJobId, () => Promise<void>> = {
  youtube_dashboard: async () => { await runYoutubeDashboardSync(); },
  clickup:           async () => { await runFullSync(); },
  users:             async () => { await runUsersSync(); },
  ratings:           async () => { await calculateMonthlyRatings(); },
  // Composite: ClickUp tasks → YouTube stats → ratings recompute.
  all_sync: async () => {
    await runFullSync();
    await syncYoutubeStats();
    await calculateMonthlyRatings();
  },
  violation_reminders: async () => { await sendViolationInProgressReminders(); },
};
