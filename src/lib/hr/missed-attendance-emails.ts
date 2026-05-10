import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email/sender";
import { attendanceReminderEmail } from "@/lib/email/templates";
import { istTodayDateOnly } from "@/lib/ist-date";

/**
 * Comma-separated env var of emails who should never receive attendance
 * reminders (e.g. interns the team has already excused, contract folks
 * on a different schedule). Resolved per-call so a .env change reflects
 * on the next cron tick without restart, but cached as a Set for O(1)
 * lookups within a single run.
 */
function reminderExclusionSet(): Set<string> {
  const raw = process.env.EMAIL_REMINDER_EXCLUDE_EMAILS || "";
  return new Set(
    raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
}

/**
 * Find every active user who has NOT clocked in for today (IST), is NOT
 * on approved leave, and was NOT marked as a holiday — then send each of
 * them a reminder email. Idempotent at the DB level (just SELECTs +
 * sends), so calling twice in the same minute will resend; the scheduler
 * is responsible for once-per-day gating via the cron-jobs config.
 *
 * Returns the number of emails actually sent.
 */
export async function sendMissedClockInReminders(): Promise<number> {
  const today = istTodayDateOnly();

  // 1. Active users.
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true },
  });

  // 2. Pull today's attendance + approved leave / WFH / OD + holiday
  //    in bulk so we don't fire one query per user. The email body
  //    explicitly mentions WFH / OD as valid alternatives — if the
  //    user already filed and got those approved, we mustn't nag.
  const [todays, leaves, wfh, onDuty, holidayHit] = await Promise.all([
    prisma.attendance.findMany({
      where: { date: today, clockIn: { not: null } },
      select: { userId: true },
    }),
    prisma.leaveApplication.findMany({
      where: {
        status: "approved",
        fromDate: { lte: today },
        toDate:   { gte: today },
      },
      select: { userId: true },
    }),
    prisma.wFHRequest.findMany({
      where: { status: "approved", date: today },
      select: { userId: true },
    }),
    prisma.onDutyRequest.findMany({
      where: { status: "approved", date: today },
      select: { userId: true },
    }),
    prisma.holidayCalendar.findFirst({ where: { date: today }, select: { id: true } }),
  ]);

  // No emails on a public holiday — nobody's expected to clock in.
  if (holidayHit) return 0;

  const clockedInIds = new Set(todays.map(a => a.userId));
  const onLeaveIds   = new Set(leaves.map(l => l.userId));
  const onWfhIds     = new Set(wfh.map(w => w.userId));
  const onDutyIds    = new Set(onDuty.map(o => o.userId));
  const excluded     = reminderExclusionSet();

  const candidates = users.filter(u =>
    !clockedInIds.has(u.id)
    && !onLeaveIds.has(u.id)
    && !onWfhIds.has(u.id)
    && !onDutyIds.has(u.id)
    && !!u.email
    && !excluded.has(u.email.toLowerCase())
  );

  let sent = 0;
  for (const u of candidates) {
    try {
      const content = attendanceReminderEmail({ userName: u.name, kind: "clock-in" });
      await sendEmail({ to: u.email, content });
      sent++;
    } catch (e) {
      console.error(`[missed-clockin] ${u.email}:`, e);
    }
  }
  return sent;
}

/**
 * Find users who clocked in today but haven't clocked out, and email
 * each of them. Skips weekends/holidays implicitly (no clock-in row).
 */
export async function sendMissedClockOutReminders(): Promise<number> {
  const today = istTodayDateOnly();

  const rows = await prisma.attendance.findMany({
    where: {
      date:     today,
      clockIn:  { not: null },
      clockOut: null,
    },
    include: {
      user: { select: { id: true, name: true, email: true, isActive: true } },
    },
  });

  const excluded = reminderExclusionSet();
  let sent = 0;
  for (const r of rows) {
    if (!r.user?.isActive || !r.user?.email) continue;
    if (excluded.has(r.user.email.toLowerCase())) continue;
    try {
      const content = attendanceReminderEmail({ userName: r.user.name, kind: "clock-out" });
      await sendEmail({ to: r.user.email, content });
      sent++;
    } catch (e) {
      console.error(`[missed-clockout] ${r.user.email}:`, e);
    }
  }
  return sent;
}
