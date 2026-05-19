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

export { ymKey };
