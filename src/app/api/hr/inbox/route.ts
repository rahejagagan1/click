import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const isAdmin = user.orgLevel === "ceo" || user.isDeveloper || user.orgLevel === "hr_manager";

  try {
    const teamFilter = isAdmin ? {} : { user: { managerId: myId } };

    const [pendingLeaves, pendingExpenses, pendingRegs, pendingWFH, pendingOD, pendingCompOff, pendingTravel] = await Promise.all([
      prisma.leaveApplication.findMany({
        where: { status: "pending", ...teamFilter },
        include: { user: { select: { id: true, name: true, profilePictureUrl: true } }, leaveType: { select: { name: true } } },
        orderBy: { appliedAt: "desc" }, take: 20,
      }),
      prisma.expense.findMany({
        where: { status: "pending", ...teamFilter },
        include: { user: { select: { id: true, name: true, profilePictureUrl: true } } },
        orderBy: { createdAt: "desc" }, take: 20,
      }),
      prisma.attendanceRegularization.findMany({
        where: { status: "pending", ...teamFilter },
        include: { user: { select: { id: true, name: true, profilePictureUrl: true } } },
        orderBy: { createdAt: "desc" }, take: 20,
      }),
      prisma.wFHRequest.findMany({
        where: { status: "pending", ...teamFilter },
        include: { user: { select: { id: true, name: true, profilePictureUrl: true } } },
        orderBy: { createdAt: "desc" }, take: 20,
      }),
      prisma.onDutyRequest.findMany({
        where: { status: "pending", ...teamFilter },
        include: { user: { select: { id: true, name: true, profilePictureUrl: true } } },
        orderBy: { createdAt: "desc" }, take: 20,
      }),
      prisma.compOffRequest.findMany({
        where: { status: "pending", ...teamFilter },
        include: { user: { select: { id: true, name: true, profilePictureUrl: true } } },
        orderBy: { createdAt: "desc" }, take: 20,
      }),
      prisma.travelRequest.findMany({
        where: { status: "pending", ...teamFilter },
        include: { user: { select: { id: true, name: true, profilePictureUrl: true } } },
        orderBy: { createdAt: "desc" }, take: 20,
      }),
    ]);

    return NextResponse.json({
      leaves:          pendingLeaves,
      expenses:        pendingExpenses,
      regularizations: pendingRegs,
      wfh:             pendingWFH,
      onDuty:          pendingOD,
      compOff:         pendingCompOff,
      travel:          pendingTravel,
      total: pendingLeaves.length + pendingExpenses.length + pendingRegs.length +
             pendingWFH.length + pendingOD.length + pendingCompOff.length + pendingTravel.length,
    });
  } catch (e) { return serverError(e, "GET /api/hr/inbox"); }
}
