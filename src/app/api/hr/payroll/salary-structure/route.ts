import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit-log";

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
    const structure = await prisma.salaryStructure.findUnique({
      where: { userId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return NextResponse.json(structure || null);
  } catch (e) { return serverError(e, "GET /api/hr/payroll/salary-structure"); }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const isAdmin = user.orgLevel === "ceo" || user.isDeveloper || user.orgLevel === "hr_manager";
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const { userId, ctc, basic, hra, specialAllowance, pfEmployee, pfEmployer, esiEmployee, esiEmployer, tds, professionalTax, effectiveFrom } = body;
    if (!userId || !ctc || !basic || !hra || !effectiveFrom)
      return NextResponse.json({ error: "userId, ctc, basic, hra, effectiveFrom required" }, { status: 400 });

    // Capture the previous structure (if any) for the audit trail.
    const before = await prisma.salaryStructure.findUnique({ where: { userId: parseInt(userId) } });

    const structure = await prisma.salaryStructure.upsert({
      where: { userId: parseInt(userId) },
      create: {
        userId: parseInt(userId), ctc, basic, hra,
        specialAllowance: specialAllowance || 0,
        pfEmployee: pfEmployee || 0, pfEmployer: pfEmployer || 0,
        esiEmployee: esiEmployee || 0, esiEmployer: esiEmployer || 0,
        tds: tds || 0, professionalTax: professionalTax || 0,
        effectiveFrom: new Date(effectiveFrom),
      },
      update: {
        ctc, basic, hra,
        specialAllowance: specialAllowance || 0,
        pfEmployee: pfEmployee || 0, pfEmployer: pfEmployer || 0,
        esiEmployee: esiEmployee || 0, esiEmployer: esiEmployer || 0,
        tds: tds || 0, professionalTax: professionalTax || 0,
        effectiveFrom: new Date(effectiveFrom),
      },
      include: { user: { select: { id: true, name: true } } },
    });

    // Audit trail — admin assigns / updates a salary structure for an employee.
    await writeAuditLog({
      req,
      actorId: user.dbId ?? null,
      actorEmail: user.email ?? null,
      action: before ? "payroll.structure.update" : "payroll.structure.assign",
      entityType: "SalaryStructure",
      entityId: structure.id,
      before: before ? {
        ctc: String(before.ctc), basic: String(before.basic), hra: String(before.hra),
        effectiveFrom: before.effectiveFrom,
      } : null,
      after: {
        userId: structure.userId,
        ctc: String(structure.ctc), basic: String(structure.basic), hra: String(structure.hra),
        effectiveFrom: structure.effectiveFrom,
      },
    });

    return NextResponse.json(structure, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/payroll/salary-structure"); }
}
