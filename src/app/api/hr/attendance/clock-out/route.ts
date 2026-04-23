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

    // Read once to compute duration + status; we still race-guard at write time.
    const existing = await prisma.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    if (!existing?.clockIn) {
      return NextResponse.json({ error: "You haven't clocked in today" }, { status: 400 });
    }
    if (existing.clockOut) {
      return NextResponse.json({ error: "Already clocked out today" }, { status: 409 });
    }

    const totalMinutes = Math.floor((now.getTime() - existing.clockIn.getTime()) / 60000);
    // Strict 9-hour shift: must complete 540 minutes for a full day.
    // ≥ 4.5h (270 min) but < 9h → half_day. "late" is preserved on full completion.
    let status = existing.status;
    if (totalMinutes >= 540) status = existing.status === "late" ? "late" : "present";
    else if (totalMinutes >= 270) status = "half_day";
    const overtimeMinutes = Math.max(0, totalMinutes - 540);

    // ── Race-safe clock-out ─────────────────────────────────────────────
    // Atomic conditional update: only write clockOut if it's STILL null.
    // If two requests arrive together, only the first one's updateMany
    // matches (count === 1); the second sees count === 0 and returns 409.
    const updated = await prisma.attendance.updateMany({
      where: { userId, date: today, clockOut: null },
      data: { clockOut: now, totalMinutes, status, overtimeMinutes },
    });
    if (updated.count === 0) {
      return NextResponse.json({ error: "Already clocked out today" }, { status: 409 });
    }

    const record = await prisma.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    return NextResponse.json(record);
  } catch (e) {
    return serverError(e, "POST /api/hr/attendance/clock-out");
  }
}
