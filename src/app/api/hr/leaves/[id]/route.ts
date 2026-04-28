import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { notifyUsers } from "@/lib/notifications";
import { writeAuditLog } from "@/lib/audit-log";
import { countWorkingDays } from "@/lib/hr/working-days";

function fmtRange(from: Date, to: Date, days: number) {
  return `${from.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} – ${to.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} (${days} day${days === 1 ? "" : "s"})`;
}

// Notification body suffix for approver-written notes. Always rendered on a
// new line with a "Note: " prefix so the bell-panel can detect and pull it
// out into a styled callout (and the "Notes" filter tab can find it).
function noteSuffix(note: string | null | undefined): string {
  const t = (note || "").trim();
  return t ? `\nNote: ${t.slice(0, 240)}` : "";
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const { id: idParam } = await params;
    const appId = Number(idParam);
    if (!Number.isInteger(appId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const approvalNote = typeof body?.approvalNote === "string" ? body.approvalNote : null;

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

    // ── EDIT (HR admin only) ─────────────────────────────────────────
    // Lets HR admins fix mistakes after a leave is filed — change the
    // dates, type, reason, or override the status. Balance/attendance
    // sync only triggers when status crosses the approved boundary.
    if (action === "edit") {
      if (!isFinalApprover) return NextResponse.json({ error: "Only HR admin can edit leaves" }, { status: 403 });

      const newFromRaw   = body?.fromDate;
      const newToRaw     = body?.toDate;
      const newReason    = typeof body?.reason === "string" ? body.reason : undefined;
      const newTypeIdRaw = body?.leaveTypeId;
      const newStatusRaw = typeof body?.status === "string" ? body.status : undefined;

      const data: any = {};
      if (newFromRaw)        data.fromDate    = new Date(newFromRaw);
      if (newToRaw)          data.toDate      = new Date(newToRaw);
      if (newReason !== undefined) data.reason = newReason;
      if (Number.isInteger(newTypeIdRaw)) data.leaveTypeId = newTypeIdRaw;

      // Recompute totalDays if either date changed. Uses the same UTC-safe
      // counter as the POST flow so weekend / holiday handling stays
      // identical across "apply" and "edit".
      if (data.fromDate || data.toDate) {
        const f = data.fromDate ?? new Date(application.fromDate);
        const t = data.toDate   ?? new Date(application.toDate);
        data.totalDays = await countWorkingDays(f, t);
      }

      const validStatuses = ["pending", "partially_approved", "approved", "rejected", "cancelled"];
      if (newStatusRaw && validStatuses.includes(newStatusRaw)) {
        data.status = newStatusRaw;
      }

      await prisma.leaveApplication.update({ where: { id: appId }, data });
      return NextResponse.json({ success: true });
    }

    // ── CANCEL ─────────────────────────────────────────────────────────────
    // Race-safe: only one cancel wins. The status filter inside updateMany is
    // the guard — if another request already cancelled/approved, count === 0.
    if (action === "cancel") {
      if (application.userId !== myId && !isFinalApprover) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const cancellableStatuses = ["pending", "partially_approved", "approved"];
      if (!cancellableStatuses.includes(application.status)) {
        return NextResponse.json({ error: "Cannot cancel" }, { status: 400 });
      }
      const originalStatus = application.status;
      const result = await prisma.$transaction(async (tx) => {
        const { count } = await tx.leaveApplication.updateMany({
          where: { id: appId, status: { in: cancellableStatuses } },
          data:  { status: "cancelled" },
        });
        if (count === 0) return { raced: true as const };
        await tx.leaveBalance.updateMany({
          where: { userId: application.userId, leaveTypeId: application.leaveTypeId, year },
          data: originalStatus === "approved"
            ? { usedDays: { decrement: totalDays } }
            : { pendingDays: { decrement: totalDays } },
        });
        return { raced: false as const };
      });
      if (result.raced) return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });
      return NextResponse.json({ success: true });
    }

    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    // ── REJECT ─────────────────────────────────────────────────────────────
    // Either the direct manager or a final approver can reject. Race-safe.
    if (action === "reject") {
      if (!isFinalApprover && !isDirectManager) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
      if (!["pending", "partially_approved"].includes(application.status)) {
        return NextResponse.json({ error: "Only pending leaves can be rejected" }, { status: 400 });
      }
      const result = await prisma.$transaction(async (tx) => {
        const { count } = await tx.leaveApplication.updateMany({
          where: { id: appId, status: { in: ["pending", "partially_approved"] } },
          data: {
            status: "rejected",
            approvedById: application.approvedById ?? myId,
            approvalNote: approvalNote ?? application.approvalNote,
            finalApprovedById: isFinalApprover ? myId : application.finalApprovedById,
            finalApprovedAt:   isFinalApprover ? new Date() : application.finalApprovedAt,
            finalApprovalNote: isFinalApprover ? approvalNote : application.finalApprovalNote,
          },
        });
        if (count === 0) return { raced: true as const };
        await tx.leaveBalance.updateMany({
          where: { userId: application.userId, leaveTypeId: application.leaveTypeId, year },
          data: { pendingDays: { decrement: totalDays } },
        });
        return { raced: false as const };
      });
      if (result.raced) return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });

      await notifyUsers({
        actorId:  myId,
        userIds:  [application.userId],
        type:     "leave",
        entityId: appId,
        title:    `Your ${application.leaveType?.name || "leave"} request was rejected`,
        body:     `${rangeLabel}${noteSuffix(approvalNote)}`,
        linkUrl:  "/dashboard/hr/leaves",
      });
      return NextResponse.json({ success: true });
    }

    // ── APPROVE — stage 1: manager → partially_approved ───────────────────
    if (application.status === "pending") {
      if (!isDirectManager && !isFinalApprover) return NextResponse.json({ error: "Not authorised" }, { status: 403 });

      // Race-safe: only one stage-1 approval wins. Notifications only fire for the winner.
      const { count } = await prisma.leaveApplication.updateMany({
        where: { id: appId, status: "pending" },
        data:  {
          status:       "partially_approved",
          approvedById: myId,
          approvedAt:   new Date(),
          approvalNote,
        },
      });
      if (count === 0) return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });

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
        body:     `${rangeLabel} — manager approved, awaiting CEO / HR.${noteSuffix(approvalNote)}`,
        linkUrl:  "/dashboard/hr/approvals",
      });
      await notifyUsers({
        actorId:  myId,
        userIds:  [application.userId],
        type:     "leave",
        entityId: appId,
        title:    `Your ${application.leaveType?.name || "leave"} is partially approved`,
        body:     `${rangeLabel} — awaiting final approval from CEO / HR.${noteSuffix(approvalNote)}`,
        linkUrl:  "/dashboard/hr/leaves",
      });
      return NextResponse.json({ success: true });
    }

    // ── APPROVE — stage 2: CEO/HR finalises → balance debit + attendance marks ─
    // This is the most dangerous race: double-debit of leave balance. Guard
    // the status transition, then do the balance + attendance work only for
    // the winner inside the same transaction.
    if (application.status === "partially_approved") {
      if (!isFinalApprover) return NextResponse.json({ error: "Only CEO / HR can finalise" }, { status: 403 });

      const result = await prisma.$transaction(async (tx) => {
        const { count } = await tx.leaveApplication.updateMany({
          where: { id: appId, status: "partially_approved" },
          data: {
            status:            "approved",
            finalApprovedById: myId,
            finalApprovedAt:   new Date(),
            finalApprovalNote: approvalNote,
          },
        });
        if (count === 0) return { raced: true as const };
        await tx.leaveBalance.updateMany({
          where: { userId: application.userId, leaveTypeId: application.leaveTypeId, year },
          data: { pendingDays: { decrement: totalDays }, usedDays: { increment: totalDays } },
        });
        return { raced: false as const };
      });
      if (result.raced) return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });

      // Mark attendance as on_leave for each working day in the range.
      // Attendance.upsert is idempotent on the unique key, so even if two
      // callers reached this far (they can't, but belt-and-braces), the
      // second just re-writes status=on_leave to the same value.
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

      const extras = application.notifyUserIds ?? [];
      await notifyUsers({
        actorId:  myId,
        userIds:  [application.userId, ...extras, ...(application.approvedById ? [application.approvedById] : [])],
        type:     "leave",
        entityId: appId,
        title:    `${application.user?.name || "An employee"}'s ${application.leaveType?.name || "leave"} is approved`,
        body:     `${rangeLabel} — final approval granted.${noteSuffix(approvalNote)}`,
        linkUrl:  "/dashboard/hr/leaves",
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "This request is no longer actionable" }, { status: 400 });
  } catch (e) { return serverError(e, "PUT /api/hr/leaves/[id]"); }
}

/** Delete a leave application outright. HR-admin only. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;
    const isFinalApprover =
      self.orgLevel === "ceo" ||
      self.isDeveloper ||
      self.orgLevel === "hr_manager" ||
      self.role === "admin";
    if (!isFinalApprover) return NextResponse.json({ error: "Only HR admin can delete leaves" }, { status: 403 });

    const { id: idParam } = await params;
    const appId = Number(idParam);
    if (!Number.isInteger(appId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    await prisma.leaveApplication.delete({ where: { id: appId } });
    return NextResponse.json({ success: true });
  } catch (e) { return serverError(e, "DELETE /api/hr/leaves/[id]"); }
}
