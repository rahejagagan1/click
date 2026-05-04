import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email/sender";
import { attendanceReminderEmail } from "@/lib/email/templates";
import { istTodayDateOnly } from "@/lib/ist-date";

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

  const candidates = users.filter(u =>
    !clockedInIds.has(u.id)
    && !onLeaveIds.has(u.id)
    && !onWfhIds.has(u.id)
    && !onDutyIds.has(u.id)
    && !!u.email
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

  let sent = 0;
  for (const r of rows) {
    if (!r.user?.isActive || !r.user?.email) continue;
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
