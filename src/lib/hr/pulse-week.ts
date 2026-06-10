// Pulse week math. Maps any IST date to:
//   • weekKey       — "<isoYear>-W<isoWeek>", used as the submission
//                     key in PulseResponse. Same string for everyone
//                     on a given week so we can group answers.
//   • activeWeek    — 1, 2, 3, or 4 — which seed week's questions go
//                     out this Friday. Rotates continuously through
//                     the 4-week bank.
//   • isPulseDay    — true on Friday in IST.
//   • isAfterSendTime — true on Friday at/after 10:30 IST. Used by
//                     the clock-out guard so people aren't blocked
//                     before the questions even land.
//
// IST is the only timezone HR cares about — the office runs on +05:30
// regardless of where the request originated. We compute everything
// against an IST-shifted Date so the cron at 10:30 IST and the
// "is it Friday yet?" check stay in lockstep.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Returns the Date shifted into IST as if it were UTC (so .getUTCxxx
 *  methods return IST values). NEVER use the resulting object's local
 *  methods — they'd double-shift. */
function istShift(d: Date = new Date()): Date {
  return new Date(d.getTime() + IST_OFFSET_MS);
}

/** ISO-8601 week number + ISO week-year for an IST-shifted date.
 *  Week 1 is the week with the first Thursday — same definition Postgres
 *  + most calendars use, so `weekKey` matches whatever HR sees on a
 *  calendar app. */
function isoWeek(istDate: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(
    istDate.getUTCFullYear(),
    istDate.getUTCMonth(),
    istDate.getUTCDate(),
  ));
  // Thursday in current week decides the year.
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

export function getWeekKey(d: Date = new Date()): string {
  const { year, week } = isoWeek(istShift(d));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** 1, 2, 3, or 4 — the WEEK-OF-MONTH in IST. Anchored to the
 *  calendar month so the theme matches the real date:
 *    days  1- 7  → Week 1  (Mood & Wellbeing)
 *    days  8-14  → Week 2  (Manager & Team)
 *    days 15-21  → Week 3  (Workload & Resources)
 *    days 22-31  → Week 4  (Growth & Engagement)   ← 5th-week days
 *                                                     fold into Week 4
 *  so the survey theme always reflects "which week of THIS month
 *  is it" rather than a continuous ISO-week rotation. */
export function getActiveWeekNumber(d: Date = new Date()): 1 | 2 | 3 | 4 {
  const ist = istShift(d);
  const dayOfMonth = ist.getUTCDate();
  return Math.min(4, Math.ceil(dayOfMonth / 7)) as 1 | 2 | 3 | 4;
}

/** True if it's Friday in IST. */
export function isPulseDay(d: Date = new Date()): boolean {
  return istShift(d).getUTCDay() === 5;
}

/** True if it's Friday in IST and it's 10:30 IST or later.
 *  Used by the clock-out guard — before 10:30 the questions
 *  haven't even gone out, so blocking would be unfair. */
export function isAfterSendTime(d: Date = new Date()): boolean {
  const ist = istShift(d);
  if (ist.getUTCDay() !== 5) return false;
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return minutes >= (10 * 60 + 30);
}

/** Pretty human-readable day label, e.g. "Fri 12 Jun 2026 (IST)". */
export function prettyIstDate(d: Date = new Date()): string {
  const ist = istShift(d);
  return ist.toUTCString().replace(" GMT", " IST");
}

// ── Monthly survey ───────────────────────────────────────────────
//
// Monthly responses live in the SAME PulseResponse table as weekly,
// but keyed on a month-shaped string so they don't collide. The
// PulseResponse.weekKey column ends up holding either format:
//   "2026-W23"  (weekly)
//   "2026-M06"  (monthly)
// — the prefix letter (W vs M) distinguishes them in any query that
// needs to scope by survey type.

export function getMonthKey(d: Date = new Date()): string {
  const ist = istShift(d);
  return `${ist.getUTCFullYear()}-M${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Friendly month label, e.g. "June 2026". */
export function prettyMonth(monthKey: string): string {
  const [yStr, mStr] = monthKey.split("-M");
  const y = Number(yStr), m = Number(mStr);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return monthKey;
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${months[m - 1] ?? `Month ${m}`} ${y}`;
}

/** Returns the cycle key appropriate for a given survey type. */
export function getCycleKey(surveyType: "weekly" | "monthly", d: Date = new Date()): string {
  return surveyType === "monthly" ? getMonthKey(d) : getWeekKey(d);
}

/** True if the given date is the FIRST Monday of its month in IST.
 *
 *  ⚠ LOAD-BEARING — do not delete.
 *
 *  Standard Vixie/Debian/RHEL cron OR's day-of-month with day-of-
 *  week when both are restricted (the famous cron footgun, see
 *  crontab(5) man page). The monthly-send crontab line
 *  `0 5 1-7 * 1` therefore fires ~10 times per month at the daemon
 *  level (every day 1-7 OR every Monday). This helper is what
 *  collapses those 10 firings into a single actual fanout per
 *  month by requiring BOTH dow=Monday AND dom ≤ 7. */
export function isFirstMondayOfMonth(d: Date = new Date()): boolean {
  const ist = istShift(d);
  if (ist.getUTCDay() !== 1) return false;          // Monday = 1
  return ist.getUTCDate() <= 7;                     // first 7 days of month
}
