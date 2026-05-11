import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { istTodayDateOnly } from "@/lib/ist-date";

export const dynamic = "force-dynamic";

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    // IST "today" — UTC-midnight of the current IST calendar day. Driving
    // the leave-balance year + attendance lookup off this avoids the
    // "shows last year's balance on Jan 1 IST" bug when the server runs UTC.
    const today = istTodayDateOnly();
    const year  = today.getUTCFullYear();

    const members = await prisma.user.findMany({
      where: { managerId: myId, isActive: true },
      select: {
        id: true, name: true, profilePictureUrl: true,
        employeeProfile: { select: { designation: true, department: true } },
        attendances: {
          where: { date: today },
          select: { clockIn: true, clockOut: true, status: true, totalMinutes: true },
          take: 1,
        },
        leaveApplications: {
          where: { status: "pending" },
          select: { id: true, fromDate: true, toDate: true, totalDays: true, leaveType: { select: { name: true } } },
          orderBy: { appliedAt: "desc" },
          take: 5,
        },
        leaveBalances: {
          where: { year },
          select: { totalDays: true, usedDays: true, pendingDays: true, leaveType: { select: { name: true } } },
        },
        goals: {
          where: { status: { not: "completed" } },
          select: { id: true, title: true, progress: true, status: true },
          take: 3,
        },
      },
    });

    return NextResponse.json(members);
  } catch (e) { return serverError(e, "GET /api/hr/my-team"); }
}
