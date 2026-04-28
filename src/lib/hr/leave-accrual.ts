import prisma from "@/lib/prisma";

const SICK_LEAVE_CODE = "SL";
const SL_ANNUAL_CAP   = 12;
const SYNC_KEY        = "hr_sick_leave_accrual";

/** YYYY-MM in IST (Asia/Kolkata) — accrual fires once per IST calendar month. */
function istMonthKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}`;
}

/**
 * Sick-leave accrual: every active employee gets +1 day on their SL
 * balance for the current calendar year, capped at 12.
 *
 * Idempotent at the row level — if a balance row already sits at the cap
 * we leave it alone. Callers must still gate by month-key (see
 * {@link maybeRunSickLeaveAccrual}) so this doesn't fire twice in the
 * same calendar month.
 *
 * Returns a small report so the scheduler can log accrual activity.
 */
export async function accrueMonthlySickLeave(now = new Date()): Promise<{
  users: number; created: number; incremented: number; cappedAt12: number;
}> {
  const slType = await prisma.leaveType.findUnique({
    where: { code: SICK_LEAVE_CODE },
    select: { id: true },
  });
  if (!slType) {
    console.warn("[leave-accrual] No 'SL' LeaveType found — skipping accrual.");
    return { users: 0, created: 0, incremented: 0, cappedAt12: 0 };
  }

  const year   = Number(istMonthKey(now).slice(0, 4));
  const users  = await prisma.user.findMany({
    where: { isActive: true }, select: { id: true },
  });

  let created = 0, incremented = 0, cappedAt12 = 0;
  for (const u of users) {
    const existing = await prisma.leaveBalance.findUnique({
      where: { userId_leaveTypeId_year: { userId: u.id, leaveTypeId: slType.id, year } },
    });
    if (!existing) {
      await prisma.leaveBalance.create({
        data: {
          userId:      u.id,
          leaveTypeId: slType.id,
          year,
          totalDays:   1,
          usedDays:    0,
          pendingDays: 0,
        },
      });
      created++;
      continue;
    }

    const total = Number(existing.totalDays);
    if (total >= SL_ANNUAL_CAP) {
      cappedAt12++;
      continue;
    }
    const next = Math.min(SL_ANNUAL_CAP, total + 1);
    await prisma.leaveBalance.update({
      where: { id: existing.id },
      data:  { totalDays: next },
    });
    incremented++;
  }

  return { users: users.length, created, incremented, cappedAt12 };
}

/**
 * Scheduler entry point. Looks up the last month accrual ran in
 * SyncConfig and short-circuits if it matches the current IST month.
 * Otherwise runs accrual and records the new month-key.
 *
 * Safe to call from a 60s tick — actual DB work happens at most once
 * per IST calendar month even across server restarts.
 */
export async function maybeRunSickLeaveAccrual(): Promise<void> {
  const month = istMonthKey();
  const row = await prisma.syncConfig.findUnique({ where: { key: SYNC_KEY } });
  const lastMonth = (row?.value as { lastMonth?: string } | null)?.lastMonth ?? null;
  if (lastMonth === month) return;

  const report = await accrueMonthlySickLeave();
  await prisma.syncConfig.upsert({
    where:  { key: SYNC_KEY },
    create: { key: SYNC_KEY, value: { lastMonth: month } },
    update: { value: { lastMonth: month } },
  });
  console.log(
    `[leave-accrual] Month ${month}: ` +
    `+1 SL day for ${report.incremented} user(s), ` +
    `${report.created} new balance row(s), ` +
    `${report.cappedAt12} already at the 12-day cap.`,
  );
}
