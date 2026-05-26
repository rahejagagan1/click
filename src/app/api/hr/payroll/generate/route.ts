import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";

// POST /api/hr/payroll/generate — produce draft payslips for a payroll run.
// Math model:
//   workingDays  = calendar days in run.month (28 / 30 / 31)
//   lopDays      = absent + 0.5 × half_day + unpaid-leave weekdays in month
//   paidDays     = workingDays − lopDays
//   lopFactor    = paidDays / workingDays
//   gross        = (basic + hra + specialAllowance) / 12 × lopFactor
//                  + bonus + Σ AdhocLineItem(kind=payment)
//   deductions   = (pf + esi) × lopFactor
//                  + flat(pt) + tds/12
//                  + Σ AdhocLineItem(kind=deduction)
//   then TaxOverride rows replace the matching PT/ESI/TDS/LWF amounts.
//   SalaryHold (kind=processing) — skip payslip entirely.
//   SalaryHold (kind=payout)     — generate payslip but stamp status=on_hold.
//
// The bonus pull picks EmployeeBonus rows with paymentStatus='due_future'
// and effectiveDate inside the run month — paid_past rows are ledger-only.
export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  if (!canViewSalary(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

    // Bulk-fetch all cycle-scoped overrides once and bucket by userId so
    // the per-employee block stays a hash lookup, not N+1 queries.
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

    const adhocRows = await prisma.$queryRawUnsafe<{ userId: number; kind: string; amount: string }[]>(
      `SELECT "userId", kind, SUM(amount)::text AS amount
         FROM "AdhocLineItem"
        WHERE month = $1 AND year = $2
        GROUP BY "userId", kind`,
      run.month, run.year,
    );
    const adhocPayByUser = new Map<number, number>();
    const adhocDedByUser = new Map<number, number>();
    for (const r of adhocRows) {
      const v = parseFloat(r.amount) || 0;
      if (r.kind === "payment")        adhocPayByUser.set(r.userId, v);
      else if (r.kind === "deduction") adhocDedByUser.set(r.userId, v);
    }

    const holdRows = await prisma.$queryRawUnsafe<{ userId: number; kind: string }[]>(
      `SELECT "userId", kind FROM "SalaryHold" WHERE month = $1 AND year = $2`,
      run.month, run.year,
    );
    const holdByUser = new Map<number, string>(holdRows.map(h => [h.userId, h.kind]));

    const overrideRows = await prisma.$queryRawUnsafe<{
      userId: number; kind: string; employeeOverride: string | null; employerOverride: string | null;
    }[]>(
      `SELECT "userId", kind, "employeeOverride", "employerOverride"
         FROM "TaxOverride" WHERE month = $1 AND year = $2`,
      run.month, run.year,
    );
    const overrideByUserKind = new Map<string, { emp: number | null; empr: number | null }>();
    for (const o of overrideRows) {
      overrideByUserKind.set(`${o.userId}:${o.kind}`, {
        emp:  o.employeeOverride !== null ? parseFloat(o.employeeOverride) : null,
        empr: o.employerOverride !== null ? parseFloat(o.employerOverride) : null,
      });
    }

    let totalNetPay = 0, totalCTC = 0, skipped = 0;

    const payslipsData: any[] = [];

    for (const s of activeStructures) {
      // processing-hold employees skip payslip generation entirely.
      if (holdByUser.get(s.userId) === "processing") { skipped += 1; continue; }

      // LOP from attendance — absent = 1, half_day = 0.5. on_leave is paid
      // here; unpaid leaves are netted out separately below.
      const [absentCount, halfDayCount] = await Promise.all([
        prisma.attendance.count({ where: { userId: s.userId, date: { gte: firstDay, lte: lastDay }, status: "absent" } }),
        prisma.attendance.count({ where: { userId: s.userId, date: { gte: firstDay, lte: lastDay }, status: "half_day" } }),
      ]);

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

      // All CTC components are stored as ANNUAL — divide by 12 for the
      // monthly gross. PF (Emp) is included in CTC under the company's
      // split formula (it's a CTC component that flows back out as a
      // statutory deduction below), so it's part of the gross too.
      const basic     = parseFloat(s.basic.toString());
      const hra       = parseFloat(s.hra.toString());
      const da        = parseFloat(s.dearnessAllowance.toString());
      const conv      = parseFloat(s.conveyanceAllowance.toString());
      const medical   = parseFloat(s.medicalAllowance.toString());
      const special   = parseFloat(s.specialAllowance.toString());
      const pfAnnual  = parseFloat(s.pfEmployee.toString());
      const monthlyEarnings = (basic + hra + da + conv + medical + special + pfAnnual) / 12;

      const bonus     = bonusByUser.get(s.userId) || 0;
      const adhocPay  = adhocPayByUser.get(s.userId) || 0;
      const adhocDed  = adhocDedByUser.get(s.userId) || 0;
      const gross     = monthlyEarnings * lopFactor + bonus + adhocPay;

      // Computed statutory amounts, then per-(user,kind) override replaces.
      // pfEmployee / esiEmployee are stored ANNUAL (matching other CTC
      // components), so /12 to get the per-month amount before LOP scaling.
      const pfBase    = (pfAnnual / 12) * lopFactor;
      const esiCalc   = (parseFloat(s.esiEmployee.toString()) / 12) * lopFactor;
      const ptCalc    = lopDays > 5 ? 0 : parseFloat(s.professionalTax.toString());
      const tdsCalc   = parseFloat(s.tds.toString()) / 12;

      const ptOvr  = overrideByUserKind.get(`${s.userId}:PT`);
      const esiOvr = overrideByUserKind.get(`${s.userId}:ESI`);
      const tdsOvr = overrideByUserKind.get(`${s.userId}:TDS`);
      const lwfOvr = overrideByUserKind.get(`${s.userId}:LWF`);

      const pt   = ptOvr?.emp  ?? ptCalc;
      const esi  = esiOvr?.emp ?? esiCalc;
      const tds  = tdsOvr?.emp ?? tdsCalc;
      const lwf  = lwfOvr?.emp ?? 0;
      const pf   = pfBase;

      const totalDed  = pf + esi + pt + tds + lwf + adhocDed;
      const net       = gross - totalDed;

      // payout-hold rows still generate (so HR sees the math) but with
      // status=on_hold — payslip release endpoints check this flag.
      const isPayoutHold = holdByUser.get(s.userId) === "payout";

      totalCTC    += parseFloat(s.ctc.toString()) / 12;
      if (!isPayoutHold) totalNetPay += net;

      payslipsData.push({
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
        status:          isPayoutHold ? "on_hold" : "generated",
      });
    }

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

    return NextResponse.json({ run: updated, payslipsGenerated: payslipsData.length, skipped });
  } catch (e) { return serverError(e, "POST /api/hr/payroll/generate"); }
}
