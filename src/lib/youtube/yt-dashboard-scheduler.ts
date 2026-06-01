import prisma from "@/lib/prisma";
import { getCronJobsConfig, saveCronJobsConfig } from "@/lib/cron-jobs-config";
import { CRON_JOB_IDS, type CronJobId } from "@/lib/cron-jobs-registry";
import { CRON_JOB_RUNNERS } from "@/lib/cron-jobs-runners";
import { closeMissedClockOuts } from "@/lib/hr/close-missed-clockouts";
import {
  sendMissedClockInReminders,
  sendMissedClockOutReminders,
  sendHrLateClockInSummary,
} from "@/lib/hr/missed-attendance-emails";
// import { maybeRunSickLeaveAccrual } from "@/lib/hr/leave-accrual"; // DISABLED — see scheduler tick

const TICK_MS    = 60_000;
const HOUR_MS    = 60 * 60 * 1000;

// Trigger windows for the daily attendance reminder emails (IST).
//   • Employee  Clock-IN  reminder fires at 09:50 IST — gives everyone
//     a 10-minute heads-up before the late cut-off.
//   • HR Manager Late Summary fires at 10:05 IST — listing absent +
//     late employees consolidated into one mail per HR admin.
//   • Employee  Clock-OUT reminder fires at 19:00 IST — one hour after
//     the standard 6 PM end of shift.
// Window caps:
//   • Clock-IN  fires from 09:50 → 09:59 IST (HR summary at 10:05 takes
//     over the "late" framing after that).
//   • HR Late Summary fires from 10:05 → 11:59 IST (window cap so a
//     restart at noon doesn't email after lunch).
//   • Clock-OUT fires from 19:00 IST → midnight IST (no upper cap;
//     past-midnight, t.day rolls over and the gate is fresh).
const CLOCK_IN_HOUR  = 9;
const CLOCK_IN_MIN   = 50;
const HR_SUMMARY_HOUR = 10;
const HR_SUMMARY_MIN  = 5;
const CLOCK_OUT_HOUR = 19;
const CLOCK_OUT_MIN  = 0;

let schedulerStarted    = false;
let lastMissedCloseRun  = 0;

// Track when we last logged a DB-unreachable error so a brief outage
// doesn't paper the console with stack traces every 60s. Logs once,
// then stays quiet for 5 minutes before logging the same condition
// again. Re-keyed by the call-site label so each subsystem still
// surfaces its first failure.
const DB_DOWN_QUIET_MS = 5 * 60 * 1000;
const lastDbDownLog = new Map<string, number>();

/**
 * If the error looks like a Prisma "can't reach DB" (P1001), log a
 * one-line warning at most once per 5 minutes per label and swallow
 * the rest. Anything else logs normally so real bugs aren't hidden.
 */
function logSchedulerError(label: string, err: any): void {
  const isDbDown =
    err?.code === "P1001" ||
    /Can't reach database server/i.test(String(err?.message || ""));
  if (isDbDown) {
    const now = Date.now();
    const last = lastDbDownLog.get(label) ?? 0;
    if (now - last >= DB_DOWN_QUIET_MS) {
      lastDbDownLog.set(label, now);
      console.warn(`[CronScheduler/${label}] DB unreachable — pausing this job until the next tick that connects.`);
    }
    return;
  }
  console.error(`[CronScheduler/${label}]`, err);
}

// Per-day gates persist in SyncConfig (NOT in memory) — otherwise a
// post-window restart wipes the gate and the next tick re-fires the
// emails. SyncConfig keys + payload shape mirror the leave-accrual
// helper.
const SYNC_KEY_CLOCK_IN   = "hr_missed_clockin_last_day";
const SYNC_KEY_HR_SUMMARY = "hr_late_summary_last_day";
const SYNC_KEY_CLOCK_OUT  = "hr_missed_clockout_last_day";

/**
 * Try to claim today's "fired" slot for the given SyncConfig key.
 * Returns true if this caller successfully claimed it (and should run
 * the reminder), false if today's slot was already claimed.
 *
 * The marker is written BEFORE the caller sends emails so:
 *   • a 60s retick mid-send can't double-fire
 *   • a server restart mid-send finds the gate already stamped
 *     and skips the second batch
 */
async function claimDailyGate(key: string, day: string): Promise<boolean> {
  const row = await prisma.syncConfig.findUnique({ where: { key } });
  const lastDay = (row?.value as { lastDay?: string } | null)?.lastDay ?? null;
  if (lastDay === day) return false;
  await prisma.syncConfig.upsert({
    where:  { key },
    create: { key, value: { lastDay: day } },
    update: { value: { lastDay: day } },
  });
  return true;
}

/** YYYY-MM-DD in IST, plus current hour/minute as integers. */
function istClock(): { day: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    day:    `${get("year")}-${get("month")}-${get("day")}`,
    hour:   parseInt(get("hour")   || "0", 10),
    minute: parseInt(get("minute") || "0", 10),
  };
}

/**
 * Generic per-job auto-runner. Iterates through every registered cron
 * job, runs the ones whose interval has elapsed, and stamps
 * `lastAutoRunAt` on success. Errors in one job don't block others.
 */
export async function maybeRunDueCronJobs(): Promise<void> {
    const cfg = await getCronJobsConfig();
    let dirty = false;
    for (const id of CRON_JOB_IDS) {
        const job = cfg[id];
        if (!job?.enabled) continue;
        const intervalMs = job.intervalHours * 60 * 60 * 1000;
        const last = job.lastAutoRunAt ? new Date(job.lastAutoRunAt).getTime() : 0;
        const due = last === 0 || Date.now() - last >= intervalMs;
        if (!due) continue;
        try {
            await CRON_JOB_RUNNERS[id]();
            cfg[id] = { ...job, lastAutoRunAt: new Date().toISOString() };
            dirty = true;
            console.log(`[CronScheduler] auto-ran job=${id}`);
        } catch (e) {
            console.error(`[CronScheduler] job=${id} failed:`, e);
        }
    }
    if (dirty) {
        try { await saveCronJobsConfig(cfg); }
        catch (e) { console.error("[CronScheduler] failed to persist last-run:", e); }
    }
}

/// Back-compat alias — older imports referenced this name.
export const maybeRunYoutubeDashboardAutoSync = maybeRunDueCronJobs;

/**
 * Polls DB every 60s. Requires long-running Node (`next start`).
 * Set DISABLE_INTERNAL_CRON_SCHEDULER=true to skip (e.g. serverless + external cron only).
 */
export function startInternalCronScheduler(): void {
    if (schedulerStarted) return;
    schedulerStarted = true;

    console.log("[CronScheduler] 60s poll started (YouTube dashboard + HR missed-clockout sweeper)");

    setInterval(() => {
        maybeRunDueCronJobs().catch((e) => logSchedulerError("jobs", e));

        // HR: sweep stale clock-ins once an hour. Cheap single UPDATE; usually 0 rows.
        const now = Date.now();
        if (now - lastMissedCloseRun >= HOUR_MS) {
            lastMissedCloseRun = now;
            closeMissedClockOuts()
                .then((n) => {
                    if (n > 0) console.log(`[CronScheduler/hr] Flagged ${n} missed clock-out(s)`);
                })
                .catch((e) => logSchedulerError("hr-missed-close", e));
        }

        // ── HR: daily attendance reminder emails ─────────────────────
        // Tick every minute, but actually fire only when:
        //   • we're at/past the trigger time in IST, AND
        //   • we haven't already fired today.
        const t = istClock();

        // Employee clock-in reminder — 09:50 IST. Window is narrow
        // (until 09:59 IST) — the 10:05 HR summary takes over after
        // that. SyncConfig gate protects against double-fire.
        const pastClockInWindow =
            (t.hour > CLOCK_IN_HOUR) ||
            (t.hour === CLOCK_IN_HOUR && t.minute >= CLOCK_IN_MIN);
        const stillInClockInWindow = t.hour < HR_SUMMARY_HOUR;
        if (pastClockInWindow && stillInClockInWindow) {
            claimDailyGate(SYNC_KEY_CLOCK_IN, t.day)
                .then(async (claimed) => {
                    if (!claimed) return;
                    const n = await sendMissedClockInReminders();
                    if (n > 0) console.log(`[CronScheduler/hr] Sent ${n} missed clock-in reminder(s)`);
                })
                .catch((e) => logSchedulerError("hr-clock-in", e));
        }

        // HR Manager daily summary — 10:05 IST. One consolidated email
        // per HR-admin recipient with absent + late tables. Window cap
        // at 11:59 IST so a noon restart doesn't email after lunch.
        const pastHrSummaryWindow =
            (t.hour > HR_SUMMARY_HOUR) ||
            (t.hour === HR_SUMMARY_HOUR && t.minute >= HR_SUMMARY_MIN);
        const stillInHrSummaryWindow = t.hour < (HR_SUMMARY_HOUR + 2);
        if (pastHrSummaryWindow && stillInHrSummaryWindow) {
            claimDailyGate(SYNC_KEY_HR_SUMMARY, t.day)
                .then(async (claimed) => {
                    if (!claimed) return;
                    const n = await sendHrLateClockInSummary();
                    if (n > 0) console.log(`[CronScheduler/hr] Sent HR late-summary email`);
                })
                .catch((e) => logSchedulerError("hr-late-summary", e));
        }

        // Clock-out reminder — 19:00 IST. Wide cap (until midnight IST)
        // so a 21:30 restart still fires once.
        const pastClockOutWindow = (t.hour > CLOCK_OUT_HOUR)
            || (t.hour === CLOCK_OUT_HOUR && t.minute >= CLOCK_OUT_MIN);
        if (pastClockOutWindow) {
            claimDailyGate(SYNC_KEY_CLOCK_OUT, t.day)
                .then(async (claimed) => {
                    if (!claimed) return;
                    const n = await sendMissedClockOutReminders();
                    if (n > 0) console.log(`[CronScheduler/hr] Sent ${n} missed clock-out reminder(s)`);
                })
                .catch((e) => logSchedulerError("hr-clock-out", e));
        }

        // ── HR: monthly sick-leave accrual ─────────────────────────
        // DISABLED — this legacy SL-only system double-credited every
        // employee because the policy-driven `accrueLeavesForUser`
        // (src/lib/leave-accrual.ts) was added later with SL set to
        // monthlyAccrual=1. Both fired on the 1st of each month and
        // each added +1 SL day → users got +2 SL instead of +1.
        // The policy-driven system is now the single source of truth
        // for every leave type, SL included. Do not re-enable.
        //
        // maybeRunSickLeaveAccrual()
        //     .catch((e) => logSchedulerError("hr-sick-leave-accrual", e));
    }, TICK_MS);
}
