/**
 * One-off: collapse Arpit's IST-today attendance back to a single
 * open session starting at 08:00 AM. Drops every existing
 * AttendanceSession row for today, resets the parent Attendance row,
 * and re-inserts ONE session with clockIn = 08:00 IST, clockOut = null.
 *
 * Targets the company-account Arpit (arpit@nbmediaproductions.com) —
 * change the email below if you need to retarget.
 *
 * Run with:  npx tsx scripts/_arpit-reset-to-single-8am.ts
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

const TARGET_EMAIL = "arpitsharma4602@gmail.com";

function istParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")) };
}

async function main() {
  const arpit = await p.user.findFirst({
    where: { email: { equals: TARGET_EMAIL, mode: "insensitive" } },
    select: { id: true, name: true, email: true },
  });
  if (!arpit) {
    console.log(`✗ No user with email ${TARGET_EMAIL}. Aborting.`);
    return;
  }
  console.log(`Matched: ${arpit.name} <${arpit.email}> (id ${arpit.id})`);

  const { y, m, d } = istParts();
  // IST 08:00 → UTC 02:30 (IST is UTC+5:30, so 08:00 - 5:30 = 02:30 UTC).
  const dateOnly = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const clockIn  = new Date(Date.UTC(y, m - 1, d, 2, 30, 0));

  const existing = await p.attendance.findUnique({
    where: { userId_date: { userId: arpit.id, date: dateOnly } },
  });
  if (!existing) {
    console.log("No Attendance row for today yet — creating fresh one + single session.");
    const created = await p.attendance.create({
      data: {
        userId: arpit.id, date: dateOnly,
        clockIn, clockOut: null, totalMinutes: 0, overtimeMinutes: 0,
        status: "present",
      },
    });
    await p.$executeRawUnsafe(
      `INSERT INTO "AttendanceSession" ("attendanceId","clockIn","clockOut","clockInLocation","clockOutLocation")
       VALUES ($1, $2, NULL, NULL, NULL)`,
      created.id, clockIn,
    );
    console.log(`✅ Created Attendance id=${created.id} with one open session at 08:00 IST.`);
    return;
  }

  console.log(`Found existing Attendance id=${existing.id}. Wiping its sessions…`);
  const wiped = await p.$executeRawUnsafe(
    `DELETE FROM "AttendanceSession" WHERE "attendanceId" = $1`,
    existing.id,
  );
  console.log(`  Deleted ${wiped} session row(s).`);

  await p.attendance.update({
    where: { id: existing.id },
    data: {
      clockIn,
      clockOut:        null,
      totalMinutes:    0,
      overtimeMinutes: 0,
      status:          "present",
    },
  });

  await p.$executeRawUnsafe(
    `INSERT INTO "AttendanceSession" ("attendanceId","clockIn","clockOut","clockInLocation","clockOutLocation")
     VALUES ($1, $2, NULL, NULL, NULL)`,
    existing.id, clockIn,
  );

  console.log(`✅ Reset Attendance id=${existing.id} → single open session at 08:00 IST.`);
  console.log(`   parent.clockIn  = ${clockIn.toISOString()} (UTC) = 08:00 IST`);
  console.log(`   parent.clockOut = NULL  (still clocked in)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => p.$disconnect());
