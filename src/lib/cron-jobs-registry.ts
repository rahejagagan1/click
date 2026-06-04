// Single source of truth for every cron-able sync in the dashboard.
// To add a new auto-runnable sync:
//   1. Append a new entry to CRON_JOB_DEFINITIONS below.
//   2. Add a runner to CRON_JOB_RUNNERS in src/lib/cron-jobs-runners.ts.
// The Admin → Crons UI, the GET/PATCH endpoints, and the internal
// scheduler all read from this list.

export type CronJobId =
  | "youtube_dashboard"
  | "clickup"
  | "users"
  | "ratings"
  | "all_sync"
  | "violation_reminders"
  | "auto_lop";

export type CronJobDefinition = {
  id: CronJobId;
  name: string;
  description: string;
  /// Default interval (hours) when the job is first enabled and no row
  /// exists yet. Falls between 1 and 168.
  defaultIntervalHours: number;
};

export const CRON_JOB_DEFINITIONS: CronJobDefinition[] = [
  {
    id: "youtube_dashboard",
    name: "YouTube dashboard quarter sync",
    description:
      "YouTube Analytics + Data API: upserts YoutubeDashboardQuarterMetrics (quarter totals) and YoutubeDashboardChannelQuarterAnalysis (7-day view buckets + uploads) per channel (OAuth). Dashboard reads DB only. Enable 'Sync past quarters' to also refresh historical quarters on every run.",
    defaultIntervalHours: 5,
  },
  {
    id: "clickup",
    name: "ClickUp full sync",
    description:
      "Pulls workspaces, capsules, lists, and tasks from ClickUp. Required for the case data behind Cases / Reports / Scores.",
    defaultIntervalHours: 6,
  },
  {
    id: "users",
    name: "Users sync (ClickUp → DB)",
    description:
      "Refreshes the User table from the ClickUp workspace — picks up new joiners, name / picture changes, and disabled accounts.",
    defaultIntervalHours: 24,
  },
  {
    id: "ratings",
    name: "Monthly ratings recalculation",
    description:
      "Recomputes MonthlyRating rows for every active employee using the latest case data. Skips manually-locked rows.",
    defaultIntervalHours: 12,
  },
  {
    id: "all_sync",
    name: "Full sync (ClickUp + YouTube + Ratings)",
    description:
      "End-to-end pipeline: ClickUp tasks → YouTube stats → monthly ratings. Use this for a single nightly catch-up run.",
    defaultIntervalHours: 24,
  },
  {
    id: "violation_reminders",
    name: "Violation in-progress reminders + manager follow-up",
    description:
      "Two emails fire from this daily cron: (1) Every 15+ days, nudges HR / CEO / admins / special_access / developers about any 'in progress' violation (throttled per-violation via lastReminderAt). (2) Once at day 23 (= 30 - 7), sends a follow-up to the reported employee's reporting manager asking for a status update before the implicit 1-month mark. Dedupe via followUpSentAt — each violation triggers the follow-up exactly once.",
    // Run daily; per-row throttles (lastReminderAt + followUpSentAt)
    // keep the actual email volume sane.
    defaultIntervalHours: 24,
  },
  {
    id: "auto_lop",
    name: "Auto-mark missing attendance as LOP",
    description:
      "For each working day in the last 7 days where the 48-hour grace has passed, mark active users as status=\"lop\" if they have no Attendance row AND no pending/approved leave, regularization, WFH, OD, or comp-off for that date. Skips holidays and days outside each user's shift workDays. Idempotent.",
    defaultIntervalHours: 24,
  },
];

export const CRON_JOB_IDS: CronJobId[] = CRON_JOB_DEFINITIONS.map((d) => d.id);
