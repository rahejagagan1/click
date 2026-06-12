// GET /api/hr/exits/[id]/settlement/pending-salary
//
// Auto-computes the salary still owed to an exiting employee for the days they
// actually worked in the unpaid (exit) month — up to their last working day.
// Used by the F&F wizard to auto-fill the "Salary changes" line so HR doesn't
// hand-calculate it. The line stays editable.
//
// Method = the same proration the payslip uses (see payroll/generate):
//   paidDays  = (day-of-month of LWD)  −  LOP within [1 .. LWD]
//   lopFactor = paidDays / daysInMonth          (weekends are paid, like payroll)
//   pendingNet = fullMonthlyNet × lopFactor      (net = gross − PF − PT − TDS − ₹200)
// Capping the period at the LWD makes the days after it simply unpaid, which is
// exactly the partial-month payslip the employee would have received.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const exitId = parseInt((await params).id);
    if (!Number.isFinite(exitId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const exit = await prisma.employeeExit.findUnique({
      where: { id: exitId },
      select: { userId: true, lastWorkingDay: true },
    });
    if (!exit) return NextResponse.json({ error: "Exit not found" }, { status: 404 });

    const structure = await prisma.salaryStructure.findUnique({ where: { userId: exit.userId } });
    if (!structure) {
      return NextResponse.json({ amount: 0, paidDays: 0, reason: "No salary structure on file." });
    }

    const lwd = exit.lastWorkingDay; // @db.Date → midnight UTC
    const year = lwd.getUTCFullYear();
    const month = lwd.getUTCMonth();          // 0-based
    const lwdDay = lwd.getUTCDate();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const firstDay = new Date(Date.UTC(year, month, 1));

    // Already paid? If a payslip exists for the exit month, nothing is pending
    // here — HR settles any over/under-payment manually.
    const existingPayslip = await prisma.payslip.findFirst({
      where: { userId: exit.userId, month, year },
      select: { id: true },
    });
    const monthLabel = `${MONTHS[month]} ${year}`;
    if (existingPayslip) {
      return NextResponse.json({
        amount: 0, paidDays: 0, daysInMonth, monthLabel, alreadyPaid: true,
        label: `Salary for ${monthLabel} (already paid in payroll)`,
      });
    }

    // LOP within the WORKED window [1st .. LWD] only. (Days after the LWD are
    // unpaid by virtue of the proration base being the full month, not LOP.)
    const [absent, lop, half, halfLop] = await Promise.all([
      prisma.attendance.count({ where: { userId: exit.userId, date: { gte: firstDay, lte: lwd }, status: "absent" } }),
      prisma.attendance.count({ where: { userId: exit.userId, date: { gte: firstDay, lte: lwd }, status: "lop" } }),
      prisma.attendance.count({ where: { userId: exit.userId, date: { gte: firstDay, lte: lwd }, status: "half_day" } }),
      prisma.attendance.count({ where: { userId: exit.userId, date: { gte: firstDay, lte: lwd }, status: "half_day_lop" } }),
    ]);

    // Unpaid (LWP) leave weekdays within the worked window — same as payroll.
    const unpaidLeaves = await prisma.leaveApplication.findMany({
      where: { userId: exit.userId, status: "approved", fromDate: { lte: lwd }, toDate: { gte: firstDay }, leaveType: { isPaid: false } },
      select: { fromDate: true, toDate: true },
    });
    let unpaidLeaveDays = 0;
    for (const lv of unpaidLeaves) {
      const start = lv.fromDate > firstDay ? lv.fromDate : firstDay;
      const end = lv.toDate < lwd ? lv.toDate : lwd;
      const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
      const stop = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
      while (cur.getTime() <= stop.getTime()) {
        const dow = cur.getUTCDay();
        if (dow !== 0 && dow !== 6) unpaidLeaveDays += 1;
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }

    const lopInPeriod = absent + lop + (half + halfLop) * 0.5 + unpaidLeaveDays;
    const paidDays = Math.max(0, lwdDay - lopInPeriod);
    const lopFactor = daysInMonth > 0 ? paidDays / daysInMonth : 0;

    // Full-month figures (all CTC components stored ANNUAL → /12). PF (Emp) is a
    // CTC component that flows back out as a deduction, so it's in earnings.
    const monthlyEarnings =
      (num(structure.basic) + num(structure.hra) + num(structure.dearnessAllowance) +
       num(structure.conveyanceAllowance) + num(structure.medicalAllowance) +
       num(structure.specialAllowance) + num(structure.pfEmployee)) / 12;
    const pfMonthly = num(structure.pfEmployee) / 12;
    const tdsMonthly = num(structure.tds) / 12;
    const ptMonthly = num(structure.professionalTax);
    const addlMonthly = structure.salaryType === "intern" ? 0 : 200;
    const fullMonthlyNet = monthlyEarnings - pfMonthly - tdsMonthly - ptMonthly - addlMonthly;

    const grossPending = Math.round(monthlyEarnings * lopFactor);
    const netPending = Math.max(0, Math.round(fullMonthlyNet * lopFactor));

    const dd = (n: number) => String(n).padStart(2, "0");
    const periodLabel = `${dd(1)}–${dd(lwdDay)} ${MONTHS[month]} ${year}`;

    return NextResponse.json({
      amount: netPending,                 // net take-home for the worked days
      paidDays: Number(paidDays.toFixed(1)),
      daysInMonth,
      monthLabel,
      alreadyPaid: false,
      label: `Salary for ${periodLabel} (${Number(paidDays.toFixed(1))}/${daysInMonth} days)`,
      breakdown: {
        gross: grossPending,
        deductions: Math.max(0, grossPending - netPending),
        lopInPeriod: Number(lopInPeriod.toFixed(1)),
        salaryType: structure.salaryType,
      },
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/exits/[id]/settlement/pending-salary");
  }
}
