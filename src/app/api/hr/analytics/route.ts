import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

export async function GET() {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [totalEmployees, activeEmployees, newJoiners, exits, attendanceToday, pendingLeaves, openTickets, totalAssets, assignedAssets] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.employeeProfile.count({ where: { joiningDate: { gte: thisMonth } } }),
      prisma.user.count({ where: { isActive: false, updatedAt: { gte: thisMonth } } }),
      prisma.attendance.groupBy({ by: ["status"], where: { date: new Date(now.getFullYear(), now.getMonth(), now.getDate()) }, _count: true }),
      prisma.leaveApplication.count({ where: { status: "pending" } }),
      prisma.ticket.count({ where: { status: { in: ["open", "in_progress"] } } }),
      prisma.asset.count(),
      prisma.asset.count({ where: { status: "assigned" } }),
    ]);

    const attendanceMap: Record<string, number> = {};
    attendanceToday.forEach((r) => { attendanceMap[r.status] = r._count; });

    const deptBreakdown = await prisma.employeeProfile.groupBy({ by: ["department"], _count: true });
    const typeBreakdown = await prisma.employeeProfile.groupBy({ by: ["employmentType"], _count: true });

    return NextResponse.json({
      workforce: { totalEmployees, activeEmployees, newJoiners, exits },
      attendance: { present: (attendanceMap.present || 0) + (attendanceMap.late || 0), absent: attendanceMap.absent || 0, late: attendanceMap.late || 0, onLeave: attendanceMap.on_leave || 0 },
      leaves: { pendingApprovals: pendingLeaves },
      tickets: { open: openTickets },
      assets: { total: totalAssets, assigned: assignedAssets, available: totalAssets - assignedAssets },
      departments: deptBreakdown.filter((d) => d.department).map((d) => ({ name: d.department, count: d._count })),
      employmentTypes: typeBreakdown.map((t) => ({ type: t.employmentType, count: t._count })),
    });
  } catch (e) { return serverError(e, "GET /api/hr/analytics"); }
}
