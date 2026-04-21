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
