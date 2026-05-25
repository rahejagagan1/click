// GET /api/hr/payroll/attendance-summary?month=N&year=YYYY&kind=no_attendance|lop|lop_reversal
//
// Three Step 1 sub-steps share one endpoint, differentiated by ?kind=.
//   no_attendance : every active employee whose Attendance.absent count == 0
//                   AND present count == 0 for the cycle. Means HR forgot
//                   to mark them, or they were never clocked in.
//   lop           : per-user absent + half-day counts contributing to LOP.
//   lop_reversal  : approved leaves on a paid LeaveType that overlap the
//                   cycle — these should reverse any LOP otherwise stamped
//                   by an absent attendance row on the same date.
//
// HR-admin only.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { searchParams } = new URL(req.url);
    const month = parseInt(searchParams.get("month") ?? "");
    const year  = parseInt(searchParams.get("year")  ?? "");
    const kind  = String(searchParams.get("kind") ?? "");
    if (!Number.isFinite(month) || month < 0 || month > 11)
      return NextResponse.json({ error: "Bad month" }, { status: 400 });
    if (!Number.isFinite(year))
      return NextResponse.json({ error: "Bad year" }, { status: 400 });
    if (!["no_attendance", "lop", "lop_reversal"].includes(kind))
      return NextResponse.json({ error: "Bad kind" }, { status: 400 });

    const monthStart = new Date(Date.UTC(year, month, 1));
    const monthEnd   = new Date(Date.UTC(year, month + 1, 0));

    if (kind === "no_attendance") {
      const rows = await prisma.$queryRawUnsafe<{
        userId: number; userName: string; employeeId: string | null;
      }[]>(
        `SELECT u.id AS "userId", u.name AS "userName", ep."employeeId"
           FROM "User" u
      LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
          WHERE u."isActive" = TRUE
            AND NOT EXISTS (
              SELECT 1 FROM "Attendance" a
               WHERE a."userId" = u.id
                 AND a.date >= $1 AND a.date <= $2
            )
          ORDER BY u.name ASC`,
        monthStart, monthEnd,
      );
      return NextResponse.json({ items: rows });
    }

    if (kind === "lop") {
      const rows = await prisma.$queryRawUnsafe<{
        userId: number; userName: string; employeeId: string | null;
        absentDays: string; halfDays: string; lopDays: string;
      }[]>(
        `SELECT a."userId",
                u.name AS "userName",
                ep."employeeId",
                SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END)::text         AS "absentDays",
                SUM(CASE WHEN a.status = 'half_day' THEN 1 ELSE 0 END)::text       AS "halfDays",
                (SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END)
                 + SUM(CASE WHEN a.status = 'half_day' THEN 0.5 ELSE 0 END))::text AS "lopDays"
           FROM "Attendance" a
           JOIN "User" u ON u.id = a."userId"
      LEFT JOIN "EmployeeProfile" ep ON ep."userId" = a."userId"
          WHERE a.date >= $1 AND a.date <= $2
            AND a.status IN ('absent', 'half_day')
          GROUP BY a."userId", u.name, ep."employeeId"
         HAVING SUM(CASE WHEN a.status IN ('absent','half_day') THEN 1 ELSE 0 END) > 0
          ORDER BY "lopDays" DESC`,
        monthStart, monthEnd,
      );
      return NextResponse.json({ items: rows });
    }

    // lop_reversal — leaves approved on a paid LeaveType during the cycle
    const rows = await prisma.$queryRawUnsafe<{
      id: number; userId: number; userName: string; employeeId: string | null;
      leaveType: string; fromDate: Date; toDate: Date; totalDays: string;
    }[]>(
      `SELECT la.id, la."userId", u.name AS "userName", ep."employeeId",
              lt.name AS "leaveType", la."fromDate", la."toDate",
              la."totalDays"::text AS "totalDays"
         FROM "LeaveApplication" la
         JOIN "User" u ON u.id = la."userId"
    LEFT JOIN "EmployeeProfile" ep ON ep."userId" = la."userId"
         JOIN "LeaveType" lt ON lt.id = la."leaveTypeId"
        WHERE la.status = 'approved'
          AND lt."isPaid" = TRUE
          AND la."fromDate" <= $2
          AND la."toDate"   >= $1
        ORDER BY la."fromDate" DESC`,
      monthStart, monthEnd,
    );
    return NextResponse.json({ items: rows });
  } catch (e) { return serverError(e, "GET /api/hr/payroll/attendance-summary"); }
}
