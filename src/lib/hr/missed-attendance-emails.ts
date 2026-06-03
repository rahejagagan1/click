import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email/sender";
import { attendanceReminderEmail, hrLateSummaryEmail } from "@/lib/email/templates";
import { istTodayDateOnly, istTimeOnDate } from "@/lib/ist-date";
import { getPoliciesByUser } from "@/lib/hr/notification-policy";
import { isEmailEnabled, devEmailRecipientsClause } from "@/lib/email/toggles";

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
 * Find every active user who has NOT clocked in for today (IST) AND has
 * NOT applied for leave for today — then nudge each of them. WFH / OD
 * users still need to clock in (they're working, just from elsewhere),
 * so those statuses don't shield from the reminder anymore. Only an
 * actual leave application keeps a user out of the list.
 *
 * Returns the number of emails actually sent.
 *
 * Skip rules (in order — earliest exit wins):
 *   1. Today is Saturday / Sunday → 0 emails.
 *   2. Today is in HolidayCalendar → 0 emails.
 *   3. Per-user filters:
 *      • Already clocked in today.
 *      • Has ANY leave application covering today, in any status that
 *        isn't rejected/cancelled (pending counts — if they bothered to
 *        apply, don't nag them while HR is still reviewing it).
 *      • No email on file.
 *      • In EMAIL_REMINDER_EXCLUDE_EMAILS env list.
 */
export async function sendMissedClockInReminders(): Promise<number> {
  // Admin-controllable kill-switch (Admin → Emails Automation). Same
  // toggle gates clock-in nudges, the HR late summary, and clock-out
  // nudges below — they're a single "missed-attendance" surface.
  if (!(await isEmailEnabled("missed_attendance"))) {
    console.log("[missed-attendance] clock-in reminders skipped — disabled in admin toggles");
    return 0;
  }
  const today = istTodayDateOnly();

  // 0. Weekend gate (Mon–Fri only). UTC day-of-week is identical to
  //    IST day-of-week here because `today` is UTC-midnight of the
  //    IST calendar day, so 0 = Sun, 6 = Sat in IST too.
  const dow = new Date(today).getUTCDay();
  if (dow === 0 || dow === 6) return 0;

  // 1. Active users.
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true },
  });

  // 2. Pull today's attendance + leave + holiday in bulk so we don't
  //    fire one query per user. WFH / OD are intentionally NOT in this
  //    set — those folks are working, just remotely / off-site, and the
  //    org policy is they must still record a clock-in. The reminder
  //    therefore goes to them too if they forget.
  const [todays, leaves, holidayHit] = await Promise.all([
    prisma.attendance.findMany({
      where: { date: today, clockIn: { not: null } },
      select: { userId: true },
    }),
    prisma.leaveApplication.findMany({
      where: {
        status:   { notIn: ["rejected", "cancelled"] },
        fromDate: { lte: today },
        toDate:   { gte: today },
      },
      select: { userId: true },
    }),
    prisma.holidayCalendar.findFirst({ where: { date: today }, select: { id: true } }),
  ]);

  // No emails on a public holiday — nobody's expected to clock in.
  if (holidayHit) return 0;

  const clockedInIds = new Set(todays.map(a => a.userId));
  const onLeaveIds   = new Set(leaves.map(l => l.userId));
  const excluded     = reminderExclusionSet();

  // Per-user attendance gate. CEO + developers default OFF and so are
  // skipped automatically; HR can override per employee via the Payroll
  // & Attendance toggles page.
  const policies = await getPoliciesByUser(users.map((u) => u.id));

  const candidates = users.filter(u =>
    !clockedInIds.has(u.id)
    && !onLeaveIds.has(u.id)
    && !!u.email
    && !excluded.has(u.email.toLowerCase())
    && (policies.get(u.id)?.attendanceEnabled !== false)
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
 * Builds and sends ONE consolidated email to the HR admin tier listing
 * everyone who, by 10:05 IST, either:
 *   • didn't clock in AND didn't apply for leave (WFH / OD don't shield —
 *     those folks are expected to clock in too), or
 *   • clocked in AFTER 10:00 IST (late).
 *
 * Returns 1 when an email was sent, 0 when there's nothing to report
 * (or it's a weekend / holiday — same skip rules as the employee mail).
 *
 * Recipients: every active user in the HR admin tier — CEO, developers
 * (DEVELOPER_EMAILS env), orgLevel=special_access, role=admin,
 * orgLevel=hr_manager, role=hr_manager. Mirrors the gate used in the
 * rest of the HR module.
 */
export async function sendHrLateClockInSummary(): Promise<number> {
  if (!(await isEmailEnabled("missed_attendance"))) {
    console.log("[missed-attendance] HR late summary skipped — disabled in admin toggles");
    return 0;
  }
  const today = istTodayDateOnly();
  const dow = new Date(today).getUTCDay();
  if (dow === 0 || dow === 6) return 0;

  const holidayHit = await prisma.holidayCalendar.findFirst({ where: { date: today } });
  if (holidayHit) return 0;

  // 10:00 IST as a UTC instant for the chosen IST calendar day — anything
  // strictly past this is "late."
  const tenAmIst = istTimeOnDate(today, 10, 0);

  const [users, todays, leaves] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, email: true, managerId: true,
        employeeProfile: { select: { department: true, businessUnit: true } },
      },
    }),
    prisma.attendance.findMany({
      where: { date: today },
      select: { userId: true, clockIn: true },
    }),
    prisma.leaveApplication.findMany({
      where: {
        status:   { notIn: ["rejected", "cancelled"] },
        fromDate: { lte: today },
        toDate:   { gte: today },
      },
      select: { userId: true },
    }),
  ]);

  const attByUser  = new Map(todays.map((a) => [a.userId, a]));
  const onLeaveIds = new Set(leaves.map((l) => l.userId));
  const excluded   = reminderExclusionSet();
  // Skip anyone whose Attendance toggle is OFF — they're "off the books"
  // for attendance (CEO + developers default OFF). HR shouldn't be told
  // the CEO is absent.
  const policies = await getPoliciesByUser(users.map((u) => u.id));

  type Row = {
    userId: number; managerId: number | null; businessUnit: string;
    name: string; department: string | null; status: "absent" | "late";
    clockIn: Date | null;
  };
  const absent: Row[] = [];
  const late:   Row[] = [];

  // Bucket NULL businessUnit as NB Media — matches the parent-brand
  // fallback used everywhere else.
  const buOf = (u: typeof users[number]): string => u.employeeProfile?.businessUnit || "NB Media";

  for (const u of users) {
    if (!u.email || excluded.has(u.email.toLowerCase())) continue;
    if (onLeaveIds.has(u.id)) continue;
    if (policies.get(u.id)?.attendanceEnabled === false) continue;
    const rec = attByUser.get(u.id);
    if (!rec?.clockIn) {
      absent.push({ userId: u.id, managerId: u.managerId, businessUnit: buOf(u), name: u.name, department: u.employeeProfile?.department ?? null, status: "absent", clockIn: null });
      continue;
    }
    if (rec.clockIn.getTime() > tenAmIst.getTime()) {
      late.push({ userId: u.id, managerId: u.managerId, businessUnit: buOf(u), name: u.name, department: u.employeeProfile?.department ?? null, status: "late", clockIn: rec.clockIn });
    }
  }

  if (absent.length === 0 && late.length === 0) return 0;

  absent.sort((a, b) => a.name.localeCompare(b.name));
  late.sort((a, b) => (a.clockIn!.getTime() - b.clockIn!.getTime()));

  // Recipients: Special Access + HR Manager (role).
  // EXCLUDED: the CEO (top-level NOT — the CEO/owner account also carries
  // role="admin"), who instead gets a separate digest of ONLY their own
  // direct reports below. Also excluded: role=admin alone, orgLevel=
  // "hr_manager" alone (HR-team members are role=member). Developer
  // accounts are conditional on the "Notify developers" toggle.
  const recipients = await prisma.user.findMany({
    where: {
      isActive: true,
      orgLevel: { not: "ceo" },
      OR: [
        { orgLevel: "special_access" },
        { role:     "hr_manager" },
        ...(await devEmailRecipientsClause()),
      ],
    },
    select: { email: true, name: true, orgLevel: true, role: true },
  });
  // Per-role email-toggle filter (Admin → Emails Automation →
  // "Recipients by role"). Drops anyone whose role override for
  // missed_attendance is OFF.
  const { rolesForUser, isEmailEnabledForRoles } = await import("@/lib/email/toggles");
  const filteredRecipients: typeof recipients = [];
  for (const r of recipients) {
    if (!r.email) continue;
    const roles = rolesForUser({ orgLevel: r.orgLevel, role: r.role });
    if (await isEmailEnabledForRoles("missed_attendance", roles)) filteredRecipients.push(r);
  }

  // Headcount totals for the footer. WFH/OD are now folded into present/
  // late/absent based on whether they actually clocked in, so the only
  // separate bucket left is leave.
  const totalCandidates = users.filter((u) => !!u.email && !excluded.has(u.email!.toLowerCase()) && !onLeaveIds.has(u.id)).length;
  const onTime = Math.max(0, totalCandidates - absent.length - late.length);

  const content = hrLateSummaryEmail({
    today,
    absent,
    late,
    totals: {
      absent:  absent.length,
      late:    late.length,
      onTime,
      onLeave: onLeaveIds.size,
    },
  });

  let sent = 0;
  for (const r of filteredRecipients) {
    try {
      await sendEmail({ to: r.email!, content });
      sent++;
    } catch (e) {
      console.error(`[hr-late-summary] ${r.email}:`, e);
    }
  }

  // CEO digest — brand-scoped: each CEO sees their full brand's
  // late/absent roster (not just their direct reports). Kunal gets
  // every YT Labs employee's status, Nikit gets every NB Media one.
  // Still skipped when the brand's roster is all-present that day.
  //
  // This loop is the DIRECT-MANAGER exemption equivalent — always
  // sent regardless of the per-role "ceo" toggle, because the toggle
  // silences only the ORG-WIDE blanket fan-out, not the brand-CEO's
  // signal about their own brand.
  const ceos = await prisma.user.findMany({
    where:  { isActive: true, orgLevel: "ceo" },
    select: {
      id: true, email: true,
      employeeProfile: { select: { businessUnit: true } },
    },
  });
  for (const ceo of ceos) {
    if (!ceo.email) continue;
    const ceoBrand = ceo.employeeProfile?.businessUnit || "NB Media";
    const ceoAbsent = absent.filter((r) => r.businessUnit === ceoBrand);
    const ceoLate   = late.filter((r) => r.businessUnit === ceoBrand);
    if (ceoAbsent.length === 0 && ceoLate.length === 0) continue;
    // Per-brand denominators for the on-time / on-leave totals.
    const ceoCandidates = users.filter((u) =>
      buOf(u) === ceoBrand && !!u.email && !excluded.has(u.email!.toLowerCase()) && !onLeaveIds.has(u.id),
    ).length;
    const ceoOnLeave = users.filter((u) => buOf(u) === ceoBrand && onLeaveIds.has(u.id)).length;
    const ceoOnTime  = Math.max(0, ceoCandidates - ceoAbsent.length - ceoLate.length);
    const ceoContent = hrLateSummaryEmail({
      today,
      absent: ceoAbsent,
      late:   ceoLate,
      totals: { absent: ceoAbsent.length, late: ceoLate.length, onTime: ceoOnTime, onLeave: ceoOnLeave },
    });
    try {
      await sendEmail({ to: ceo.email, content: ceoContent });
      sent++;
    } catch (e) {
      console.error(`[hr-late-summary] CEO ${ceo.email}:`, e);
    }
  }

  if (recipients.length === 0 && ceos.length === 0) {
    console.warn("[hr-late-summary] No recipients found — nothing sent.");
  }
  return sent > 0 ? 1 : 0;
}

/**
 * Find users who clocked in today but haven't clocked out, and email
 * each of them. Skips weekends/holidays implicitly (no clock-in row).
 */
export async function sendMissedClockOutReminders(): Promise<number> {
  if (!(await isEmailEnabled("missed_attendance"))) {
    console.log("[missed-attendance] clock-out reminders skipped — disabled in admin toggles");
    return 0;
  }
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
  const policies = await getPoliciesByUser(rows.map((r) => r.userId));
  let sent = 0;
  for (const r of rows) {
    if (!r.user?.isActive || !r.user?.email) continue;
    if (excluded.has(r.user.email.toLowerCase())) continue;
    if (policies.get(r.userId)?.attendanceEnabled === false) continue;
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
