/**
 * Copy a previous day's clock-in location onto today's clock-in
 * for a specific user. Updates BOTH the per-day row
 * (Attendance.location) and the per-session row
 * (AttendanceSession.clockInLocation) so the UI shows the copied
 * value everywhere it reads location.
 *
 *   npx tsx scripts/_copy-clockin-location.ts <email> <YYYY-MM-DD source> <YYYY-MM-DD target>
 *     → dry-run: prints source / target / what would change.
 *
 *   npx tsx scripts/_copy-clockin-location.ts <email> <src> <tgt> --commit
 *     → actually writes the update.
 *
 * Notes:
 *   • Source location is taken from the FIRST session of the source
 *     day (chronologically). Falls back to Attendance.location if no
 *     sessions exist for that day.
 *   • Target update writes to: Attendance.location for that day, plus
 *     the FIRST session of the target day. Other sessions on the
 *     target day are NOT touched (they may legitimately be from
 *     different physical locations).
 *   • This bypasses the regularization flow — no audit row is
 *     written. Only run this when the intent is genuinely to copy
 *     a location, not to amend the official record.
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

type SessRow = {
  id: number;
  clockIn: Date;
  clockOut: Date | null;
  clockInLocation: string | null;
  clockOutLocation: string | null;
};

function parseYmd(s: string): Date {
  // Treat as a UTC midnight Date — matches @db.Date semantics where
  // Postgres stores a calendar day with no timezone.
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

async function main() {
  const [, , email, sourceYmd, targetYmd] = process.argv;
  const commit = process.argv.includes("--commit");

  if (!email || !sourceYmd || !targetYmd) {
    console.error("Usage: npx tsx scripts/_copy-clockin-location.ts <email> <YYYY-MM-DD source> <YYYY-MM-DD target> [--commit]");
    process.exit(1);
  }

  const sourceDate = parseYmd(sourceYmd);
  const targetDate = parseYmd(targetYmd);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true },
  });
  if (!user) {
    console.error(`✗ User '${email}' not found`);
    process.exit(1);
  }

  const source = await prisma.attendance.findUnique({
    where: { userId_date: { userId: user.id, date: sourceDate } },
    select: { id: true, location: true, date: true, clockIn: true, clockOut: true },
  });
  if (!source) {
    console.error(`✗ No Attendance row for ${email} on ${sourceYmd}`);
    process.exit(1);
  }

  const target = await prisma.attendance.findUnique({
    where: { userId_date: { userId: user.id, date: targetDate } },
    select: { id: true, location: true, date: true, clockIn: true, clockOut: true },
  });
  if (!target) {
    console.error(`✗ No Attendance row for ${email} on ${targetYmd}`);
    process.exit(1);
  }

  const sourceSessions = await prisma.$queryRawUnsafe<SessRow[]>(
    `SELECT id, "clockIn", "clockOut", "clockInLocation", "clockOutLocation"
       FROM "AttendanceSession"
      WHERE "attendanceId" = $1
      ORDER BY "clockIn" ASC`,
    source.id,
  );
  const targetSessions = await prisma.$queryRawUnsafe<SessRow[]>(
    `SELECT id, "clockIn", "clockOut", "clockInLocation", "clockOutLocation"
       FROM "AttendanceSession"
      WHERE "attendanceId" = $1
      ORDER BY "clockIn" ASC`,
    target.id,
  );

  // The "canonical" source location is the first session's clockInLocation;
  // fall back to Attendance.location (which the legacy single-clock-in path
  // populated) if no sessions exist for the source day.
  const newLoc = sourceSessions[0]?.clockInLocation ?? source.location;
  if (!newLoc) {
    console.error(`✗ Source day ${sourceYmd} has no clock-in location to copy`);
    process.exit(1);
  }

  console.log(`User: ${user.name} <${user.email}> (id=${user.id})`);
  console.log(``);
  console.log(`SOURCE (${sourceYmd}, Attendance #${source.id}):`);
  console.log(`  Attendance.location           = ${source.location ?? "(null)"}`);
  console.log(`  Sessions: ${sourceSessions.length}`);
  sourceSessions.forEach((s, i) => {
    console.log(`    [${i}] sess#${s.id}  clockIn=${s.clockIn.toISOString()}  clockInLocation=${s.clockInLocation ?? "(null)"}`);
  });
  console.log(``);
  console.log(`TARGET (${targetYmd}, Attendance #${target.id}):`);
  console.log(`  Attendance.location           = ${target.location ?? "(null)"}`);
  console.log(`  Sessions: ${targetSessions.length}`);
  targetSessions.forEach((s, i) => {
    console.log(`    [${i}] sess#${s.id}  clockIn=${s.clockIn.toISOString()}  clockInLocation=${s.clockInLocation ?? "(null)"}`);
  });
  console.log(``);
  console.log(`Will copy → ${newLoc}`);
  console.log(``);

  if (!commit) {
    console.log("DRY RUN — would update:");
    console.log(`  Attendance #${target.id}.location: ${target.location ?? "(null)"} → ${newLoc}`);
    if (targetSessions[0]) {
      console.log(`  AttendanceSession #${targetSessions[0].id}.clockInLocation: ${targetSessions[0].clockInLocation ?? "(null)"} → ${newLoc}`);
    } else {
      console.log(`  (no target session — only Attendance.location would be updated)`);
    }
    console.log(``);
    console.log("Re-run with --commit to apply.");
    return;
  }

  await prisma.attendance.update({
    where: { id: target.id },
    data: { location: newLoc },
  });
  if (targetSessions[0]) {
    await prisma.$executeRawUnsafe(
      `UPDATE "AttendanceSession" SET "clockInLocation" = $1 WHERE id = $2`,
      newLoc,
      targetSessions[0].id,
    );
  }
  console.log(`✓ Updated.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
