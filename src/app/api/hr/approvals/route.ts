import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { serializeBigInt } from "@/lib/utils";

export const dynamic = "force-dynamic";

// GET /api/hr/approvals?tab=leave|regularize|wfh|on_duty|comp_off
//
// Scope:
//  - CEO / HR manager / developer: every pending request across the org.
//  - Manager (has direct reports): requests from their own team only.
//  - Everyone else: 403.
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;

    // Mirrors src/lib/access.ts:isHRAdmin — was missing special_access
    // + role=hr_manager. Tanvi-style HR Managers couldn't see the
    // approvals queue.
    const isFinalApprover =
        self.orgLevel === "ceo" ||
        self.isDeveloper ||
        self.orgLevel === "hr_manager" ||
        self.orgLevel === "special_access" ||
        self.role === "admin" ||
        self.role === "hr_manager";

    // Final approvers see everything — they don't need a DB row to view.
    // Everyone else must resolve to a User id so we can scope to their team.
    let myId: number | null = null;
    let isManager = false;
    if (!isFinalApprover) {
      myId = await resolveUserId(session);
      if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
      const reportCount = await prisma.user.count({ where: { managerId: myId, isActive: true } });
      isManager = reportCount > 0;
      if (!isManager) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const tab   = (searchParams.get("tab") || "leave").toLowerCase();
    // scope: "pending" (default — only actionable rows) or "all" (history audit
    // trail — includes approved, rejected, cancelled, partially_approved).
    const scope = (searchParams.get("scope") || "pending").toLowerCase();

    // Team scope for managers (self excluded). Final approvers see everything.
    const teamWhere: any = isFinalApprover
      ? {}
      : { user: { managerId: myId! } };

    const selectUser = { id: true, name: true, email: true, profilePictureUrl: true, teamCapsule: true, role: true };
    const selectProfile = { department: true, designation: true, workLocation: true, employeeId: true };

    const includeUser = {
      user: { select: { ...selectUser, employeeProfile: { select: selectProfile } } },
      approver: { select: { id: true, name: true } },
    };

    // Status filter — "all" shows the full history for audit; "pending"
    // shows only actionable rows.
    const statusFilter = (pendingStatuses: string[]) =>
      scope === "all" ? {} : { status: { in: pendingStatuses } };

    if (tab === "leave") {
      const rows = await prisma.leaveApplication.findMany({
        where: {
          ...statusFilter(["pending", "partially_approved"]),
          ...teamWhere,
        },
        include: {
          leaveType: true,
          ...includeUser,
          finalApprover: { select: { id: true, name: true } },
        },
        orderBy: { appliedAt: "desc" },
        take: 300,
      });

      // Count badge: total pending leaves the viewer can still act on.
      const pendingForViewer = rows.filter((r) => {
        if (r.status === "pending") {
          // Managers can act on their team's pending; CEO / HR can also step in.
          return isManager || isFinalApprover;
        }
        if (r.status === "partially_approved") {
          return isFinalApprover;
        }
        return false;
      }).length;

      return NextResponse.json(serializeBigInt({ items: rows, count: pendingForViewer }));
    }

    if (tab === "regularize") {
      // Regularization is HR-admin-only — managers don't see this queue at
      // all (they can't approve, so showing them empty pending rows is just
      // noise). Final approvers see everything.
      if (!isFinalApprover) {
        return NextResponse.json(serializeBigInt({ items: [], count: 0 }));
      }
      const rows = await prisma.attendanceRegularization.findMany({
        where: { ...statusFilter(["pending", "partially_approved"]) },
        include: includeUser,
        orderBy: { createdAt: "desc" },
        take: 300,
      });
      return NextResponse.json(serializeBigInt({ items: rows, count: rows.length }));
    }

    if (tab === "wfh") {
      // "WFH / OD" tab combines both request types — they're workflow-identical.
      // Both flow through L1 (manager) → L2 (HR/CEO/Dev), so include
      // partially_approved so final approvers see stage-2 items.
      const [wfhRows, odRows] = await Promise.all([
        prisma.wFHRequest.findMany({
          where: { ...statusFilter(["pending", "partially_approved"]), ...teamWhere },
          include: includeUser,
          orderBy: { createdAt: "desc" },
          take: 300,
        }),
        prisma.onDutyRequest.findMany({
          where: { ...statusFilter(["pending", "partially_approved"]), ...teamWhere },
          include: includeUser,
          orderBy: { createdAt: "desc" },
          take: 300,
        }),
      ]);
      const items = [
        ...wfhRows.map((r) => ({ ...r, _kind: "wfh" as const })),
        ...odRows.map((r)  => ({ ...r, _kind: "on_duty" as const })),
      ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return NextResponse.json(serializeBigInt({ items, count: items.length }));
    }

    if (tab === "comp_off") {
      // Comp-off also runs the L1 → L2 flow now — include partially_approved.
      const rows = await prisma.compOffRequest.findMany({
        where: { ...statusFilter(["pending", "partially_approved"]), ...teamWhere },
        include: includeUser,
        orderBy: { createdAt: "desc" },
        take: 300,
      });
      return NextResponse.json(serializeBigInt({ items: rows, count: rows.length }));
    }

    // Other tabs (leave_encashment, half_day, shift_weekly_off) don't have
    // backing tables yet — return empty + surface a consistent shape.
    return NextResponse.json({ items: [], count: 0 });
  } catch (e) { return serverError(e, "GET /api/hr/approvals"); }
}
