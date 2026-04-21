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
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const isFinalApprover =
        self.orgLevel === "ceo" ||
        self.isDeveloper ||
        self.orgLevel === "hr_manager" ||
        self.role === "admin";
    const reportCount = await prisma.user.count({ where: { managerId: myId, isActive: true } });
    const isManager = reportCount > 0;
    if (!isFinalApprover && !isManager) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const tab = (searchParams.get("tab") || "leave").toLowerCase();

    // Team scope for managers (self excluded).
    const teamWhere: any = isFinalApprover
      ? {}
      : { user: { managerId: myId } };

    const selectUser = { id: true, name: true, email: true, profilePictureUrl: true, teamCapsule: true, role: true };
    const selectProfile = { department: true, designation: true, workLocation: true, employeeId: true };

    if (tab === "leave") {
      const rows = await prisma.leaveApplication.findMany({
        where: {
          status: { in: ["pending", "partially_approved"] },
          ...teamWhere,
        },
        include: {
          leaveType: true,
          user: { select: { ...selectUser, employeeProfile: { select: selectProfile } } },
          approver:      { select: { id: true, name: true } },
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

    // Placeholder for other tabs — not yet wired, returns empty.
    return NextResponse.json({ items: [], count: 0 });
  } catch (e) { return serverError(e, "GET /api/hr/approvals"); }
}
