import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const isAdmin = user.orgLevel === "ceo" || user.isDeveloper || user.orgLevel === "hr_manager";

  const { searchParams } = new URL(req.url);
  const userId = isAdmin && searchParams.get("userId")
    ? parseInt(searchParams.get("userId")!)
    : user.dbId;

  try {
    const payslips = await prisma.payslip.findMany({
      where: { userId },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      include: {
        payrollRun: { select: { id: true, status: true } },
        salaryStructure: { select: { ctc: true, basic: true, hra: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    });
    return NextResponse.json(payslips);
  } catch (e) { return serverError(e, "GET /api/hr/payroll/payslips"); }
}
