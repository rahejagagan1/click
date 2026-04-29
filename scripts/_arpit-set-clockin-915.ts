/**
 * One-off: set Arpit's clock-in for IST today to 09:15 AM.
 * Leaves clockOut null (still clocked in).
 *
 * Run with:  npx tsx scripts/_arpit-set-clockin-915.ts
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

function istParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")) };
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

  const { y, m, d } = istParts();
  // IST 09:15 → UTC 03:45 (IST is UTC+5:30, so 09:15 - 5:30 = 03:45 UTC).
  const dateOnly = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const clockIn  = new Date(Date.UTC(y, m - 1, d, 3, 45, 0));

  const row = await p.attendance.upsert({
    where:  { userId_date: { userId: arpit.id, date: dateOnly } },
    create: { userId: arpit.id, date: dateOnly, clockIn, status: "present" },
    update: { clockIn, status: "present" },
  });

  console.log(`Matched: ${arpit.name} <${arpit.email}> (id ${arpit.id})`);
  console.log(`IST date:        ${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  console.log(`Clock-in (UTC):  ${clockIn.toISOString()}`);
  console.log(`Clock-in (IST):  09:15 AM`);
  console.log(`\n✅ attendance.id=${row.id}  status=${row.status}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => p.$disconnect());
