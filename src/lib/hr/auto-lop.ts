// Auto-LOP cron: for each working day in the past SCAN_BACK_DAYS that has
// crossed its 48-hour grace, mark active users as Attendance.status="lop"
// when they have no Attendance row AND no pending/approved leave,
// regularization, WFH, OnDuty, or CompOff for that date.
//
// Grace timeline (IST): missed-day D → eligible at D+3 00:00 IST
//   (24h of D itself + 48h grace = 72h, so day D becomes processable any
//    time on/after the start of day D+3).
//
// Skips: HolidayCalendar dates, days not in the user's UserShift workDays,
// users whose joiningDate is after the date, users whose lastWorkingDay
// is before the date, and inactive users.
//
// Idempotent: Attendance has @@unique([userId, date]); createMany uses
// skipDuplicates so re-runs never double-insert.
//
// Feature start: days before FEATURE_START_DATE_ISO are NEVER LOP'd, even
// if missing — prevents retroactive LOP on first deploy.

import prisma from "@/lib/prisma";
import { istTodayDateOnly } from "@/lib/ist-date";
import { isWorkingDay } from "@/lib/hr/shift-working-days";
import { getPoliciesByUser } from "@/lib/hr/notification-policy";

// 48h grace + the day itself = 3 calendar days between "missed day" and
// "earliest cron run that may apply LOP".
const GRACE_DAYS = 3;
const SCAN_BACK_DAYS = 7;

// Bump only when intentionally enabling retroactive LOP for older missing days.
const FEATURE_START_DATE_ISO = "2026-05-29";

// Penalty for an UNREGULARIZED missed clock-out — a row that has a clockIn but
// never got a clockOut, and the user never regularized it within the grace
// window. Same 48h grace as a fully-missing day. HALF-day LOP for now; flip to
// "lop" here for a full-day penalty if policy changes later.
const MISSED_SWIPE_LOP_STATUS = "half_day_lop";

export type AutoLOPSummary = {
  datesScanned: number;
  usersInScope: number;
  lopApplied: number;
};

function addDaysUTC(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

function isoKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateOnlyUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function runAutoLOP(): Promise<AutoLOPSummary> {
  const today = istTodayDateOnly();
  const featureStart = new Date(`${FEATURE_START_DATE_ISO}T00:00:00.000Z`);

  const latestEligible   = addDaysUTC(today, -GRACE_DAYS);
  const earliestEligible = addDaysUTC(latestEligible, -(SCAN_BACK_DAYS - 1));
  const scanStart = earliestEligible.getTime() < featureStart.getTime()
    ? featureStart
    : earliestEligible;

  if (scanStart.getTime() > latestEligible.getTime()) {
    console.log("[auto-lop] no eligible dates yet (feature-start gating)");
    return { datesScanned: 0, usersInScope: 0, lopApplied: 0 };
  }

  // Build the inclusive [scanStart … latestEligible] date list.
  const dates: Date[] = [];
  for (
    let cur = new Date(scanStart);
    cur.getTime() <= latestEligible.getTime();
    cur = addDaysUTC(cur, 1)
  ) {
    dates.push(new Date(cur));
  }

  // Holidays in window — single query, set lookup per date.
  const holidays = await prisma.holidayCalendar.findMany({
    where: { date: { gte: scanStart, lte: latestEligible } },
    select: { date: true },
  });
  const holidaySet = new Set(holidays.map((h) => isoKey(h.date)));

  // Active users + the bits we need to gate eligibility.
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      employeeProfile: { select: { joiningDate: true } },
      employeeExit:    { select: { lastWorkingDay: true } },
    },
  });

  // Each user's shift rule: workDays + alternate-Saturday policy + the
  // effectiveFrom anchor (phase for "alternate" Saturdays). Read via raw SQL
  // so the new saturday* columns work before `prisma generate` picks them up.
  // Users with no shift are absent from the map → never auto-LOP'd (unchanged).
  const shiftRows = await prisma.$queryRawUnsafe<Array<{
    userId: number; effectiveFrom: Date; workDays: unknown; saturdayPolicy: string; saturdayWeeks: number[]; shiftCreatedAt: Date;
  }>>(
    `SELECT us."userId", us."effectiveFrom", s."workDays", s."saturdayPolicy", s."saturdayWeeks", s."createdAt" AS "shiftCreatedAt"
       FROM "UserShift" us JOIN "Shift" s ON s.id = us."shiftId"`,
  );
  const shiftByUser = new Map(shiftRows.map((r) => [r.userId, r]));

  // Exemption gate. Reads the SAME per-user policy that HR Dashboard →
  // Permissions → Payroll & Attendance writes (EmployeeNotificationPolicy),
  // plus the role defaults: defaultPolicyFor() returns attendanceEnabled =
  // payrollEnabled = false for CEOs and developers. A user is skipped from
  // auto-LOP when EITHER toggle is off — i.e. anyone HR has excluded from
  // payroll OR attendance, alongside CEOs/owners/devs (who don't punch a
  // clock). LOP only makes sense for people who are both tracked AND paid.
  const policies = await getPoliciesByUser(users.map((u) => u.id));

  // LWP (Leave Without Pay) type — LOP days are tracked against the user's
  // open-ended LWP "used" balance (row created on demand, totalDays stays 0)
  // so the Leave view reflects them. This is TRACKING ONLY: payroll still
  // deducts via the attendance lop / half_day_lop status, and no
  // LeaveApplication is created — so there is no double deduction.
  const lwpType = await prisma.leaveType.findUnique({ where: { code: "LWP" }, select: { id: true } });
  if (!lwpType) console.warn("[auto-lop] LWP leave type not found — LOP days will not be tracked against LWP balance.");
  async function addLwpUsage(userId: number, year: number, amount: number): Promise<void> {
    if (!lwpType) return;
    await prisma.leaveBalance.upsert({
      where:  { userId_leaveTypeId_year: { userId, leaveTypeId: lwpType.id, year } },
      create: { userId, leaveTypeId: lwpType.id, year, totalDays: 0, usedDays: amount, pendingDays: 0 },
      update: { usedDays: { increment: amount } },
    });
  }

  let datesScanned = 0;
  let lopApplied = 0;

  for (const date of dates) {
    datesScanned++;

    if (holidaySet.has(isoKey(date))) continue;

    // Pre-filter users to those for whom this date is in-scope.
    const eligibleUserIds: number[] = [];
    for (const u of users) {
      // Exempt CEOs, developers, and any user HR has switched off for payroll
      // OR attendance (HR Dashboard → Permissions → Payroll & Attendance).
      const pol = policies.get(u.id);
      if (pol && (pol.attendanceEnabled === false || pol.payrollEnabled === false)) continue;

      const join = u.employeeProfile?.joiningDate;
      if (!join) continue;
      if (dateOnlyUTC(join).getTime() > date.getTime()) continue;

      const lwd = u.employeeExit?.lastWorkingDay;
      if (lwd && dateOnlyUTC(lwd).getTime() < date.getTime()) continue;

      // Working-day decision respects the alternate-Saturday rule. No shift
      // → skip (unchanged: a user with no shift is never auto-LOP'd).
      const sr = shiftByUser.get(u.id);
      if (!sr || !Array.isArray(sr.workDays)) continue;
      // Alternate-Saturday phase is anchored on the SHIFT (createdAt) so it's
      // uniform for everyone on the shift — a mid-cycle joiner no longer gets
      // the opposite Saturdays. effectiveFrom stays as a fallback only.
      if (!isWorkingDay(date, { workDays: sr.workDays, saturdayPolicy: sr.saturdayPolicy, saturdayWeeks: sr.saturdayWeeks, createdAt: sr.shiftCreatedAt }, sr.effectiveFrom)) continue;

      eligibleUserIds.push(u.id);
    }

    if (eligibleUserIds.length === 0) continue;

    // Find users who already have a record / pending / approved request
    // covering this date — they are NOT LOP candidates.
    const PROTECTED_LEAVE_STATUSES        = ["pending", "partially_approved", "approved"];
    const PROTECTED_REG_STATUSES          = ["pending", "partially_approved", "approved"];
    const PROTECTED_SINGLE_STAGE_STATUSES = ["pending", "approved"];

    const [attendances, leaves, regs, wfhs, ods, compOffs] = await Promise.all([
      prisma.attendance.findMany({
        where: { userId: { in: eligibleUserIds }, date },
        select: { id: true, userId: true, status: true, isRegularized: true, totalMinutes: true },
      }),
      prisma.leaveApplication.findMany({
        where: {
          userId: { in: eligibleUserIds },
          fromDate: { lte: date },
          toDate:   { gte: date },
          status:   { in: PROTECTED_LEAVE_STATUSES },
        },
        select: { userId: true },
      }),
      prisma.attendanceRegularization.findMany({
        where: {
          userId: { in: eligibleUserIds },
          date,
          status: { in: PROTECTED_REG_STATUSES },
        },
        select: { userId: true },
      }),
      prisma.wFHRequest.findMany({
        where: {
          userId: { in: eligibleUserIds },
          date,
          status: { in: PROTECTED_SINGLE_STAGE_STATUSES },
        },
        // reason carries the [First Half] / [Second Half] marker for half-day WFH.
        select: { userId: true, reason: true },
      }),
      prisma.onDutyRequest.findMany({
        where: {
          userId: { in: eligibleUserIds },
          date,
          status: { in: PROTECTED_SINGLE_STAGE_STATUSES },
        },
        select: { userId: true },
      }),
      // CompOff: workedDate is the day they're claiming credit for. If a
      // user has a pending/approved comp-off saying "I worked on this day",
      // honour it — they're asserting attendance.
      prisma.compOffRequest.findMany({
        where: {
          userId: { in: eligibleUserIds },
          workedDate: date,
          status: { in: PROTECTED_SINGLE_STAGE_STATUSES },
        },
        select: { userId: true },
      }),
    ]);

    // Unregularized missed clock-outs: a row exists (so it's NOT a full-day
    // LOP / "absent" candidate), but the swipe was never completed and never
    // regularized in time → half-day-LOP candidates, handled below.
    const isUnregularizedMissedSwipe = (a: { status: string; isRegularized: boolean }) =>
      a.status === "missed_clock_out" && !a.isRegularized;
    const missedSwipeRows = attendances.filter(isUnregularizedMissedSwipe);
    const missedSwipeUserIds = new Set(missedSwipeRows.map((a) => a.userId));
    const attByUser = new Map(attendances.map((a) => [a.userId, a]));

    // ── WFH completion enforcement ──────────────────────────────────────
    // An approved WFH no longer BLANKET-shields from LOP. A WFH day must be
    // worked like any shift: full = 540 min (9h), half = 270 min (4.5h) — the
    // same 9h bar the attendance UI uses — with "half" detected from the
    // [First Half] / [Second Half] reason marker. Judged from worked minutes
    // (Attendance.totalMinutes): meet the bar → shielded (present); fall short
    // → LOP (full-day for a full WFH, half-day for a half WFH). A leave /
    // regularization / OD / comp-off on the same day still shields — they
    // weren't expected to work the WFH portion.
    const WFH_FULL_MIN = 540, WFH_HALF_MIN = 270;
    const otherwiseCovered = new Set<number>([
      ...leaves.map((r) => r.userId), ...regs.map((r) => r.userId),
      ...ods.map((r) => r.userId), ...compOffs.map((r) => r.userId),
    ]);
    const wfhMetIds = new Set<number>();
    const wfhFullLopIds = new Set<number>();
    const wfhHalfLopIds = new Set<number>();
    for (const w of wfhs) {
      if (otherwiseCovered.has(w.userId)) continue;
      const isHalf = /\[(?:first|second)\s+half\]/i.test(w.reason ?? "");
      const required = isHalf ? WFH_HALF_MIN : WFH_FULL_MIN;
      const worked = attByUser.get(w.userId)?.totalMinutes ?? 0;
      if (worked >= required) wfhMetIds.add(w.userId);
      else if (isHalf) wfhHalfLopIds.add(w.userId);
      else wfhFullLopIds.add(w.userId);
    }

    const protectedIds = new Set<number>();
    // Any attendance row EXCEPT an unregularized missed clock-out protects the
    // user (they were present / on leave / already settled). The missed-swipe
    // rows are intentionally left out so they can receive a half-day LOP.
    for (const r of attendances) if (!isUnregularizedMissedSwipe(r)) protectedIds.add(r.userId);
    for (const r of leaves)      protectedIds.add(r.userId);
    for (const r of regs)        protectedIds.add(r.userId);
    for (const r of ods)         protectedIds.add(r.userId);
    for (const r of compOffs)    protectedIds.add(r.userId);
    // WFH: completed → shielded; short → handled explicitly just below. Add ALL
    // WFH users to protectedIds so the generic missed-swipe / no-row LOP passes
    // never double-process (or double-charge LWP for) a WFH user.
    for (const id of wfhMetIds)     protectedIds.add(id);
    for (const id of wfhFullLopIds) protectedIds.add(id);
    for (const id of wfhHalfLopIds) protectedIds.add(id);

    // Apply WFH shortfalls. A short WFH user may already have a (present or
    // missed-swipe) row → UPDATE it; or no row (never clocked in) → CREATE it.
    // Idempotent: skip if the row is already at the target LOP status so a
    // re-run never re-charges LWP.
    const applyWfhLop = async (ids: Set<number>, status: string, lwp: number, why: string) => {
      for (const uid of ids) {
        const row = attByUser.get(uid);
        if (row?.status === status) continue;
        if (row) {
          await prisma.attendance.update({ where: { id: row.id }, data: { status, notes: why } });
        } else {
          await prisma.attendance.create({ data: { userId: uid, date, status, totalMinutes: 0, notes: why } });
        }
        await addLwpUsage(uid, date.getUTCFullYear(), lwp);
        lopApplied++;
      }
    };
    await applyWfhLop(wfhFullLopIds, "lop", 1, "Auto-LOP: approved full-day WFH not completed (worked < 9h).");
    await applyWfhLop(wfhHalfLopIds, "half_day_lop", 0.5, "Auto-LOP: approved half-day WFH not completed (worked < 4.5h).");

    // Half-day LOP: unregularized missed clock-outs not otherwise covered by a
    // pending/approved leave / regularization / WFH / OD / comp-off. (A pending
    // regularization means the user DID act in time → protectedIds excludes it.)
    const toHalfDayLop = missedSwipeRows.filter((a) => !protectedIds.has(a.userId));
    if (toHalfDayLop.length > 0) {
      const upd = await prisma.attendance.updateMany({
        where: { id: { in: toHalfDayLop.map((a) => a.id) } },
        data: {
          status: MISSED_SWIPE_LOP_STATUS,
          notes: "Auto-marked half-day LOP: missed clock-out not regularized within the 48h grace window.",
        },
      });
      lopApplied += upd.count;
      // Track 0.5 LWP per half-day LOP. These rows are transitioning out of
      // "missed_clock_out" this run, so each is counted exactly once.
      for (const a of toHalfDayLop) await addLwpUsage(a.userId, date.getUTCFullYear(), 0.5);
      console.log(`[auto-lop] ${isoKey(date)}: ${upd.count} missed clock-outs → ${MISSED_SWIPE_LOP_STATUS}`);
    }

    // Full-day LOP candidates: eligible users with NO row at all (excludes the
    // missed-swipe users, who get the half-day penalty above instead).
    const toLop = eligibleUserIds.filter((id) => !protectedIds.has(id) && !missedSwipeUserIds.has(id));
    if (toLop.length === 0) continue;

    const result = await prisma.attendance.createMany({
      data: toLop.map((userId) => ({
        userId,
        date,
        status: "lop",
        totalMinutes: 0,
        notes:
          "Auto-marked LOP after 48h grace (no attendance, leave, regularization, WFH, OD, or comp-off).",
      })),
      skipDuplicates: true,
    });

    lopApplied += result.count;
    // Track 1.0 LWP per full-day LOP. toLop only contains users with no row
    // for this date, so each newly-created LOP is counted exactly once.
    for (const userId of toLop) await addLwpUsage(userId, date.getUTCFullYear(), 1);
    console.log(
      `[auto-lop] ${isoKey(date)}: ${result.count}/${toLop.length} marked LOP`,
    );
  }

  console.log(
    `[auto-lop] done: ${datesScanned} dates, ${users.length} active users, ${lopApplied} LOPs applied`,
  );
  return { datesScanned, usersInScope: users.length, lopApplied };
}
