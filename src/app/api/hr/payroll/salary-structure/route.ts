import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

// Mirrors src/lib/access.ts:isHRAdmin so the server gate matches the
// client. CEO / developer / special_access / role=admin / hr_manager
// can read any user's structure and write structures.
function isHRAdmin(u: any): boolean {
  return (
    u?.orgLevel === "ceo" ||
    u?.isDeveloper === true ||
    u?.orgLevel === "special_access" ||
    u?.role === "admin" ||
    u?.orgLevel === "hr_manager"
  );
}

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const admin = isHRAdmin(user);

  const { searchParams } = new URL(req.url);
  // Admins can target any userId; everyone else only their own. If a
  // non-admin asks for someone else's structure they get 403 — better
  // than silently swapping to their own (would mask UI bugs).
  let userId: number;
  const requested = searchParams.get("userId");
  if (requested) {
    const n = parseInt(requested);
    if (!Number.isFinite(n)) {
      return NextResponse.json({ error: "Bad userId" }, { status: 400 });
    }
    if (!admin && n !== user.dbId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    userId = n;
  } else {
    userId = user.dbId;
  }

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
  if (!isHRAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const {
      userId, ctc, basic, hra,
      specialAllowance, pfEmployee, pfEmployer, esiEmployee, esiEmployer,
      tds, professionalTax, effectiveFrom,
      // Extended fields from the onboarding compensation step:
      salaryType, payGroup, bonusIncluded, taxRegime, structureType, pfEligible,
    } = body;
    if (!userId || ctc == null || basic == null || !effectiveFrom) {
      return NextResponse.json({ error: "userId, ctc, basic, effectiveFrom required" }, { status: 400 });
    }

    // Capture the previous structure (if any) for the audit trail.
    const before = await prisma.salaryStructure.findUnique({ where: { userId: parseInt(userId) } });

    const data = {
      ctc, basic, hra: hra ?? 0,
      specialAllowance: specialAllowance ?? 0,
      pfEmployee: pfEmployee ?? 0, pfEmployer: pfEmployer ?? 0,
      esiEmployee: esiEmployee ?? 0, esiEmployer: esiEmployer ?? 0,
      tds: tds ?? 0, professionalTax: professionalTax ?? 0,
      effectiveFrom: new Date(effectiveFrom),
      salaryType:    salaryType    ?? "regular",
      payGroup:      payGroup      ?? null,
      bonusIncluded: bonusIncluded ?? false,
      taxRegime:     taxRegime     ?? null,
      structureType: structureType ?? null,
      pfEligible:    pfEligible    ?? false,
    };

    const structure = await prisma.salaryStructure.upsert({
      where: { userId: parseInt(userId) },
      create: { userId: parseInt(userId), ...data },
      update: data,
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
