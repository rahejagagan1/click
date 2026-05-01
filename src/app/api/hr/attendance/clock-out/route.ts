import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { istTodayDateOnly } from "@/lib/ist-date";

export async function POST(_req: NextRequest) {
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
    const now = new Date();
    const today = istTodayDateOnly();

    // ── Multi-session clock-out ─────────────────────────────────────────
    // Find today's row + currently-open session, close that session, then
    // recompute the parent row's totalMinutes from the SUM of every closed
    // session. Done in a transaction so the row + session stay coherent.
    type SessRow = { id: number; clockIn: Date; clockOut: Date | null };
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.attendance.findUnique({
        where: { userId_date: { userId, date: today } },
      });
      if (!existing?.clockIn) return { kind: "not_clocked_in" as const };
      // Already-closed parent row → no open session to close.
      if (existing.clockOut) return { kind: "already_clocked_out" as const };

      // Most-recent open session for this Attendance row.
      const open = await tx.$queryRawUnsafe<SessRow[]>(
        `SELECT id, "clockIn", "clockOut" FROM "AttendanceSession"
          WHERE "attendanceId" = $1 AND "clockOut" IS NULL
          ORDER BY "clockIn" DESC LIMIT 1`,
        existing.id,
      );
      if (open.length === 0) {
        // Defensive: parent says we're clocked-in but no open session.
        // Treat as "already clocked out" — should be rare, only happens
        // for legacy rows pre-migration that lost their session.
        return { kind: "already_clocked_out" as const };
      }
      const openSession = open[0];

      // Close the open session.
      await tx.$executeRawUnsafe(
        `UPDATE "AttendanceSession" SET "clockOut" = $1 WHERE id = $2`,
        now, openSession.id,
      );

      // Recompute total from ALL closed sessions (including the one we
      // just closed). This is the source of truth for the day's hours.
      const sumRows = await tx.$queryRawUnsafe<Array<{ totalSeconds: number }>>(
        `SELECT COALESCE(EXTRACT(EPOCH FROM SUM("clockOut" - "clockIn")), 0)::int AS "totalSeconds"
           FROM "AttendanceSession"
          WHERE "attendanceId" = $1 AND "clockOut" IS NOT NULL`,
        existing.id,
      );
      const totalMinutes = Math.floor((sumRows[0]?.totalSeconds ?? 0) / 60);

      // Strict 9-hour shift: must accumulate 540 minutes for a full day.
      // ≥ 4.5h (270 min) but < 9h → half_day. "late" is preserved when the
      // employee still completed the full 9h.
      let status = existing.status;
      if (totalMinutes >= 540) status = existing.status === "late" ? "late" : "present";
      else if (totalMinutes >= 270) status = "half_day";
      const overtimeMinutes = Math.max(0, totalMinutes - 540);

      // Update parent row. clockOut on the row tracks the LAST session's
      // clockOut so the existing missed-clockout sweeper / UI keep working
      // (parent.clockOut null → still active or never closed).
      const updated = await tx.attendance.update({
        where: { id: existing.id },
        data: { clockOut: now, totalMinutes, status, overtimeMinutes },
      });
      return { kind: "ok" as const, record: updated };
    });

    if (result.kind === "not_clocked_in") {
      return NextResponse.json({ error: "You haven't clocked in today" }, { status: 400 });
    }
    if (result.kind === "already_clocked_out") {
      return NextResponse.json({ error: "Already clocked out" }, { status: 409 });
    }
    return NextResponse.json(result.record);
  } catch (e) {
    return serverError(e, "POST /api/hr/attendance/clock-out");
  }
}
