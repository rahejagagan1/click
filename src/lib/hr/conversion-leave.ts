// Intern / probation → regular conversion: Casual Leave crediting rule.
//
// The org rule (not otherwise encoded in flat monthly accrual):
//   • CL eligibility begins the month an employee's internship OR probation
//     COMPLETES — not when someone happens to flip their leave policy.
//   • The COMPLETION MONTH is credited a full CL if the completion date is on
//     or before the 15th, else HALF (0.5). Every month AFTER accrues 1 as usual.
//   • Interns sit on the "Intern Leave Plan" (SL only, no CL). On completion
//     they must move to the regular policy so CL starts accruing at all.
//
// This module does BOTH on demand + idempotently:
//   1. moves a completed intern off the Intern Leave Plan onto the regular one,
//   2. seeds the CL balance for the completion month (full/half), stamping
//      lastAccrualMonth = completion month so the normal monthly accrual engine
//      (lib/leave-accrual) adds 1 for each subsequent month with no double-count.
//
// It runs from accrueLeavesForUser (so every accrual — monthly cron or the lazy
// on-page-read trigger — self-heals a missed conversion) and can be invoked
// directly on the probation-confirm / intern-end action.

import prisma from "@/lib/prisma";

const REGULAR_POLICY_NAME = "Standard Policy";
const INTERN_POLICY_NAME  = "Intern Leave Plan";
const CASUAL_LEAVE_CODE   = "CL";

const ym = (y: number, m1: number) => `${y}-${String(m1).padStart(2, "0")}`;
// Inclusive month steps from `fromYm` (exclusive) to `toYm` (inclusive).
function monthsBetween(fromYm: string, toYm: string): number {
  const [fy, fm] = fromYm.split("-").map((s) => parseInt(s, 10));
  const [ty, tm] = toYm.split("-").map((s) => parseInt(s, 10));
  return Math.max(0, (ty - fy) * 12 + (tm - fm));
}

export type ConversionResult = {
  changed: boolean;
  movedToRegular?: boolean;
  clSeeded?: number;        // first-month credit written (1 or 0.5), if any
  completionDate?: string;  // YYYY-MM-DD
  reason?: string;
};

// Cache the (usually static) policy + leave-type ids for the process lifetime.
let idCache: { internPolicyId: number; regularPolicyId: number; clTypeId: number } | null = null;
async function resolveIds() {
  if (idCache) return idCache;
  const [intern, regular, cl] = await Promise.all([
    prisma.leavePolicy.findFirst({ where: { name: INTERN_POLICY_NAME }, select: { id: true } }),
    prisma.leavePolicy.findFirst({ where: { name: REGULAR_POLICY_NAME }, select: { id: true } }),
    prisma.leaveType.findFirst({ where: { code: CASUAL_LEAVE_CODE }, select: { id: true } }),
  ]);
  if (!intern || !regular || !cl) return null; // policies/type not seeded — no-op
  idCache = { internPolicyId: intern.id, regularPolicyId: regular.id, clTypeId: cl.id };
  return idCache;
}

/**
 * Reconcile one employee's intern/probation→regular CL crediting.
 *
 * Only acts on someone CURRENTLY on the Intern Leave Plan whose internship or
 * probation completion date has already passed. Moves them to the regular
 * policy and seeds their Casual Leave for the completion month (full ≤15th,
 * else half). Idempotent: once moved off the intern plan it early-returns, so
 * running it repeatedly (each accrual) can't re-seed or double-credit.
 *
 * `year` / `currentYm` are passed in so this shares the exact clock the accrual
 * engine stamps, preventing drift.
 */
export async function reconcileConversionLeaveForUser(
  userId: number,
  currentYm: string,
  year: number,
): Promise<ConversionResult> {
  const ids = await resolveIds();
  if (!ids) return { changed: false, reason: "policies/CL type not configured" };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      leavePolicyId: true,
      salaryStructure: { select: { salaryType: true } },
      employeeProfile: { select: { internshipEndDate: true, probationEndDate: true } },
    },
  });
  // Only interns still parked on the Intern Leave Plan are candidates — once
  // converted (policy != intern), CL is the regular accrual engine's job.
  if (!user || user.leavePolicyId !== ids.internPolicyId) return { changed: false };

  // CRUCIAL: act only once the employee has ACTUALLY been made regular
  // (salaryStructure.salaryType === "regular"). A passed internshipEndDate
  // alone is NOT conversion — HR may still be deciding / may extend. Real
  // interns (salaryType "intern") stay put and keep the Intern Leave Plan.
  if (user.salaryStructure?.salaryType !== "regular") {
    return { changed: false, reason: "still an intern — not yet converted to regular" };
  }

  const prof = user.employeeProfile;
  // Completion = internship end (intern path) or, failing that, probation end.
  const completion = prof?.internshipEndDate ?? prof?.probationEndDate ?? null;
  if (!completion) return { changed: false, reason: "no completion date" };

  const compDate = new Date(completion);
  const today = new Date();
  if (compDate.getTime() > today.getTime()) return { changed: false, reason: "completion in the future" };

  const compYear  = compDate.getUTCFullYear();
  const compMonth = compDate.getUTCMonth() + 1; // 1-based
  const compDay   = compDate.getUTCDate();

  // Seed the CL balance for the CURRENT accrual year:
  //   • completion in this year → seed the completion month with full/half, and
  //     stamp lastAccrualMonth = completion month so accrual fills the rest.
  //   • completion in a PRIOR year → they've been regular all year, so seed 0
  //     with lastAccrualMonth = last-Dec, letting accrual credit every month.
  let firstMonth: number;
  let seedYm: string;
  if (compYear === year) {
    firstMonth = compDay <= 15 ? 1 : 0.5;
    seedYm = ym(compYear, compMonth);
  } else if (compYear < year) {
    firstMonth = 0;
    seedYm = ym(year - 1, 12);
  } else {
    return { changed: false, reason: "completion year is in the future" };
  }

  await prisma.$transaction(async (tx) => {
    // 1) Move onto the regular policy so CL (and the rest) accrue.
    await tx.user.update({ where: { id: userId }, data: { leavePolicyId: ids.regularPolicyId } });

    // 2) Seed the CL balance for the year (upsert). totalDays is the seed; the
    //    accrual pass right after this in accrueLeavesForUser adds the months
    //    after `seedYm`. usedDays/pendingDays are preserved on an existing row.
    const existing = await tx.leaveBalance.findUnique({
      where: { userId_leaveTypeId_year: { userId, leaveTypeId: ids.clTypeId, year } },
      select: { id: true },
    });
    if (existing) {
      await tx.leaveBalance.update({
        where: { id: existing.id },
        data: { totalDays: firstMonth, lastAccrualMonth: seedYm },
      });
    } else {
      await tx.leaveBalance.create({
        data: { userId, leaveTypeId: ids.clTypeId, year, totalDays: firstMonth, usedDays: 0, pendingDays: 0, lastAccrualMonth: seedYm },
      });
    }
  });

  // How much accrual will add after the seed, for reporting only.
  const monthsAfter = monthsBetween(seedYm, currentYm);
  return {
    changed: true,
    movedToRegular: true,
    clSeeded: firstMonth,
    completionDate: compDate.toISOString().slice(0, 10),
    reason: `seeded CL ${firstMonth} @ ${seedYm}; accrual adds ${monthsAfter} more → ${firstMonth + monthsAfter}`,
  };
}

/** Reconcile every active employee — a one-time backfill / periodic sweep for
 *  interns whose completion was missed (left on the Intern Leave Plan). */
export async function reconcileAllConversionLeaves(currentYm: string, year: number): Promise<{ fixed: number; details: ConversionResult[] }> {
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true } });
  const details: ConversionResult[] = [];
  for (const u of users) {
    const r = await reconcileConversionLeaveForUser(u.id, currentYm, year);
    if (r.changed) details.push({ ...r, ...( { userId: u.id } as any) });
  }
  return { fixed: details.length, details };
}
