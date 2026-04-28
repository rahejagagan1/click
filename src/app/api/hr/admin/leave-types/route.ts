import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, requireHRAdmin, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const types = await prisma.leaveType.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
    return NextResponse.json(types);
  } catch (e) { return serverError(e, "GET /api/hr/admin/leave-types"); }
}

export async function POST(req: NextRequest) {
  const { errorResponse } = await requireHRAdmin();
  if (errorResponse) return errorResponse;
  try {
    const body = await req.json();
    // `description` and `maxCarryForward` aren't on the LeaveType schema —
    // accepted from the body for forward-compat but stripped before write.
    const { name, code, daysPerYear, isPaid, carryForward } = body;
    if (!name || !daysPerYear) return NextResponse.json({ error: "name and daysPerYear required" }, { status: 400 });
    // Derive a unique code from the name when not supplied (initials, upper).
    const derivedCode = code || String(name).split(/\s+/).map((w: string) => w[0]).join("").toUpperCase().slice(0, 4) || "LV";
    const type = await prisma.leaveType.create({
      data: { name, code: derivedCode, daysPerYear: parseInt(daysPerYear), isPaid: isPaid ?? true, carryForward: carryForward ?? false },
    });
    return NextResponse.json(type, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/admin/leave-types"); }
}

export async function PUT(req: NextRequest) {
  const { errorResponse } = await requireHRAdmin();
  if (errorResponse) return errorResponse;
  try {
    const body = await req.json();
    const { id, name, code, daysPerYear, isPaid, carryForward, isActive } = body;
    const type = await prisma.leaveType.update({
      where: { id: parseInt(id) },
      data: { name, code, daysPerYear: parseInt(daysPerYear), isPaid, carryForward, isActive },
    });
    return NextResponse.json(type);
  } catch (e) { return serverError(e, "PUT /api/hr/admin/leave-types"); }
}
