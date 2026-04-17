import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, requireHRAdmin, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const year = new Date().getFullYear();
    const holidays = await prisma.holidayCalendar.findMany({
      where: { date: { gte: new Date(year, 0, 1), lte: new Date(year + 1, 11, 31) } },
      orderBy: { date: "asc" },
    });
    return NextResponse.json(holidays);
  } catch (e) { return serverError(e, "GET /api/hr/admin/holidays"); }
}

export async function POST(req: NextRequest) {
  const { errorResponse } = await requireHRAdmin();
  if (errorResponse) return errorResponse;
  try {
    const { name, date, type } = await req.json();
    if (!name || !date) return NextResponse.json({ error: "name and date required" }, { status: 400 });
    const holiday = await prisma.holidayCalendar.create({
      data: { name, date: new Date(date), type: type || "public" },
    });
    return NextResponse.json(holiday, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/admin/holidays"); }
}

export async function DELETE(req: NextRequest) {
  const { errorResponse } = await requireHRAdmin();
  if (errorResponse) return errorResponse;
  try {
    const { searchParams } = new URL(req.url);
    const id = parseInt(searchParams.get("id") || "0");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await prisma.holidayCalendar.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) { return serverError(e, "DELETE /api/hr/admin/holidays"); }
}
