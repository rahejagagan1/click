import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { stringifyAttLoc } from "@/lib/attendance-location";
import { istTodayDateOnly, istHour } from "@/lib/ist-date";

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

    // Optional body: client-captured coordinates + reverse-geocoded address.
    let bodyLat: number | undefined, bodyLng: number | undefined, bodyAddr: string | undefined;
    try {
      const body = await req.json();
      if (body) {
        if (typeof body.lat === "number" && isFinite(body.lat)) bodyLat = body.lat;
        if (typeof body.lng === "number" && isFinite(body.lng)) bodyLng = body.lng;
        if (typeof body.address === "string" && body.address.trim()) bodyAddr = body.address.trim().slice(0, 240);
      }
    } catch { /* no body — clock-in still allowed */ }

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
    // Hard 10:00 AM IST cutoff: past 10 AM applies the half-day penalty; user can regularize.
    if (istHour(now) >= 10) status = "half_day";

    const wl = (profile?.workLocation || "office").toLowerCase();
    const isRemote = !!approvedWfh || wl === "remote" || wl === "hybrid";
    const location = stringifyAttLoc({
      mode: isRemote ? "remote" : "office",
      lat: bodyLat, lng: bodyLng, address: bodyAddr,
    });

    // ── Race-safe clock-in ──────────────────────────────────────────────
    // (1) Atomically set clockIn ONLY if the row exists and clockIn is null.
    //     `updateMany` is a single WHERE-guarded UPDATE in Postgres — two
    //     concurrent requests cannot both succeed.
    const updated = await prisma.attendance.updateMany({
      where: { userId, date: today, clockIn: null },
      data: { clockIn: now, status, ipAddress: ip, location },
    });

    // (2) If we updated a row, fetch + return it.
    if (updated.count === 1) {
      const record = await prisma.attendance.findUnique({
        where: { userId_date: { userId, date: today } },
      });
      return NextResponse.json(record);
    }

    // (3) updateMany touched 0 rows → either no row yet, or clockIn was
    //     already set. Try to create the row; the unique index
    //     @@unique([userId, date]) makes this atomic.
    try {
      const record = await prisma.attendance.create({
        data: { userId, date: today, clockIn: now, status, ipAddress: ip, location },
      });
      return NextResponse.json(record);
    } catch (e: any) {
      // P2002 = unique constraint violation → a row already exists, meaning
      // clockIn must already be set (either from a prior request or a
      // concurrent one that won the race).
      if (e?.code === "P2002") {
        return NextResponse.json({ error: "Already clocked in today" }, { status: 409 });
      }
      throw e;
    }
  } catch (e) {
    return serverError(e, "POST /api/hr/attendance/clock-in");
  }
}
