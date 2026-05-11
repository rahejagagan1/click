/**
 * Set the FIRST clock-in time of a given day to a specific
 * IST hh:mm. Updates both:
 *   • Attendance.clockIn (per-day "first clock-in" timestamp)
 *   • AttendanceSession[0].clockIn (first session of the day)
 *
 * Usage:
 *   npx tsx scripts/_set-clockin-time.ts <email> <YYYY-MM-DD> <HH:MM>
 *     → dry-run.
 *   npx tsx scripts/_set-clockin-time.ts <email> <YYYY-MM-DD> <HH:MM> --commit
 *     → writes.
 *
 * Time is interpreted as Asia/Kolkata (IST, UTC+5:30) — IST is what
 * the UI shows and what HR speaks in. We convert to UTC before
 * writing to the @db.Timestamp / DateTime columns.
 *
 * Guardrails:
 *   • Aborts if the new clock-in would land AFTER the existing
 *     clock-out (would create a negative-duration session).
 *   • Aborts if there's no Attendance row / session for that day.
 *   • This bypasses the regularization flow — no audit row is
 *     written. Direct edit only when the intent is clear.
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

type SessRow = {
  id: number;
  clockIn: Date;
  clockOut: Date | null;
};

const IST_OFFSET_MIN = 5 * 60 + 30;

function istHmToUtc(ymd: string, hm: string): Date {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  // Build the IST wall-clock instant in UTC: subtract IST offset.
  return new Date(Date.UTC(y, mo - 1, d, h, mi, 0) - IST_OFFSET_MIN * 60_000);
}

function fmtIst(dt: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(dt);
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

async function main() {
  const [, , email, dayYmd, hm] = process.argv;
  const commit = process.argv.includes("--commit");

  if (!email || !dayYmd || !hm) {
    console.error("Usage: npx tsx scripts/_set-clockin-time.ts <email> <YYYY-MM-DD> <HH:MM> [--commit]");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true },
  });
  if (!user) { console.error(`✗ User '${email}' not found`); process.exit(1); }

  const day = parseYmd(dayYmd);
  const newClockInUtc = istHmToUtc(dayYmd, hm);

  const att = await prisma.attendance.findUnique({
    where: { userId_date: { userId: user.id, date: day } },
    select: { id: true, clockIn: true, clockOut: true, totalMinutes: true, location: true },
  });
  if (!att) { console.error(`✗ No Attendance row for ${email} on ${dayYmd}`); process.exit(1); }

  const sessions = await prisma.$queryRawUnsafe<SessRow[]>(
    `SELECT id, "clockIn", "clockOut" FROM "AttendanceSession"
       WHERE "attendanceId" = $1 ORDER BY "clockIn" ASC`,
    att.id,
  );
  const first = sessions[0];

  console.log(`User: ${user.name} <${user.email}> (id=${user.id})`);
  console.log(`Day:  ${dayYmd}`);
  console.log(``);
  console.log(`Current Attendance #${att.id}:`);
  console.log(`  clockIn  = ${att.clockIn?.toISOString()}  (IST: ${att.clockIn ? fmtIst(att.clockIn) : "—"})`);
  console.log(`  clockOut = ${att.clockOut?.toISOString() ?? "(null)"}  (IST: ${att.clockOut ? fmtIst(att.clockOut) : "—"})`);
  console.log(`  totalMinutes = ${att.totalMinutes}`);
  console.log(`  Sessions: ${sessions.length}`);
  sessions.forEach((s, i) => {
    console.log(`    [${i}] sess#${s.id}  in=${s.clockIn.toISOString()} (${fmtIst(s.clockIn)})  out=${s.clockOut?.toISOString() ?? "(null)"}${s.clockOut ? ` (${fmtIst(s.clockOut)})` : ""}`);
  });
  console.log(``);
  console.log(`New clock-in target: ${newClockInUtc.toISOString()}  (IST: ${fmtIst(newClockInUtc)})`);
  console.log(``);

  // Guardrail 1: must have a first session.
  if (!first) {
    console.error("✗ No sessions on this Attendance row — refusing to fabricate one.");
    process.exit(1);
  }

  // Guardrail 2: new clock-in mustn't land after the first session's clock-out.
  if (first.clockOut && newClockInUtc.getTime() >= first.clockOut.getTime()) {
    console.error(`✗ New clock-in (${fmtIst(newClockInUtc)}) is at/after session #${first.id}'s clock-out (${fmtIst(first.clockOut)}).`);
    console.error(`  That would make session duration zero or negative — refusing.`);
    process.exit(1);
  }

  // Guardrail 3: warn if new clock-in is after Attendance.clockOut (full-day close).
  if (att.clockOut && newClockInUtc.getTime() >= att.clockOut.getTime()) {
    console.error(`✗ New clock-in is at/after the day's clockOut — refusing.`);
    process.exit(1);
  }

  // Recompute totalMinutes if the first session's duration changes:
  // delta = (oldFirstSessionStart - newFirstSessionStart) added to minutes.
  // If the first session is closed, its duration grows by the delta.
  // If the first session is still open (no clockOut yet), totalMinutes
  // doesn't include it, so leave it alone.
  let newTotalMinutes: number | null = null;
  if (first.clockOut) {
    const oldDurMs = first.clockOut.getTime() - first.clockIn.getTime();
    const newDurMs = first.clockOut.getTime() - newClockInUtc.getTime();
    const deltaMin = Math.round((newDurMs - oldDurMs) / 60_000);
    newTotalMinutes = att.totalMinutes + deltaMin;
    if (newTotalMinutes < 0) newTotalMinutes = 0;
  }

  if (!commit) {
    console.log(`DRY RUN — would update:`);
    console.log(`  Attendance #${att.id}.clockIn:           ${att.clockIn?.toISOString()} → ${newClockInUtc.toISOString()}`);
    console.log(`  AttendanceSession #${first.id}.clockIn:  ${first.clockIn.toISOString()} → ${newClockInUtc.toISOString()}`);
    if (newTotalMinutes !== null) {
      console.log(`  Attendance #${att.id}.totalMinutes:      ${att.totalMinutes} → ${newTotalMinutes}`);
    }
    console.log(``);
    console.log(`Re-run with --commit to apply.`);
    return;
  }

  await prisma.attendance.update({
    where: { id: att.id },
    data: {
      clockIn: newClockInUtc,
      ...(newTotalMinutes !== null ? { totalMinutes: newTotalMinutes } : {}),
    },
  });
  await prisma.$executeRawUnsafe(
    `UPDATE "AttendanceSession" SET "clockIn" = $1 WHERE id = $2`,
    newClockInUtc,
    first.id,
  );
  console.log(`✓ Updated.`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
