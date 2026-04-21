import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { istTodayDateOnly } from "@/lib/ist-date";

export async function POST(_req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const user = session!.user as any;
    let userId: number = user.dbId;
    if (!userId && user.email) {
      const dbUser = await prisma.user.findUnique({ where: { email: user.email }, select: { id: true } });
      userId = dbUser?.id!;
    }
    if (!userId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const now = new Date();
    const today = istTodayDateOnly();

    const existing = await prisma.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    if (!existing?.clockIn) return NextResponse.json({ error: "You haven't clocked in today" }, { status: 400 });
    if (existing.clockOut) return NextResponse.json({ error: "Already clocked out today" }, { status: 400 });

    const totalMinutes = Math.floor((now.getTime() - existing.clockIn!.getTime()) / 60000);
    let status = existing.status;
    if (totalMinutes >= 480) status = existing.status === "late" ? "late" : "present";
    else if (totalMinutes >= 240) status = "half_day";
    const overtimeMinutes = Math.max(0, totalMinutes - 540);

    const record = await prisma.attendance.update({
      where: { userId_date: { userId, date: today } },
      data: { clockOut: now, totalMinutes, status, overtimeMinutes },
    });
    return NextResponse.json(record);
  } catch (e) {
    return serverError(e, "POST /api/hr/attendance/clock-out");
  }
}
