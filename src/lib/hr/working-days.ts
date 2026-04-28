import prisma from "@/lib/prisma";

/**
 * Count the working days between `from` and `to` inclusive, excluding
 * Saturdays, Sundays, and any HolidayCalendar row in that window.
 *
 * All arithmetic is UTC-based:
 *   • the leave form posts dates as "YYYY-MM-DD" → parsed as UTC midnight,
 *   • Prisma returns @db.Date columns as UTC-midnight Date objects,
 *   • the server may run in UTC or IST — using getUTCDay() / setUTCDate()
 *     gives the same answer either way and prevents off-by-one weekend
 *     bugs when crossing TZ boundaries.
 */
export async function countWorkingDays(from: Date, to: Date): Promise<number> {
  const isoKey = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

  const holidays = await prisma.holidayCalendar.findMany({
    where: { date: { gte: from, lte: to } }, select: { date: true },
  });
  const holidaySet = new Set(holidays.map((h) => isoKey(h.date)));

  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end =          Date.UTC(to.getUTCFullYear(),   to.getUTCMonth(),   to.getUTCDate());

  let count = 0;
  while (cur.getTime() <= end) {
    const dow = cur.getUTCDay(); // 0 = Sun, 6 = Sat
    if (dow !== 0 && dow !== 6 && !holidaySet.has(isoKey(cur))) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}
