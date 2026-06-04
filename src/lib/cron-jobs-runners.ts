// Per-job runner functions invoked by both the internal scheduler and
// the manual "Run now" admin button. Kept in a separate file so the
// scheduler doesn't import every sync's heavy dependency tree just to
// list job ids.

import { runFullSync, syncUsers as runUsersSync } from "@/lib/clickup/sync-engine";
import { syncYoutubeStats } from "@/lib/youtube/sync";
import { calculateMonthlyRatings } from "@/lib/ratings/calculator";
import { runYoutubeDashboardSync } from "@/lib/youtube/yt-dashboard-sync";
import { sendViolationInProgressReminders, sendViolationFollowUpReminders } from "@/lib/hr/violation-reminders";
import { sendProbationEndingReminders } from "@/lib/hr/probation-reminders";
import { sendMissingDocReminders } from "@/lib/hr/doc-compliance";
import { runAutoLOP } from "@/lib/hr/auto-lop";
import { getCronJobsConfig } from "@/lib/cron-jobs-config";
import type { CronJobId } from "@/lib/cron-jobs-registry";

export const CRON_JOB_RUNNERS: Record<CronJobId, () => Promise<void>> = {
  youtube_dashboard: async () => {
    const cfg = await getCronJobsConfig();
    await runYoutubeDashboardSync({ syncPastQuarters: cfg.youtube_dashboard.syncPastQuarters ?? false });
    await syncYoutubeStats();
  },
  clickup:           async () => { await runFullSync(); },
  users:             async () => { await runUsersSync(); },
  ratings:           async () => { await calculateMonthlyRatings(); },
  // Composite: ClickUp tasks → YouTube stats → ratings recompute.
  all_sync: async () => {
    await runFullSync();
    await syncYoutubeStats();
    await calculateMonthlyRatings();
  },
  // Two related emails fire under the same cron + same admin toggle:
  //   • 15-day "still in progress" reminder → HR / CEO / admins
  //   • Pre-resolution follow-up at day 23 → reported employee's manager
  // Idempotent: each function has its own DB-stamped dedupe column
  // (lastReminderAt vs followUpSentAt), so a single daily run does the
  // right thing whether either or both emails are due.
  violation_reminders: async () => {
    await sendViolationInProgressReminders();
    await sendViolationFollowUpReminders();
  },
  probation_reminders: async () => { await sendProbationEndingReminders(); },
  doc_compliance:      async () => { await sendMissingDocReminders(); },
  auto_lop:            async () => { await runAutoLOP(); },
};
