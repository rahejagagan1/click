import prisma from "@/lib/prisma";
import { getCronJobsConfig, saveCronJobsConfig } from "@/lib/cron-jobs-config";
import { CRON_JOB_IDS, type CronJobId } from "@/lib/cron-jobs-registry";
import { CRON_JOB_RUNNERS } from "@/lib/cron-jobs-runners";
import { closeMissedClockOuts } from "@/lib/hr/close-missed-clockouts";
import {
  sendMissedClockInReminders,
  sendMissedClockOutReminders,
} from "@/lib/hr/missed-attendance-emails";
import { maybeRunSickLeaveAccrual } from "@/lib/hr/leave-accrual";

const TICK_MS    = 60_000;
const HOUR_MS    = 60 * 60 * 1000;

// Trigger windows for the daily attendance reminder emails (IST).
//   • Clock-IN  reminder fires at 09:58 IST — 2 mins before the late
//     cut-off so people still have time to clock in before half-day kicks in.
//   • Clock-OUT reminder fires at 20:00 IST — well after the standard
//     6 PM end of shift; anyone still without a clock-out has missed it.
// Fire AFTER the half-day cut-off (10:00 IST), not before. Previously
// 09:58, which sent the email mid-clock-in window for late arrivals.
const CLOCK_IN_HOUR  = 10;
const CLOCK_IN_MIN   = 15;
const CLOCK_OUT_HOUR = 20;
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
const SYNC_KEY_CLOCK_IN  = "hr_missed_clockin_last_day";
const SYNC_KEY_CLOCK_OUT = "hr_missed_clockout_last_day";

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

        // Clock-in reminder — 10:15 IST. Window check is "past or equal"
        // so a server restarted at 10:20 still fires today (once),
        // protected by the SyncConfig gate against re-firing.
        const pastClockInWindow = (t.hour > CLOCK_IN_HOUR)
            || (t.hour === CLOCK_IN_HOUR && t.minute >= CLOCK_IN_MIN);
        // Don't keep nagging late in the day — give a 2-hour cap.
        const stillInClockInRange = t.hour < (CLOCK_IN_HOUR + 2);
        if (pastClockInWindow && stillInClockInRange) {
            claimDailyGate(SYNC_KEY_CLOCK_IN, t.day)
                .then(async (claimed) => {
                    if (!claimed) return;
                    const n = await sendMissedClockInReminders();
                    if (n > 0) console.log(`[CronScheduler/hr] Sent ${n} missed clock-in reminder(s)`);
                })
                .catch((e) => logSchedulerError("hr-clock-in", e));
        }

        // Clock-out reminder — 20:00 IST. Same idea but with a wider cap
        // (until midnight IST) so a 21:30 restart still fires once.
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

        // ── HR: monthly sick-leave accrual (+1 SL day per active user, capped at 12) ──
        // Idempotent on (IST calendar month); the helper persists its
        // own last-run key in SyncConfig so it fires once per month even
        // across restarts.
        maybeRunSickLeaveAccrual()
            .catch((e) => logSchedulerError("hr-sick-leave-accrual", e));
    }, TICK_MS);
}
