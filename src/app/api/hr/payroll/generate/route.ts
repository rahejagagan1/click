import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

// POST /api/hr/payroll/generate — generate payslips for a payroll run
export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const isAdmin = user.orgLevel === "ceo" || user.isDeveloper || user.orgLevel === "hr_manager";
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { runId } = await req.json();
    if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });

    const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
    if (run.status === "completed" || run.status === "paid")
      return NextResponse.json({ error: "Run already completed" }, { status: 409 });

    // Update run to processing
    await prisma.payrollRun.update({ where: { id: runId }, data: { status: "processing" } });

    // Get all active employees with salary structures
    const structures = await prisma.salaryStructure.findMany({
      include: { user: { select: { id: true, name: true, isActive: true } } },
    });

    const activeStructures = structures.filter(s => s.user.isActive);
    let totalNetPay = 0, totalCTC = 0;

    // Get attendance for the month
    const firstDay = new Date(run.year, run.month, 1);
    const lastDay  = new Date(run.year, run.month + 1, 0);

    const payslipsData = await Promise.all(activeStructures.map(async (s) => {
      // Count working days (Mon–Sat = 26 standard, or from attendance)
      const attRecords = await prisma.attendance.count({
        where: {
          userId: s.userId,
          date: { gte: firstDay, lte: lastDay },
          status: { in: ["present", "late"] },
        },
      });

      const workingDays = 26;
      const presentDays = Math.max(attRecords, 1);
      const lopDays = Math.max(workingDays - presentDays, 0);
      const lopFactor = presentDays / workingDays;

      const gross = parseFloat(s.ctc.toString()) / 12 * lopFactor;
      const pf    = parseFloat(s.pfEmployee.toString()) * lopFactor;
      const esi   = parseFloat(s.esiEmployee.toString()) * lopFactor;
      const pt    = lopDays > 5 ? 0 : parseFloat(s.professionalTax.toString());
      const tds   = parseFloat(s.tds.toString()) / 12;
      const totalDed = pf + esi + pt + tds;
      const net = gross - totalDed;

      totalCTC  += parseFloat(s.ctc.toString()) / 12;
      totalNetPay += net;

      return {
        userId: s.userId,
        payrollRunId: runId,
        salaryStructureId: s.id,
        month: run.month,
        year: run.year,
        workingDays,
        presentDays,
        lopDays,
        grossEarnings: gross.toFixed(2),
        totalDeductions: totalDed.toFixed(2),
        netPay: net.toFixed(2),
        tds: tds.toFixed(2),
        pfEmployee: pf.toFixed(2),
        professionalTax: pt.toFixed(2),
        status: "generated",
      };
    }));

    // Upsert payslips
    await Promise.all(payslipsData.map(p =>
      prisma.payslip.upsert({
        where: { userId_month_year: { userId: p.userId, month: p.month, year: p.year } },
        create: p as any,
        update: p as any,
      })
    ));

    const updated = await prisma.payrollRun.update({
      where: { id: runId },
      data: { status: "completed", totalCTC: totalCTC.toFixed(2), totalNetPay: totalNetPay.toFixed(2) },
    });

    return NextResponse.json({ run: updated, payslipsGenerated: payslipsData.length });
  } catch (e) { return serverError(e, "POST /api/hr/payroll/generate"); }
}
