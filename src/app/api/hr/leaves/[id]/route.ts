import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const appId = parseInt(params.id);
    const { action, approvalNote } = await req.json();
    const application = await prisma.leaveApplication.findUnique({ where: { id: appId } });
    if (!application) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isAdmin = self.orgLevel === "ceo" || self.isDeveloper || self.orgLevel === "hr_manager";
    const year = new Date(application.fromDate).getFullYear();
    const totalDays = parseFloat(application.totalDays.toString());

    if (action === "cancel") {
      if (application.userId !== myId && !isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (!["pending", "approved"].includes(application.status)) return NextResponse.json({ error: "Cannot cancel" }, { status: 400 });
      await prisma.$transaction([
        prisma.leaveApplication.update({ where: { id: appId }, data: { status: "cancelled" } }),
        prisma.leaveBalance.updateMany({
          where: { userId: application.userId, leaveTypeId: application.leaveTypeId, year },
          data: application.status === "approved" ? { usedDays: { decrement: totalDays } } : { pendingDays: { decrement: totalDays } },
        }),
      ]);
      return NextResponse.json({ success: true });
    }

    if (action === "approve" || action === "reject") {
      if (!isAdmin) {
        const teamMember = await prisma.user.findFirst({ where: { id: application.userId, managerId: myId } });
        if (!teamMember) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
      }
      if (application.status !== "pending") return NextResponse.json({ error: "Only pending leaves can be acted on" }, { status: 400 });

      if (action === "approve") {
        await prisma.$transaction([
          prisma.leaveApplication.update({ where: { id: appId }, data: { status: "approved", approvedById: myId, approvalNote } }),
          prisma.leaveBalance.updateMany({
            where: { userId: application.userId, leaveTypeId: application.leaveTypeId, year },
            data: { pendingDays: { decrement: totalDays }, usedDays: { increment: totalDays } },
          }),
        ]);
        // Mark attendance as on_leave
        const from = new Date(application.fromDate), to = new Date(application.toDate);
        const cur = new Date(from);
        while (cur <= to) {
          if (cur.getDay() !== 0 && cur.getDay() !== 6) {
            const dateOnly = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate());
            await prisma.attendance.upsert({
              where: { userId_date: { userId: application.userId, date: dateOnly } },
              create: { userId: application.userId, date: dateOnly, status: "on_leave" },
              update: { status: "on_leave" },
            });
          }
          cur.setDate(cur.getDate() + 1);
        }
      } else {
        await prisma.$transaction([
          prisma.leaveApplication.update({ where: { id: appId }, data: { status: "rejected", approvedById: myId, approvalNote } }),
          prisma.leaveBalance.updateMany({
            where: { userId: application.userId, leaveTypeId: application.leaveTypeId, year },
            data: { pendingDays: { decrement: totalDays } },
          }),
        ]);
      }
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e) { return serverError(e, "PUT /api/hr/leaves/[id]"); }
}
