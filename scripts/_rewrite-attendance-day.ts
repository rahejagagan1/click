/**
 * Rewrite a user's Attendance row for a given day to a single clean
 * session: a specified clock-in time, a specified clock-out time, and
 * a location copied from another day's Attendance row.
 *
 * Used when the original record is messy (e.g. user clicked clock-
 * in/out rapidly and the day has 7 micro-sessions across 60 seconds).
 *
 *   npx tsx scripts/_rewrite-attendance-day.ts \
 *       <email> <YYYY-MM-DD target> <HH:MM in> <HH:MM out> <YYYY-MM-DD source>
 *     → dry-run.
 *   ... --commit  → writes.
 *
 * What it does, in one transaction (so the row + sessions stay
 * coherent):
 *   1. UPDATE Attendance.{clockIn, clockOut, location, totalMinutes}
 *   2. DELETE all rows in AttendanceSession for that attendanceId
 *   3. INSERT one new AttendanceSession with the new times +
 *      clockInLocation = clockOutLocation = source-day location
 *
 * Times are interpreted as Asia/Kolkata. Source location is taken
 * from source-day's Attendance.location (falls back to the first
 * session's clockInLocation if Attendance.location is null).
 *
 * Bypasses the regularization flow — no audit row written.
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const IST_OFFSET_MIN = 5 * 60 + 30;

function istHmToUtc(ymd: string, hm: string): Date {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, 0) - IST_OFFSET_MIN * 60_000);
}
function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fmtIst(dt: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(dt);
}

async function main() {
  const [, , email, targetYmd, hIn, hOut, sourceYmd] = process.argv;
  const commit = process.argv.includes("--commit");
  if (!email || !targetYmd || !hIn || !hOut || !sourceYmd) {
    console.error("Usage: npx tsx scripts/_rewrite-attendance-day.ts <email> <target YYYY-MM-DD> <HH:MM in> <HH:MM out> <source YYYY-MM-DD> [--commit]");
    process.exit(1);
  }

  const u = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true } });
  if (!u) { console.error(`✗ ${email} not found`); process.exit(1); }

  const srcDate = parseYmd(sourceYmd);
  const tgtDate = parseYmd(targetYmd);

  const src = await prisma.attendance.findUnique({
    where: { userId_date: { userId: u.id, date: srcDate } },
    select: { id: true, location: true },
  });
  if (!src) { console.error(`✗ No source-day Attendance for ${sourceYmd}`); process.exit(1); }

  // Pick canonical source location: Attendance.location first, fall back
  // to first session's clockInLocation.
  let sourceLoc: string | null = src.location ?? null;
  if (!sourceLoc) {
    const ss = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "clockInLocation" FROM "AttendanceSession"
         WHERE "attendanceId" = $1 ORDER BY "clockIn" ASC LIMIT 1`,
      src.id,
    );
    sourceLoc = ss[0]?.clockInLocation ?? null;
  }
  if (!sourceLoc) { console.error(`✗ Source day has no location to copy`); process.exit(1); }

  const tgt = await prisma.attendance.findUnique({
    where: { userId_date: { userId: u.id, date: tgtDate } },
    select: { id: true, clockIn: true, clockOut: true, totalMinutes: true, status: true, location: true },
  });
  if (!tgt) { console.error(`✗ No target-day Attendance for ${targetYmd} — refusing to fabricate.`); process.exit(1); }

  const tgtSessions = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, "clockIn", "clockOut" FROM "AttendanceSession"
       WHERE "attendanceId" = $1 ORDER BY "clockIn" ASC`,
    tgt.id,
  );

  const newClockIn  = istHmToUtc(targetYmd, hIn);
  const newClockOut = istHmToUtc(targetYmd, hOut);
  if (newClockOut.getTime() <= newClockIn.getTime()) {
    console.error(`✗ clock-out (${hOut}) must be after clock-in (${hIn})`);
    process.exit(1);
  }
  const newTotalMinutes = Math.round((newClockOut.getTime() - newClockIn.getTime()) / 60_000);

  console.log(`User: ${u.name} (id=${u.id})`);
  console.log(``);
  console.log(`Source location to copy (from ${sourceYmd}):`);
  console.log(`  ${sourceLoc}`);
  console.log(``);
  console.log(`TARGET (${targetYmd}, Attendance #${tgt.id}) BEFORE:`);
  console.log(`  clockIn       = ${tgt.clockIn?.toISOString()}  (IST: ${tgt.clockIn ? fmtIst(tgt.clockIn) : "—"})`);
  console.log(`  clockOut      = ${tgt.clockOut?.toISOString()} (IST: ${tgt.clockOut ? fmtIst(tgt.clockOut) : "—"})`);
  console.log(`  totalMinutes  = ${tgt.totalMinutes}`);
  console.log(`  status        = ${tgt.status}`);
  console.log(`  location      = ${tgt.location ?? "(null)"}`);
  console.log(`  Sessions: ${tgtSessions.length} (will be replaced with 1 clean session)`);
  console.log(``);
  console.log(`TARGET AFTER:`);
  console.log(`  clockIn       = ${newClockIn.toISOString()}  (IST: ${fmtIst(newClockIn)})`);
  console.log(`  clockOut      = ${newClockOut.toISOString()} (IST: ${fmtIst(newClockOut)})`);
  console.log(`  totalMinutes  = ${newTotalMinutes}  (${Math.floor(newTotalMinutes/60)}h ${newTotalMinutes%60}m)`);
  console.log(`  location      = ${sourceLoc}`);
  console.log(`  Sessions: 1 (clockIn/clockOutLocation = ${sourceLoc.slice(0, 60)}…)`);
  console.log(``);

  if (!commit) {
    console.log(`DRY RUN — re-run with --commit to apply.`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.attendance.update({
      where: { id: tgt.id },
      data: {
        clockIn: newClockIn,
        clockOut: newClockOut,
        totalMinutes: newTotalMinutes,
        location: sourceLoc,
      },
    });
    await tx.$executeRawUnsafe(
      `DELETE FROM "AttendanceSession" WHERE "attendanceId" = $1`,
      tgt.id,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO "AttendanceSession"
         ("attendanceId", "clockIn", "clockOut", "clockInLocation", "clockOutLocation")
       VALUES ($1, $2, $3, $4, $4)`,
      tgt.id, newClockIn, newClockOut, sourceLoc,
    );
  });
  console.log(`✓ Updated.`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
