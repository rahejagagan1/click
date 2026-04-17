import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, requireHRAdmin, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const types = await prisma.leaveType.findMany({ orderBy: { name: "asc" } });
    return NextResponse.json(types);
  } catch (e) { return serverError(e, "GET /api/hr/admin/leave-types"); }
}

export async function POST(req: NextRequest) {
  const { errorResponse } = await requireHRAdmin();
  if (errorResponse) return errorResponse;
  try {
    const body = await req.json();
    const { name, description, daysPerYear, isPaid, carryForward, maxCarryForward } = body;
    if (!name || !daysPerYear) return NextResponse.json({ error: "name and daysPerYear required" }, { status: 400 });
    const type = await prisma.leaveType.create({
      data: { name, description, daysPerYear: parseInt(daysPerYear), isPaid: isPaid ?? true, carryForward: carryForward ?? false, maxCarryForward: maxCarryForward ? parseInt(maxCarryForward) : null },
    });
    return NextResponse.json(type, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/admin/leave-types"); }
}

export async function PUT(req: NextRequest) {
  const { errorResponse } = await requireHRAdmin();
  if (errorResponse) return errorResponse;
  try {
    const body = await req.json();
    const { id, name, description, daysPerYear, isPaid, carryForward, maxCarryForward, isActive } = body;
    const type = await prisma.leaveType.update({
      where: { id: parseInt(id) },
      data: { name, description, daysPerYear: parseInt(daysPerYear), isPaid, carryForward, maxCarryForward, isActive },
    });
    return NextResponse.json(type);
  } catch (e) { return serverError(e, "PUT /api/hr/admin/leave-types"); }
}
