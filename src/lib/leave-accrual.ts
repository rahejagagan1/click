// Monthly leave accrual.
//
// Policy-driven: each user is assigned to a LeavePolicy, which has entries
// per LeaveType specifying monthlyAccrual (in addition to lump-sum
// daysPerYear granted by "Apply policy"). On accrual, every active entry
// with monthlyAccrual > 0 credits the user's matching LeaveBalance row
// for the current year by `months * monthlyAccrual`.
//
// Idempotent: stamps `lastAccrualMonth` (YYYY-MM) on each LeaveBalance row
// after crediting. Re-runs in the same month are no-ops. New rows seeded
// without a lastAccrualMonth get the current month stamped so they don't
// accrue retroactively — their first credit happens next month.

import prisma from "@/lib/prisma";
import { istTodayDateOnly } from "@/lib/ist-date";
import { reconcileConversionLeaveForUser } from "@/lib/hr/conversion-leave";

function ymKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Inclusive count of YYYY-MM steps from `from` (exclusive) up to `to`
// (inclusive). e.g. 2026-01 → 2026-04 = 3 increments.
function monthsBetween(fromYm: string | null, toYm: string): number {
  if (!fromYm) return 0;
  const [fy, fm] = fromYm.split("-").map((s) => parseInt(s, 10));
  const [ty, tm] = toYm.split("-").map((s) => parseInt(s, 10));
  return Math.max(0, (ty - fy) * 12 + (tm - fm));
}

/**
 * Run accrual for one user. Safe to call from API routes — fire-and-forget
 * style. Returns the number of monthly credits applied (0 if nothing changed).
 *
 * Reads the user's LeavePolicy.entries to decide which leave types accrue
 * and by how much per month. Users without a policy (leavePolicyId IS NULL)
 * skip accrual entirely — HR manages their balances by hand.
 */
export async function accrueLeavesForUser(userId: number): Promise<number> {
  const now = new Date();
  const currentYm = ymKey(now);
  const year = istTodayDateOnly().getUTCFullYear();

  // Intern/probation → regular conversion FIRST: if this user's internship or
  // probation has completed but they're still on the Intern Leave Plan (no CL),
  // move them to the regular policy and seed the completion-month CL (full if
  // the end date is on/before the 15th, else half). Runs before the policy read
  // below so the freshly-switched policy's CL entry is picked up and the months
  // after the completion month accrue in the same pass. Fail-safe — a hiccup
  // here must never block the normal accrual. See lib/hr/conversion-leave.
  await reconcileConversionLeaveForUser(userId, currentYm, year).catch(() => {});

  // Find every (leaveType × monthlyAccrual > 0) entry for this user's policy.
  // No rows = no policy assigned OR policy has no accruing types → no-op.
  const entries = await prisma.$queryRawUnsafe<
    Array<{ leaveTypeId: number; monthlyAccrual: any }>
  >(
    `SELECT lpe."leaveTypeId", lpe."monthlyAccrual"
       FROM "User" u
       JOIN "LeavePolicy"      lp  ON lp.id = u."leavePolicyId"
       JOIN "LeavePolicyEntry" lpe ON lpe."policyId" = lp.id
       JOIN "LeaveType"        lt  ON lt.id = lpe."leaveTypeId"
      WHERE u.id = $1
        AND lp."isActive" = true
        AND lt."isActive" = true
        AND lpe."monthlyAccrual" > 0`,
    userId,
  );
  if (entries.length === 0) return 0;

  let credited = 0;
  for (const e of entries) {
    const perMonth = Number(e.monthlyAccrual);
    if (!Number.isFinite(perMonth) || perMonth <= 0) continue;

    // Upsert the LeaveBalance row for this (user, leaveType, year). New
    // rows start with totalDays=0 and lastAccrualMonth=currentYm so they
    // don't accrue retroactively for prior months in the same year — the
    // first credit lands next month.
    const existing = await prisma.$queryRawUnsafe<
      Array<{ id: number; lastAccrualMonth: string | null }>
    >(
      `SELECT id, "lastAccrualMonth" FROM "LeaveBalance"
        WHERE "userId" = $1 AND "leaveTypeId" = $2 AND year = $3`,
      userId, e.leaveTypeId, year,
    );

    if (existing.length === 0) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "LeaveBalance"
           ("userId","leaveTypeId","year","totalDays","usedDays","pendingDays","lastAccrualMonth","createdAt","updatedAt")
         VALUES ($1, $2, $3, 0, 0, 0, $4, NOW(), NOW())`,
        userId, e.leaveTypeId, year, currentYm,
      );
      continue; // first credit happens next month
    }

    // A row with no accrual marker (e.g. one hand-created by HR through the
    // admin balance editor or a Carry-Over entry, neither of which sets
    // lastAccrualMonth) would otherwise be skipped forever, since
    // monthsBetween(null, …) === 0 — it never credits AND never stamps, so
    // the row stays invisible to accrual permanently. Seed its marker to the
    // current month instead: no retroactive credit (same rule as a freshly
    // inserted row above), but it starts accruing again next month.
    if (existing[0].lastAccrualMonth == null) {
      await prisma.$executeRawUnsafe(
        `UPDATE "LeaveBalance" SET "lastAccrualMonth" = $1, "updatedAt" = NOW() WHERE id = $2`,
        currentYm, existing[0].id,
      );
      continue;
    }

    const months = monthsBetween(existing[0].lastAccrualMonth, currentYm);
    if (months <= 0) continue;
    const add = months * perMonth;
    await prisma.$executeRawUnsafe(
      `UPDATE "LeaveBalance"
          SET "totalDays" = "totalDays" + $1::numeric,
              "lastAccrualMonth" = $2,
              "updatedAt" = NOW()
        WHERE id = $3`,
      add, currentYm, existing[0].id,
    );
    credited += months;
  }
  return credited;
}

/**
 * Run accrual for every active employee. Intended to be hit once at the
 * start of each month (cron, manual button, or piggy-backed on an admin
 * page load). Idempotent — safe to call multiple times.
 */
export async function accrueLeavesForEveryone(): Promise<{ credited: number; usersTouched: number }> {
  const userIds = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
    `SELECT id FROM "User" WHERE "isActive" = true`,
  );
  let credited = 0;
  let usersTouched = 0;
  for (const u of userIds) {
    const n = await accrueLeavesForUser(u.id);
    if (n > 0) usersTouched += 1;
    credited += n;
  }
  return { credited, usersTouched };
}

// SyncConfig key the scheduler uses to fire monthly accrual at most once
// per calendar month. Mirrors the per-day gate pattern used elsewhere in
// the scheduler.
const MONTHLY_ACCRUAL_SYNC_KEY = "hr_leave_accrual";

/**
 * Scheduler entry point — the SINGLE automatic monthly accrual for every
 * policy leave type (Sick Leave, Casual Leave, …). Runs
 * {@link accrueLeavesForEveryone} at most once per calendar month, gated by
 * a SyncConfig month-key so the 60s scheduler tick doesn't re-scan the whole
 * user table every minute.
 *
 * Uses the same {@link ymKey} clock that {@link accrueLeavesForUser} stamps
 * onto each LeaveBalance, so the gate month and the row stamp can never drift
 * out of sync. accrueLeavesForEveryone is itself row-level idempotent
 * (lastAccrualMonth), so even a double-fire can't over-credit — the gate is
 * purely a cost optimisation.
 *
 * Replaces the old hardcoded SL-only scheduler hook (maybeRunSickLeaveAccrual),
 * which ran alongside this one and caused Sick Leave to accrue twice.
 */
export async function maybeRunMonthlyLeaveAccrual(): Promise<void> {
  const month = ymKey(new Date());
  const row = await prisma.syncConfig.findUnique({ where: { key: MONTHLY_ACCRUAL_SYNC_KEY } });
  const lastMonth = (row?.value as { lastMonth?: string } | null)?.lastMonth ?? null;
  if (lastMonth === month) return;

  const report = await accrueLeavesForEveryone();
  await prisma.syncConfig.upsert({
    where:  { key: MONTHLY_ACCRUAL_SYNC_KEY },
    create: { key: MONTHLY_ACCRUAL_SYNC_KEY, value: { lastMonth: month } },
    update: { value: { lastMonth: month } },
  });
  console.log(
    `[leave-accrual] Month ${month}: credited ${report.credited} monthly accrual(s) ` +
    `across ${report.usersTouched} user(s).`,
  );
}

export { ymKey };
