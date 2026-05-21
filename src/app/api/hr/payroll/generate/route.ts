import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, isHRAdmin, serverError } from "@/lib/api-auth";

// POST /api/hr/payroll/generate — produce draft payslips for a payroll run.
// Math model:
//   workingDays  = calendar days in run.month (28 / 30 / 31)
//   lopDays      = absent + 0.5 × half_day + unpaid-leave weekdays in month
//   paidDays     = workingDays − lopDays
//   lopFactor    = paidDays / workingDays
//   gross        = (basic + hra + specialAllowance) / 12 × lopFactor + bonus
//   deductions   = (pf + esi) × lopFactor + flat(pt | tds/12)
//   net          = gross − deductions
//
// The bonus pull picks EmployeeBonus rows with paymentStatus='due_future'
// and effectiveDate inside the run month — paid_past rows are ledger-only
// and don't affect the monthly cheque.
//
// Run status transitions here: draft|generated → processing → generated.
// "locked" and "paid" live in dedicated transition endpoints — never set
// from here.
export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  if (!isHRAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { runId } = await req.json();
    if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });

    const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
    if (run.status === "locked" || run.status === "paid")
      return NextResponse.json({ error: "Run is locked — re-open it before regenerating" }, { status: 409 });

    await prisma.payrollRun.update({ where: { id: runId }, data: { status: "processing" } });

    const structures = await prisma.salaryStructure.findMany({
      include: { user: { select: { id: true, isActive: true } } },
    });
    const activeStructures = structures.filter(s => s.user.isActive);

    const firstDay = new Date(Date.UTC(run.year, run.month, 1));
    const lastDay  = new Date(Date.UTC(run.year, run.month + 1, 0));
    const daysInMonth = lastDay.getUTCDate();

    // One EmployeeBonus query for the whole run rather than per-user — much
    // cheaper. Map by userId so the per-employee block is a hash lookup.
    const bonusRows = await prisma.$queryRawUnsafe<{ userId: number; amount: string }[]>(
      `SELECT "userId", SUM(amount)::text AS amount
         FROM "EmployeeBonus"
        WHERE "paymentStatus" = 'due_future'
          AND "effectiveDate" >= $1::date
          AND "effectiveDate" <= $2::date
        GROUP BY "userId"`,
      firstDay, lastDay,
    );
    const bonusByUser = new Map<number, number>(
      bonusRows.map(r => [r.userId, parseFloat(r.amount) || 0]),
    );

    let totalNetPay = 0, totalCTC = 0;

    const payslipsData = await Promise.all(activeStructures.map(async (s) => {
      // LOP from attendance — absent = 1, half_day = 0.5. on_leave is paid
      // here; unpaid leaves are netted out separately below via the leave
      // join because the approve flow stamps every leave as on_leave.
      const [absentCount, halfDayCount] = await Promise.all([
        prisma.attendance.count({ where: { userId: s.userId, date: { gte: firstDay, lte: lastDay }, status: "absent" } }),
        prisma.attendance.count({ where: { userId: s.userId, date: { gte: firstDay, lte: lastDay }, status: "half_day" } }),
      ]);

      // Unpaid-leave subtraction: approved leaves on a LeaveType where
      // isPaid=false, clipped to the run month and weekdays only (matches
      // the attendance write in src/app/api/hr/leaves/[id]/route.ts).
      const unpaidLeaves = await prisma.leaveApplication.findMany({
        where: {
          userId:   s.userId,
          status:   "approved",
          fromDate: { lte: lastDay },
          toDate:   { gte: firstDay },
          leaveType: { isPaid: false },
        },
        select: { fromDate: true, toDate: true },
      });
      let unpaidLeaveDays = 0;
      for (const lv of unpaidLeaves) {
        const start = lv.fromDate > firstDay ? lv.fromDate : firstDay;
        const end   = lv.toDate   < lastDay  ? lv.toDate   : lastDay;
        const cur   = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
        const stop  = new Date(Date.UTC(end.getUTCFullYear(),   end.getUTCMonth(),   end.getUTCDate()));
        while (cur.getTime() <= stop.getTime()) {
          const dow = cur.getUTCDay();
          if (dow !== 0 && dow !== 6) unpaidLeaveDays += 1;
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      }

      const lopDays    = absentCount + halfDayCount * 0.5 + unpaidLeaveDays;
      const paidDays   = Math.max(0, daysInMonth - lopDays);
      const lopFactor  = paidDays / daysInMonth;

      // Gross components: derived from the salary structure's annual
      // amounts (not CTC), so PF/TDS/PT in the structure don't get
      // double-counted. Interns store everything in `basic`.
      const basic     = parseFloat(s.basic.toString());
      const hra       = parseFloat(s.hra.toString());
      const special   = parseFloat(s.specialAllowance.toString());
      const monthlyEarnings = (basic + hra + special) / 12;

      const bonus     = bonusByUser.get(s.userId) || 0;
      const gross     = monthlyEarnings * lopFactor + bonus;

      // Deductions: PF / ESI prorate with attendance (no PF on LOP days);
      // PT is a flat monthly figure but is waived when LOP > 5 days (Indian
      // standard threshold — kept as a constant for now). TDS is the
      // annual figure / 12.
      const pf        = parseFloat(s.pfEmployee.toString()) * lopFactor;
      const esi       = parseFloat(s.esiEmployee.toString()) * lopFactor;
      const pt        = lopDays > 5 ? 0 : parseFloat(s.professionalTax.toString());
      const tds       = parseFloat(s.tds.toString()) / 12;
      const totalDed  = pf + esi + pt + tds;
      const net       = gross - totalDed;

      totalCTC    += parseFloat(s.ctc.toString()) / 12;
      totalNetPay += net;

      return {
        userId: s.userId,
        payrollRunId: runId,
        salaryStructureId: s.id,
        month: run.month,
        year: run.year,
        workingDays:     daysInMonth,
        presentDays:     paidDays.toFixed(1),
        lopDays:         lopDays.toFixed(1),
        grossEarnings:   gross.toFixed(2),
        totalDeductions: totalDed.toFixed(2),
        netPay:          net.toFixed(2),
        bonus:           bonus.toFixed(2),
        tds:             tds.toFixed(2),
        pfEmployee:      pf.toFixed(2),
        professionalTax: pt.toFixed(2),
        status:          "generated",
      };
    }));

    await Promise.all(payslipsData.map(p =>
      prisma.payslip.upsert({
        where:  { userId_month_year: { userId: p.userId, month: p.month, year: p.year } },
        create: p as any,
        update: p as any,
      })
    ));

    const updated = await prisma.payrollRun.update({
      where: { id: runId },
      data:  { status: "generated", totalCTC: totalCTC.toFixed(2), totalNetPay: totalNetPay.toFixed(2) },
    });

    return NextResponse.json({ run: updated, payslipsGenerated: payslipsData.length });
  } catch (e) { return serverError(e, "POST /api/hr/payroll/generate"); }
}
