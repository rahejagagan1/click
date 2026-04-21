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

    const existing = await prisma.attendance.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    if (existing?.clockIn) {
      return NextResponse.json({ error: "Already clocked in today" }, { status: 400 });
    }

    const userShift = await prisma.userShift.findUnique({
      where: { userId }, include: { shift: true },
    });

    let status = "present";
    if (userShift?.shift) {
      const [sh, sm] = userShift.shift.startTime.split(":").map(Number);
      const shiftStart = new Date(today);
      shiftStart.setHours(sh, sm + 15, 0);
      if (now > shiftStart) status = "late";
    }
    // Hard 10:00 AM IST cutoff: past 10 AM applies the half-day penalty; user can regularize.
    if (istHour(now) >= 10) status = "half_day";

    // Determine work location: remote when WFH-approved for today, or workLocation is remote/hybrid.
    const [profile, approvedWfh] = await Promise.all([
      prisma.employeeProfile.findUnique({ where: { userId }, select: { workLocation: true } }),
      prisma.wFHRequest.findFirst({ where: { userId, date: today, status: "approved" }, select: { id: true } }),
    ]);
    const wl = (profile?.workLocation || "office").toLowerCase();
    const isRemote = !!approvedWfh || wl === "remote" || wl === "hybrid";
    const location = stringifyAttLoc({
      mode: isRemote ? "remote" : "office",
      lat: bodyLat, lng: bodyLng, address: bodyAddr,
    });

    const record = await prisma.attendance.upsert({
      where: { userId_date: { userId, date: today } },
      create: { userId, date: today, clockIn: now, status, ipAddress: ip, location },
      update: { clockIn: now, status, ipAddress: ip, location },
    });
    return NextResponse.json(record);
  } catch (e) {
    return serverError(e, "POST /api/hr/attendance/clock-in");
  }
}
