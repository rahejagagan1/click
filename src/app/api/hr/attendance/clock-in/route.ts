import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { parseBody } from "@/lib/validate";
import { stringifyAttLoc } from "@/lib/attendance-location";
import { istTodayDateOnly, istHour } from "@/lib/ist-date";

// Real GPS coordinates required so the attendance log always has a verifiable
// physical location. Address is optional and capped to keep payloads small.
const ClockInBody = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  address: z.string().trim().max(240).optional(),
});

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const user = session!.user as any;
    let userId: number = user.dbId;
    if (!userId && user.email) {
      const dbUser = await prisma.user.findUnique({ where: { email: user.email }, select: { id: true } });
      userId = dbUser?.id!;
    }
    if (!userId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || undefined;

    const parsed = await parseBody(req, ClockInBody);
    if (!parsed.ok) {
      // Treat any validation failure here as missing/invalid location — that's
      // the only thing the client sends, and the frontend prompts geolocation.
      return NextResponse.json(
        {
          error: "Location is required to clock in. Please allow location access in your browser and try again.",
          code: "location_required",
        },
        { status: 400 }
      );
    }
    const { lat: bodyLat, lng: bodyLng, address: bodyAddr } = parsed.data;

    const now = new Date();
    const today = istTodayDateOnly();

    // Derive status + location up-front so the write step is one DB call.
    const [userShift, profile, approvedWfh] = await Promise.all([
      prisma.userShift.findUnique({ where: { userId }, include: { shift: true } }),
      prisma.employeeProfile.findUnique({ where: { userId }, select: { workLocation: true } }),
      prisma.wFHRequest.findFirst({ where: { userId, date: today, status: "approved" }, select: { id: true } }),
    ]);

    let status = "present";
    if (userShift?.shift) {
      const [sh, sm] = userShift.shift.startTime.split(":").map(Number);
      const shiftStart = new Date(today);
      shiftStart.setHours(sh, sm + 15, 0);
      if (now > shiftStart) status = "late";
    }
    // Hard 10:00 AM IST cutoff: first clock-in past 10 AM is flagged "late".
    // Half-day penalty no longer applied at clock-in — half_day status is now
    // a function of total accumulated minutes at clock-out time.
    if (istHour(now) >= 10) status = "late";

    const wl = (profile?.workLocation || "office").toLowerCase();
    const isRemote = !!approvedWfh || wl === "remote" || wl === "hybrid";
    const location = stringifyAttLoc({
      mode: isRemote ? "remote" : "office",
      lat: bodyLat, lng: bodyLng, address: bodyAddr,
    });

    // ── Multi-session clock-in ──────────────────────────────────────────
    // The new model: each Attendance row owns N AttendanceSession rows.
    // Clock-in opens a new session. Three cases for the parent row:
    //
    //   (a) No row exists yet for today  → create row + first session.
    //   (b) Row exists, NO open session  → append a new "resume" session,
    //                                      clear the row's clockOut so the
    //                                      sweeper / UI know we're active.
    //   (c) Row exists with an OPEN session (clockOut on row is null while
    //       clockIn is set) → user is already clocked in; 409.
    //
    // We do this in a transaction so the parent + session stay consistent.
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.attendance.findUnique({
        where: { userId_date: { userId, date: today } },
      });

      // (a) brand-new day
      if (!existing) {
        const created = await tx.attendance.create({
          data: { userId, date: today, clockIn: now, status, ipAddress: ip, location },
        });
        await tx.$executeRawUnsafe(
          `INSERT INTO "AttendanceSession" ("attendanceId","clockIn") VALUES ($1, $2)`,
          created.id, now,
        );
        return { record: created, conflict: false as const };
      }

      // (c) currently clocked-in
      if (existing.clockIn && !existing.clockOut) {
        return { record: existing, conflict: true as const };
      }

      // (b) resume — append session and re-open the parent row.
      const updated = await tx.attendance.update({
        where: { id: existing.id },
        data: {
          clockOut: null,
          // Keep the FIRST session's clockIn on the parent so "first clock-in
          // of the day" semantics survive (used for late detection elsewhere).
          clockIn:  existing.clockIn ?? now,
          // Don't downgrade an existing "present"/"late" status on resume.
          status:   existing.status === "missed_clock_out" || existing.status === "absent" ? status : existing.status,
          ipAddress: ip,
          // Refresh location to the new session's location.
          location,
        },
      });
      await tx.$executeRawUnsafe(
        `INSERT INTO "AttendanceSession" ("attendanceId","clockIn") VALUES ($1, $2)`,
        updated.id, now,
      );
      return { record: updated, conflict: false as const };
    });

    if (result.conflict) {
      return NextResponse.json({ error: "Already clocked in" }, { status: 409 });
    }
    return NextResponse.json(result.record);
  } catch (e) {
    return serverError(e, "POST /api/hr/attendance/clock-in");
  }
}
