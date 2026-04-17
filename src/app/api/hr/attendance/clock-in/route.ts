import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
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
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || undefined;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const existing = await prisma.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    if (existing?.clockIn) {
      return NextResponse.json({ error: "Already clocked in today" }, { status: 400 });
    }

    const userShift = await prisma.userShift.findUnique({
      where: { userId }, include: { shift: true },
    });

    let status = "present";
    if (userShift?.shift) {
      const [sh, sm] = userShift.shift.startTime.split(":").map(Number);
      const shiftStart = new Date(today);
      shiftStart.setHours(sh, sm + 15, 0);
      if (now > shiftStart) status = "late";
    }

    const record = await prisma.attendance.upsert({
      where: { userId_date: { userId, date: today } },
      create: { userId, date: today, clockIn: now, status, ipAddress: ip },
      update: { clockIn: now, status, ipAddress: ip },
    });
    return NextResponse.json(record);
  } catch (e) {
    return serverError(e, "POST /api/hr/attendance/clock-in");
  }
}
