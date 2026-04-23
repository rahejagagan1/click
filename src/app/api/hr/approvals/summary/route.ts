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

    const [leaveCount, regCount, wfhCount, odCount, compOffCount] = await Promise.all([
      prisma.leaveApplication.count({
        where: { status: { in: ["pending", "partially_approved"] }, ...teamWhere },
      }),
      prisma.attendanceRegularization.count({
        where: { status: "pending", ...teamWhere },
      }),
      prisma.wFHRequest.count({
        where: { status: "pending", ...teamWhere },
      }),
      prisma.onDutyRequest.count({
        where: { status: "pending", ...teamWhere },
      }),
      prisma.compOffRequest.count({
        where: { status: "pending", ...teamWhere },
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
