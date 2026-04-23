import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { istTodayDateOnly } from "@/lib/ist-date";
import { parseAttLoc } from "@/lib/attendance-location";
import { serializeBigInt } from "@/lib/utils";

export const dynamic = "force-dynamic";

// GET /api/hr/admin/attendance-dashboard
// Returns today's attendance snapshot for every active employee along with
// their department / team capsule (for the filter dropdowns). Access is
// limited to admin / CEO / HR manager / developer — everyone else gets 403.
export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const self = session!.user as any;
  const canView =
    self.isDeveloper === true ||
    self.role === "admin" ||
    self.orgLevel === "ceo" ||
    self.orgLevel === "hr_manager";
  if (!canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const today = istTodayDateOnly();

    const users = await prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, email: true, role: true, orgLevel: true,
        teamCapsule: true, profilePictureUrl: true,
        employeeProfile: { select: { department: true, designation: true, employeeId: true, workLocation: true } },
      },
    });

    const todayRows = await prisma.attendance.findMany({
      where: { date: today },
      select: {
        userId: true, status: true, clockIn: true, clockOut: true,
        totalMinutes: true, location: true,
      },
    });
    const byUser = new Map(todayRows.map((r) => [r.userId, r]));

    const rows = users.map((u) => {
      const rec = byUser.get(u.id) ?? null;
      const loc = rec ? parseAttLoc(rec.location) : null;
      const mode = loc?.mode ?? null; // "office" | "remote" | null
      const status =
        rec?.status === "on_leave" ? "on_leave" :
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
        status, // derived: on_leave | remote | office | absent
      };
    });

    const counts = {
      total:        rows.length,
      present:      rows.filter((r) => r.status === "office" || r.status === "remote").length,
      office:       rows.filter((r) => r.status === "office").length,
      remote:       rows.filter((r) => r.status === "remote").length,
      onLeave:      rows.filter((r) => r.status === "on_leave").length,
      notClockedIn: rows.filter((r) => r.status === "absent").length,
      late:         rows.filter((r) => r.rawStatus === "late").length,
    };

    return NextResponse.json(serializeBigInt({ rows, counts, date: today.toISOString().slice(0, 10) }));
  } catch (e) { return serverError(e, "GET /api/hr/admin/attendance-dashboard"); }
}
