// IST-anchored date helpers.
//
// The Attendance.date column is a Postgres `@db.Date` (calendar day, no time).
// Using `new Date(y, m, d)` on a server in UTC lands a morning-IST clock-in on
// the previous calendar day, which is wrong for an Indian HR app. Always key
// attendance off the IST wall-clock day.

/** Returns the IST calendar day as UTC midnight — safe for Prisma @db.Date. */
export function istTodayDateOnly(): Date {
  return istDateOnlyFrom(new Date());
}

/** Returns the IST calendar day for the given instant, as UTC midnight. */
export function istDateOnlyFrom(instant: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant);
  const y = parts.find(p => p.type === "year")!.value;
  const m = parts.find(p => p.type === "month")!.value;
  const d = parts.find(p => p.type === "day")!.value;
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
}

/** Hour of day (0..23) in IST for the given instant. */
export function istHour(instant: Date): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false,
  }).format(instant);
  return parseInt(h, 10);
}

/**
 * First and last UTC-midnight dates (inclusive) of the IST calendar month
 * containing `dateOnly` — suitable for a Prisma `gte / lte` range on a
 * `@db.Date` column. Keys like `date` in `AttendanceRegularization` are
 * already stored as UTC-midnight of the IST day, so no timezone math is
 * needed beyond reading the UTC year/month off the given date.
 */
export function istMonthRange(dateOnly: Date): { start: Date; end: Date } {
  const y = dateOnly.getUTCFullYear();
  const m = dateOnly.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end   = new Date(Date.UTC(y, m + 1, 0)); // last day of month
  return { start, end };
}

/**
 * Build a precise UTC `Date` for a given HH:MM on the IST calendar day that
 * `dateOnly` represents (which is stored as UTC-midnight of that IST day).
 *
 * Example: `istTimeOnDate(reg.date, 10, 0)` → 10:00 AM IST on that date.
 * IST is UTC+5:30, so we subtract 330 minutes to land on the matching UTC instant.
 */
export function istTimeOnDate(dateOnly: Date, hourIst: number, minuteIst: number): Date {
  const IST_OFFSET_MIN = 330; // +5:30
  const base = new Date(dateOnly).setUTCHours(0, 0, 0, 0);
  const offsetMs = (hourIst * 60 + minuteIst - IST_OFFSET_MIN) * 60 * 1000;
  return new Date(base + offsetMs);
}
