import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, requireHRAdmin, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const shifts = await prisma.shiftTemplate.findMany({ orderBy: { name: "asc" } });
    return NextResponse.json(shifts);
  } catch (e) { return serverError(e, "GET /api/hr/admin/shifts"); }
}

export async function POST(req: NextRequest) {
  const { errorResponse } = await requireHRAdmin();
  if (errorResponse) return errorResponse;
  try {
    const body = await req.json();
    const { name, startTime, endTime, gracePeriodMinutes, workingDays } = body;
    if (!name || !startTime || !endTime) return NextResponse.json({ error: "name, startTime, endTime required" }, { status: 400 });
    const shift = await prisma.shiftTemplate.create({
      data: { name, startTime, endTime, gracePeriodMinutes: gracePeriodMinutes ?? 15, workingDays: workingDays ?? [1,2,3,4,5] },
    });
    return NextResponse.json(shift, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/admin/shifts"); }
}

export async function PUT(req: NextRequest) {
  const { errorResponse } = await requireHRAdmin();
  if (errorResponse) return errorResponse;
  try {
    const body = await req.json();
    const { id, name, startTime, endTime, gracePeriodMinutes, workingDays, isActive } = body;
    const shift = await prisma.shiftTemplate.update({
      where: { id: parseInt(id) },
      data: { name, startTime, endTime, gracePeriodMinutes, workingDays, isActive },
    });
    return NextResponse.json(shift);
  } catch (e) { return serverError(e, "PUT /api/hr/admin/shifts"); }
}
