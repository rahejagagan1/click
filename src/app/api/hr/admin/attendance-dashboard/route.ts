import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, isHRAdmin, serverError } from "@/lib/api-auth";
import { istTodayDateOnly } from "@/lib/ist-date";
import { parseAttLoc } from "@/lib/attendance-location";
import { serializeBigInt } from "@/lib/utils";
import { getPoliciesByUser } from "@/lib/hr/notification-policy";

export const dynamic = "force-dynamic";

// GET /api/hr/admin/attendance-dashboard
// Returns today's attendance snapshot for every active employee along with
// their department / team capsule (for the filter dropdowns). Access is
// limited to admin / CEO / HR manager / developer — everyone else gets 403.
export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const self = session!.user as any;
  if (!isHRAdmin(self)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const today = istTodayDateOnly();

    const usersAll = await prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, email: true, role: true, orgLevel: true,
        teamCapsule: true, profilePictureUrl: true,
        employeeProfile: { select: { department: true, designation: true, employeeId: true, workLocation: true } },
      },
    });
    // Drop anyone whose Attendance toggle is OFF — they're "off the
    // books" for attendance (CEO + developers default OFF). The whole
    // dashboard, counts and rows, simply pretends they don't exist.
    const policies = await getPoliciesByUser(usersAll.map((u) => u.id));
    const users = usersAll.filter((u) => policies.get(u.id)?.attendanceEnabled !== false);

    const todayRows = await prisma.attendance.findMany({
      where: { date: today },
      select: {
        userId: true, status: true, clockIn: true, clockOut: true,
        totalMinutes: true, location: true,
      },
    });
    const byUser = new Map(todayRows.map((r) => [r.userId, r]));

    // Anyone with a LeaveApplication that covers today, in any status that
    // isn't rejected/cancelled, counts as "on_leave" even when there's no
    // synthesised Attendance row yet. Mirrors /api/hr/attendance/board so
    // the HR Dashboard agrees with the HR Home page's On Leave list.
    const leaveTodayRows = await prisma.leaveApplication.findMany({
      where: {
        fromDate: { lte: today },
        toDate:   { gte: today },
        status:   { notIn: ["rejected", "cancelled"] },
      },
      select: { userId: true },
    });
    const onLeaveIds = new Set<number>(leaveTodayRows.map((r) => r.userId));

    // Anyone with a WFH request for today (any non-final status). Mirrors
    // /api/hr/attendance/board. Tracked as its OWN tab on the dashboard —
    // a WFH applicant shows up under WFH regardless of whether their
    // clock-in was tagged office or remote, while the Remote Clock-in tab
    // remains a pure "GPS said remote" view.
    const wfhTodayRows = await prisma.wFHRequest.findMany({
      where: { date: today, status: { notIn: ["rejected", "cancelled"] } },
      select: { userId: true },
    });
    const wfhTodayIds = new Set<number>(wfhTodayRows.map((r) => r.userId));

    const rows = users.map((u) => {
      const rec = byUser.get(u.id) ?? null;
      const loc = rec ? parseAttLoc(rec.location) : null;
      const mode = loc?.mode ?? null; // "office" | "remote" | null
      // On-leave wins over a stray clock-in that day so an approved
      // half-day still appears in the On Leave list. The Attendance.status
      // check stays first so an explicit on_leave row is honored
      // regardless of LeaveApplication state.
      const status =
        rec?.status === "on_leave" || onLeaveIds.has(u.id) ? "on_leave" :
        rec?.clockIn ? (mode === "remote" ? "remote" : "office") :
        "absent";
      return {
        id:           u.id,
        name:         u.name,
        email:        u.email,
        role:         u.role,
        orgLevel:     u.orgLevel,
        profilePictureUrl: u.profilePictureUrl,
        teamCapsule:  u.teamCapsule,
        employeeId:   u.employeeProfile?.employeeId  ?? null,
        designation:  u.employeeProfile?.designation ?? null,
        department:   u.employeeProfile?.department  ?? null,
        workLocation: u.employeeProfile?.workLocation ?? null,
        clockIn:      rec?.clockIn  ?? null,
        clockOut:     rec?.clockOut ?? null,
        totalMinutes: rec?.totalMinutes ?? 0,
        rawStatus:    rec?.status ?? "absent",
        locationAddress: loc?.address ?? null,
        locationMode:    mode,
        locationLat:     loc?.lat   ?? null,
        locationLng:     loc?.lng   ?? null,
        status, // derived: on_leave | remote | office | absent
        wfhToday: wfhTodayIds.has(u.id),
      };
    });

    const counts = {
      total:        rows.length,
      present:      rows.filter((r) => r.status === "office" || r.status === "remote").length,
      office:       rows.filter((r) => r.status === "office").length,
      remote:       rows.filter((r) => r.status === "remote").length,
      // WFH = anyone who applied for WFH today (intent). Can overlap with
      // any other tab (e.g. a WFH applicant who clocked in remote counts
      // toward both Remote Clock-in and WFH).
      wfh:          rows.filter((r) => r.wfhToday).length,
      onLeave:      rows.filter((r) => r.status === "on_leave").length,
      notClockedIn: rows.filter((r) => r.status === "absent").length,
      late:         rows.filter((r) => r.rawStatus === "late").length,
    };

    return NextResponse.json(serializeBigInt({ rows, counts, date: today.toISOString().slice(0, 10) }));
  } catch (e) { return serverError(e, "GET /api/hr/admin/attendance-dashboard"); }
}
