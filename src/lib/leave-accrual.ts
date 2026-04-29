// Monthly leave accrual.
//
// Policy (NB Media):
//   • Sick Leave (LeaveType.code = "SL") accrues +1 day per calendar month.
//     Accrual is cumulative — unused days roll over.
//   • Every other leave type stays at whatever HR last set on the matrix.
//
// The helper is idempotent: it stamps `lastAccrualMonth` (YYYY-MM) on each
// LeaveBalance row after crediting it, so multiple calls in the same month
// are no-ops. New hires get `lastAccrualMonth` set to the month they joined,
// which means they don't accrue retroactively — their first +1 happens at
// the start of the next month.

import prisma from "@/lib/prisma";

const ACCRUING_CODES = new Set(["SL"]);
const MONTHLY_INCREMENT_DAYS: Record<string, number> = { SL: 1 };

function ymKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// "2025-12" + 1 month → "2026-01"
function nextYm(ym: string): string {
  const [yy, mm] = ym.split("-").map((s) => parseInt(s, 10));
  const d = new Date(Date.UTC(yy, mm, 1)); // mm is 1-based, Date is 0-based
  return ymKey(d);
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
 * style. Returns the number of months credited (0 if nothing changed).
 */
export async function accrueLeavesForUser(userId: number): Promise<number> {
  const now = new Date();
  const currentYm = ymKey(now);

  // Pull every Sick-Leave-style balance row for this user. Raw SQL keeps
  // us off the typed client (which may be stale on the new column).
  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: number; lastAccrualMonth: string | null; code: string; totalDays: any }>
  >(
    `SELECT lb.id, lb."lastAccrualMonth", lt.code, lb."totalDays"
       FROM "LeaveBalance" lb
       JOIN "LeaveType"   lt ON lt.id = lb."leaveTypeId"
      WHERE lb."userId" = $1
        AND lt."isActive" = true
        AND lt.code = ANY($2)`,
    userId,
    Array.from(ACCRUING_CODES),
  );

  let credited = 0;
  for (const r of rows) {
    const months = monthsBetween(r.lastAccrualMonth, currentYm);
    if (months <= 0) continue;
    const perMonth = MONTHLY_INCREMENT_DAYS[r.code] ?? 0;
    const add = months * perMonth;
    await prisma.$executeRawUnsafe(
      `UPDATE "LeaveBalance"
          SET "totalDays" = "totalDays" + $1::numeric,
              "lastAccrualMonth" = $2
        WHERE id = $3`,
      add,
      currentYm,
      r.id,
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
