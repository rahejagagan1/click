import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";
import { getBrandScope } from "@/lib/hr/brand-scope";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const isAdmin = canViewSalary(user);

  const { searchParams } = new URL(req.url);
  const userId = isAdmin && searchParams.get("userId")
    ? parseInt(searchParams.get("userId")!)
    : user.dbId;
  // Admin-only: ?runId= scopes the result to a single payroll run — used
  // by the "Run Payroll" page's Pre-Payroll Check panel to enumerate
  // every payslip in a cycle (not just one employee's). Non-admins'
  // requests are still constrained to their own userId regardless.
  const runIdParam = isAdmin && searchParams.get("runId")
    ? parseInt(searchParams.get("runId")!)
    : null;

  try {
    // Brand-scope: even an admin who passes canViewSalary should
    // see only same-brand payslips unless they're allowlisted for
    // cross-brand. Closes the leak where YT Labs CEO could fetch
    // a NB Media-only PayrollRun's payslips by runId.
    const scope = getBrandScope(user);
    if (isAdmin && !scope.allBrands && !scope.brand) {
      return NextResponse.json([]);
    }
    const brandFilter = !isAdmin || scope.allBrands
      ? {}
      : { user: { employeeProfile: { businessUnit: scope.brand! } } };

    // Non-admin: only payslips whose parent PayrollRun has been marked
    // 'paid' are visible. Lock + finance-confirm is a manual two-step,
    // so the employee shouldn't see a payslip until the second step is
    // done. Admins always see everything (including drafts) for review.
    const payslips = await prisma.payslip.findMany({
      where: {
        ...(runIdParam ? { payrollRunId: runIdParam } : { userId }),
        ...(isAdmin ? {} : { payrollRun: { status: "paid" } }),
        ...brandFilter,
      },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      include: {
        payrollRun: { select: { id: true, status: true } },
        salaryStructure: { select: { ctc: true, basic: true, hra: true, salaryType: true, specialAllowance: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    });
    return NextResponse.json(payslips);
  } catch (e) { return serverError(e, "GET /api/hr/payroll/payslips"); }
}
