import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { notifyUsers } from "@/lib/notifications";

function fmtRange(from: Date, to: Date, days: number) {
  return `${from.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} – ${to.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} (${days} day${days === 1 ? "" : "s"})`;
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const appId = parseInt(params.id);
    const { action, approvalNote } = await req.json();
    const application = await prisma.leaveApplication.findUnique({
      where: { id: appId },
      include: { leaveType: true, user: { select: { id: true, name: true, managerId: true } } },
    });
    if (!application) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isFinalApprover =
      self.orgLevel === "ceo" ||
      self.isDeveloper ||
      self.orgLevel === "hr_manager" ||
      self.role === "admin";
    const isDirectManager = application.user?.managerId === myId;
    const year = new Date(application.fromDate).getFullYear();
    const totalDays = parseFloat(application.totalDays.toString());
    const rangeLabel = fmtRange(new Date(application.fromDate), new Date(application.toDate), totalDays);

    // ── CANCEL ─────────────────────────────────────────────────────────────
    if (action === "cancel") {
      if (application.userId !== myId && !isFinalApprover) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (!["pending", "partially_approved", "approved"].includes(application.status)) {
        return NextResponse.json({ error: "Cannot cancel" }, { status: 400 });
      }
      await prisma.$transaction([
        prisma.leaveApplication.update({ where: { id: appId }, data: { status: "cancelled" } }),
        prisma.leaveBalance.updateMany({
          where: { userId: application.userId, leaveTypeId: application.leaveTypeId, year },
          data: application.status === "approved"
            ? { usedDays: { decrement: totalDays } }
            : { pendingDays: { decrement: totalDays } },
        }),
      ]);
      return NextResponse.json({ success: true });
    }

    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    // ── REJECT — any stage, either the manager or a final approver can reject ─
    if (action === "reject") {
      if (!isFinalApprover && !isDirectManager) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
      if (!["pending", "partially_approved"].includes(application.status)) {
        return NextResponse.json({ error: "Only pending leaves can be rejected" }, { status: 400 });
      }
      await prisma.$transaction([
        prisma.leaveApplication.update({
          where: { id: appId },
          data: {
            status: "rejected",
            approvedById: application.approvedById ?? myId,
            approvalNote: approvalNote ?? application.approvalNote,
            finalApprovedById: isFinalApprover ? myId : application.finalApprovedById,
            finalApprovedAt:   isFinalApprover ? new Date() : application.finalApprovedAt,
            finalApprovalNote: isFinalApprover ? approvalNote : application.finalApprovalNote,
          },
        }),
        prisma.leaveBalance.updateMany({
          where: { userId: application.userId, leaveTypeId: application.leaveTypeId, year },
          data: { pendingDays: { decrement: totalDays } },
        }),
      ]);
      // Notify the applicant.
      await notifyUsers({
        actorId:  myId,
        userIds:  [application.userId],
        type:     "leave",
        entityId: appId,
        title:    `Your ${application.leaveType?.name || "leave"} request was rejected`,
        body:     `${rangeLabel}${approvalNote ? ` — ${String(approvalNote).slice(0, 160)}` : ""}`,
        linkUrl:  "/dashboard/hr/leaves",
      });
      return NextResponse.json({ success: true });
    }

    // ── APPROVE ────────────────────────────────────────────────────────────
    // Stage 1: manager approves a pending request → partially_approved, notify CEO/HR.
    if (application.status === "pending") {
      if (!isDirectManager && !isFinalApprover) return NextResponse.json({ error: "Not authorised" }, { status: 403 });

      await prisma.leaveApplication.update({
        where: { id: appId },
        data: {
          status:       "partially_approved",
          approvedById: myId,
          approvedAt:   new Date(),
          approvalNote,
        },
      });

      // Queue stage-2 approvers: every active CEO / HR manager (minus the actor).
      const finalApprovers = await prisma.user.findMany({
        where: { isActive: true, orgLevel: { in: ["ceo", "hr_manager"] } },
        select: { id: true },
      });
      const extras = application.notifyUserIds ?? [];
      await notifyUsers({
        actorId:  myId,
        userIds:  [...finalApprovers.map((u) => u.id), ...extras],
        type:     "leave",
        entityId: appId,
        title:    `${application.user?.name || "An employee"}'s ${application.leaveType?.name || "leave"} needs final approval`,
        body:     `${rangeLabel} — manager approved, awaiting CEO / HR.`,
        linkUrl:  "/dashboard/hr/approvals",
      });
      // Let the applicant know stage 1 is done.
      await notifyUsers({
        actorId:  myId,
        userIds:  [application.userId],
        type:     "leave",
        entityId: appId,
        title:    `Your ${application.leaveType?.name || "leave"} is partially approved`,
        body:     `${rangeLabel} — awaiting final approval from CEO / HR.`,
        linkUrl:  "/dashboard/hr/leaves",
      });
      return NextResponse.json({ success: true });
    }

    // Stage 2: CEO / HR finalises a partially_approved request → approved, deduct balance.
    if (application.status === "partially_approved") {
      if (!isFinalApprover) return NextResponse.json({ error: "Only CEO / HR can finalise" }, { status: 403 });

      await prisma.$transaction([
        prisma.leaveApplication.update({
          where: { id: appId },
          data: {
            status:            "approved",
            finalApprovedById: myId,
            finalApprovedAt:   new Date(),
            finalApprovalNote: approvalNote,
          },
        }),
        prisma.leaveBalance.updateMany({
          where: { userId: application.userId, leaveTypeId: application.leaveTypeId, year },
          data: { pendingDays: { decrement: totalDays }, usedDays: { increment: totalDays } },
        }),
      ]);

      // Mark attendance as on_leave for each working day in the range.
      const from = new Date(application.fromDate), to = new Date(application.toDate);
      const cur = new Date(from);
      while (cur <= to) {
        if (cur.getDay() !== 0 && cur.getDay() !== 6) {
          const dateOnly = new Date(Date.UTC(cur.getFullYear(), cur.getMonth(), cur.getDate()));
          await prisma.attendance.upsert({
            where: { userId_date: { userId: application.userId, date: dateOnly } },
            create: { userId: application.userId, date: dateOnly, status: "on_leave" },
            update: { status: "on_leave" },
          });
        }
        cur.setDate(cur.getDate() + 1);
      }

      // Notify applicant + the extras they tagged + the stage-1 approver.
      const extras = application.notifyUserIds ?? [];
      await notifyUsers({
        actorId:  myId,
        userIds:  [application.userId, ...extras, ...(application.approvedById ? [application.approvedById] : [])],
        type:     "leave",
        entityId: appId,
        title:    `${application.user?.name || "An employee"}'s ${application.leaveType?.name || "leave"} is approved`,
        body:     `${rangeLabel} — final approval granted.`,
        linkUrl:  "/dashboard/hr/leaves",
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "This request is no longer actionable" }, { status: 400 });
  } catch (e) { return serverError(e, "PUT /api/hr/leaves/[id]"); }
}
