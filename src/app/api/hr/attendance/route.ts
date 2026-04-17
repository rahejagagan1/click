import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

// GET /api/hr/attendance?userId=X&month=2026-04
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const self = session!.user as any;
    const { searchParams } = new URL(req.url);
    const isAdmin = self.orgLevel === "ceo" || self.isDeveloper || self.orgLevel === "hr_manager";

    // Resolve dbId — fallback to DB lookup by email if session doesn't have it
    let myDbId = self.dbId;
    if (!myDbId && self.email) {
      const dbUser = await prisma.user.findUnique({ where: { email: self.email }, select: { id: true } });
      myDbId = dbUser?.id;
    }
    if (!myDbId) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const targetUserId = isAdmin
      ? parseInt(searchParams.get("userId") || String(myDbId))
      : myDbId;

    const month = searchParams.get("month");
    let fromDate: Date, toDate: Date;
    if (month) {
      const [y, m] = month.split("-").map(Number);
      fromDate = new Date(y, m - 1, 1);
      toDate = new Date(y, m, 0);
    } else {
      const now = new Date();
      fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
      toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }

    const records = await prisma.attendance.findMany({
      where: { userId: targetUserId, date: { gte: fromDate, lte: toDate } },
      orderBy: { date: "asc" },
    });

    const summary = { present: 0, absent: 0, late: 0, halfDay: 0, onLeave: 0, totalOvertimeMinutes: 0 };
    for (const r of records) {
      if (r.status === "present") summary.present++;
      else if (r.status === "absent") summary.absent++;
      else if (r.status === "late") { summary.late++; summary.present++; }
      else if (r.status === "half_day") summary.halfDay++;
      else if (r.status === "on_leave") summary.onLeave++;
      summary.totalOvertimeMinutes += r.overtimeMinutes;
    }

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayRecord = await prisma.attendance.findUnique({
      where: { userId_date: { userId: targetUserId, date: today } },
    });

    return NextResponse.json({ records, summary, todayRecord });
  } catch (e) {
    return serverError(e, "GET /api/hr/attendance");
  }
}
