/**
 * One-off: delete Arpit's attendance row for IST today (clears the clock-in).
 * Run with:  npx tsx scripts/_arpit-clear-today.ts
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

function istTodayDateOnly(): { iso: string; dateOnly: Date } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const iso = `${get("year")}-${get("month")}-${get("day")}`;
  return { iso, dateOnly: new Date(`${iso}T00:00:00.000Z`) };
}

async function main() {
  const arpit = await p.user.findFirst({
    where: {
      OR: [
        { email: { contains: "arpit", mode: "insensitive" } },
        { name:  { contains: "arpit", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true },
  });
  if (!arpit) { console.log("No Arpit found."); return; }

  const { iso, dateOnly } = istTodayDateOnly();
  console.log(`Matched: ${arpit.name} <${arpit.email}> (id ${arpit.id})`);
  console.log(`Target date (IST today): ${iso}`);

  const existing = await p.attendance.findUnique({
    where: { userId_date: { userId: arpit.id, date: dateOnly } },
  });
  if (!existing) { console.log("No attendance row for today — nothing to delete."); return; }

  console.log(`Found row id=${existing.id}: clockIn=${existing.clockIn?.toISOString() ?? "—"} clockOut=${existing.clockOut?.toISOString() ?? "—"} status=${existing.status}`);
  await p.attendance.delete({ where: { id: existing.id } });
  console.log(`\n✅ Deleted attendance row id=${existing.id}.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => p.$disconnect());
