import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, requireHRAdmin, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const shifts = await prisma.shift.findMany({ orderBy: { name: "asc" } });
    return NextResponse.json(shifts);
  } catch (e) { return serverError(e, "GET /api/hr/admin/shifts"); }
}

export async function POST(req: NextRequest) {
  const { errorResponse } = await requireHRAdmin();
  if (errorResponse) return errorResponse;
  try {
    const body = await req.json();
    // Frontend uses gracePeriodMinutes / workingDays; the Shift model
    // stores breakMinutes / workDays. Accept either alias.
    const { name, startTime, endTime } = body;
    const breakMinutes = body.breakMinutes ?? body.gracePeriodMinutes ?? 60;
    const workDays = body.workDays ?? body.workingDays ?? ["Mon","Tue","Wed","Thu","Fri"];
    if (!name || !startTime || !endTime) return NextResponse.json({ error: "name, startTime, endTime required" }, { status: 400 });
    const shift = await prisma.shift.create({
      data: { name, startTime, endTime, breakMinutes, workDays },
    });
    return NextResponse.json(shift, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/admin/shifts"); }
}

export async function PUT(req: NextRequest) {
  const { errorResponse } = await requireHRAdmin();
  if (errorResponse) return errorResponse;
  try {
    const body = await req.json();
    const { id, name, startTime, endTime } = body;
    const breakMinutes = body.breakMinutes ?? body.gracePeriodMinutes;
    const workDays = body.workDays ?? body.workingDays;
    const shift = await prisma.shift.update({
      where: { id: parseInt(id) },
      data: { name, startTime, endTime, breakMinutes, workDays },
    });
    return NextResponse.json(shift);
  } catch (e) { return serverError(e, "PUT /api/hr/admin/shifts"); }
}
