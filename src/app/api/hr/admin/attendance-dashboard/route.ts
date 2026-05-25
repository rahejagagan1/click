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
        employeeProfile: { select: { department: true, designation: true, employeeId: true, workLocation: true, attendanceCaptureScheme: true } },
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
      // Status priority — on_leave > wfh > office/remote > absent.
      //   on_leave   approved leave covering today (or an explicit
      //              Attendance.status="on_leave" override) wins over
      //              everything so an approved half-day still shows in
      //              the On Leave list.
      //   wfh        the person applied for WFH today AND has actually
      //              clocked in — their authorised state is WFH, so the
      //              pill should say "WFH" instead of "In Office"
      //              (office capture-scheme) or "Remote" (geofence off-
      //              site). WFH applicants who haven't clocked in stay
      //              "absent" so HR can still see they haven't started.
      //   office/remote — geofence verdict (atOffice=false) overrides the
      //              mode tagging so someone who clocked in via the
      //              office capture-scheme but is physically km away
      //              from the office reads as "Remote" on the dashboard
      //              pill — otherwise the row contradicts its own
      //              "13.8 KM OFF-SITE" badge.
      const atOfficeStrictFalse = loc?.atOffice === false;
      const isWfhToday          = wfhTodayIds.has(u.id);
      const status =
        rec?.status === "on_leave" || onLeaveIds.has(u.id) ? "on_leave" :
        rec?.clockIn && isWfhToday ? "wfh" :
        rec?.clockIn ? ((mode === "remote" || atOfficeStrictFalse) ? "remote" : "office") :
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
        // Capture scheme is the OPERATIONAL flavour of where this user
        // is supposed to punch in from. Often "Remote" even when
        // workLocation is left at the default "office" — we use both
        // signals when deciding whether to flag an off-site clock-in.
        attendanceCaptureScheme: (u.employeeProfile as any)?.attendanceCaptureScheme ?? null,
        clockIn:      rec?.clockIn  ?? null,
        clockOut:     rec?.clockOut ?? null,
        totalMinutes: rec?.totalMinutes ?? 0,
        rawStatus:    rec?.status ?? "absent",
        locationAddress: loc?.address ?? null,
        locationMode:    mode,
        locationLat:     loc?.lat   ?? null,
        locationLng:     loc?.lng   ?? null,
        // Office-geofence result computed at clock-in time and stored
        // in the location JSON blob. Both fields are nullable —
        // undefined for older punches that pre-date the geofence
        // feature, or when OFFICE_LAT/LNG weren't configured.
        atOffice:             loc?.atOffice ?? null,
        distanceFromOfficeM:  loc?.distanceFromOfficeM ?? null,
        status, // derived: on_leave | wfh | remote | office | absent
        wfhToday: isWfhToday,
      };
    });

    const counts = {
      total:        rows.length,
      // "Working today" — anyone who's clocked in regardless of mode.
      // WFH applicants who clocked in count here too (they're working).
      present:      rows.filter((r) => r.status === "office" || r.status === "remote" || r.status === "wfh").length,
      office:       rows.filter((r) => r.status === "office").length,
      remote:       rows.filter((r) => r.status === "remote").length,
      // Intent count — everyone who applied for WFH today. Used for the
      // WFH tab badge so the number matches the rows the tab will show
      // (the tab filter is gated on the wfhToday flag, not status, so
      // a WFH applicant who hasn't clocked in remains visible).
      wfh:          rows.filter((r) => r.wfhToday).length,
      // Status count — WFH applicants who actually clocked in. Used by
      // the donut so the segments add up to total without overlap with
      // the absent slice.
      wfhWorking:   rows.filter((r) => r.status === "wfh").length,
      onLeave:      rows.filter((r) => r.status === "on_leave").length,
      notClockedIn: rows.filter((r) => r.status === "absent").length,
      late:         rows.filter((r) => r.rawStatus === "late").length,
    };

    return NextResponse.json(serializeBigInt({ rows, counts, date: today.toISOString().slice(0, 10) }));
  } catch (e) { return serverError(e, "GET /api/hr/admin/attendance-dashboard"); }
}
