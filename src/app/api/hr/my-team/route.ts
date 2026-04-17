import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
          where: { year: today.getFullYear() },
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
