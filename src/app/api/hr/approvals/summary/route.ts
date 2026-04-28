import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// GET /api/hr/approvals/summary
// Returns pending counts per approvals tab so the HR Dashboard left-rail
// badge and the ApprovalsPanel sub-tab badges share one query.
//
// Scope rules match /api/hr/approvals:
//  • CEO / HR manager / developer / admin → every pending request org-wide.
//  • Manager (has direct reports)          → their team only.
//  • Everyone else                         → forbidden.
export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;
    const isFinalApprover =
      self.orgLevel === "ceo" ||
      self.isDeveloper ||
      self.orgLevel === "hr_manager" ||
      self.role === "admin";

    let myId: number | null = null;
    if (!isFinalApprover) {
      myId = await resolveUserId(session);
      if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
      const reports = await prisma.user.count({ where: { managerId: myId, isActive: true } });
      if (reports === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const teamWhere: any = isFinalApprover ? {} : { user: { managerId: myId! } };
    // Open-status filter: every request type now uses the L1 → L2 flow,
    // except regularization (HR-admin-only, single-stage). For non-leave
    // request types, both pending (awaiting L1) and partially_approved
    // (awaiting L2) count toward the inbox badge.
    const openTwoStage = { status: { in: ["pending", "partially_approved"] } };

    const [leaveCount, regCount, wfhCount, odCount, compOffCount] = await Promise.all([
      prisma.leaveApplication.count({
        where: { ...openTwoStage, ...teamWhere },
      }),
      // Regularization is HR-admin-only — managers don't see it in their
      // count at all. Final approvers see every open row.
      isFinalApprover
        ? prisma.attendanceRegularization.count({ where: openTwoStage })
        : Promise.resolve(0),
      prisma.wFHRequest.count({
        where: { ...openTwoStage, ...teamWhere },
      }),
      prisma.onDutyRequest.count({
        where: { ...openTwoStage, ...teamWhere },
      }),
      prisma.compOffRequest.count({
        where: { ...openTwoStage, ...teamWhere },
      }),
    ]);

    const wfhTotal = wfhCount + odCount; // WFH / OD tab combines both.

    return NextResponse.json({
      byTab: {
        leave:            leaveCount,
        leave_encashment: 0,
        comp_off:         compOffCount,
        regularize:       regCount,
        wfh:              wfhTotal,
        half_day:         0,
        shift_weekly_off: 0,
      },
      total: leaveCount + regCount + wfhTotal + compOffCount,
    });
  } catch (e) { return serverError(e, "GET /api/hr/approvals/summary"); }
}
