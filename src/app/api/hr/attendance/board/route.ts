import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { istTodayDateOnly } from "@/lib/ist-date";

// GET /api/hr/attendance/board — today's team attendance board
export async function GET() {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const today = istTodayDateOnly();

    const allUsers = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, profilePictureUrl: true, role: true },
      orderBy: { name: "asc" },
    });

    const todayRecords = await prisma.attendance.findMany({
      where: { date: today },
      select: { userId: true, status: true, clockIn: true, clockOut: true, totalMinutes: true, location: true },
    });

    const recordMap = new Map(todayRecords.map((r) => [r.userId, r]));

    // Anyone who's *applied* for WFH today — we treat any non-final status as
    // "WFH today" so the home page can list them as Working Remotely without
    // waiting for manager approval. Excludes rejected / cancelled requests.
    const wfhTodayRows = await prisma.wFHRequest.findMany({
      where: {
        date: today,
        status: { notIn: ["rejected", "cancelled"] },
      },
      select: { userId: true },
    });
    const wfhTodayIds = new Set(wfhTodayRows.map((r) => r.userId));

    // Anyone with a leave application that *covers* today, in any status that
    // isn't rejected/cancelled. Mirrors the WFH treatment so the On Leave list
    // reflects intent even before approval lands.
    const leaveTodayRows = await prisma.leaveApplication.findMany({
      where: {
        fromDate: { lte: today },
        toDate:   { gte: today },
        status:   { notIn: ["rejected", "cancelled"] },
      },
      select: { userId: true, reason: true },
      orderBy: { appliedAt: "desc" },
    });
    const leaveTodayIds = new Set(leaveTodayRows.map((r) => r.userId));

    // Per-user leave kind for the home-page badge: "full" | "first_half" |
    // "second_half". Derived from markers in the reason string written by the
    // leave form. Convention:
    //   [First Half]  ... → first_half
    //   [Second Half] ... → second_half
    //   [Half Day]    ... → first_half  (legacy — pre-split half-day requests)
    //   (no marker)       → full
    type LeaveKind = "full" | "first_half" | "second_half";
    const leaveKindByUser = new Map<number, LeaveKind>();
    for (const r of leaveTodayRows) {
      if (leaveKindByUser.has(r.userId)) continue; // first (newest) row wins
      const reason = r.reason || "";
      let kind: LeaveKind = "full";
      if      (/\[First Half\]/i.test(reason))  kind = "first_half";
      else if (/\[Second Half\]/i.test(reason)) kind = "second_half";
      else if (/\[Half Day\]/i.test(reason))    kind = "first_half"; // legacy
      leaveKindByUser.set(r.userId, kind);
    }

    const board = allUsers.map((u) => {
      const rec = recordMap.get(u.id);
      return {
        ...u, status: rec?.status || "absent",
        clockIn: rec?.clockIn || null, clockOut: rec?.clockOut || null,
        totalMinutes: rec?.totalMinutes || 0,
        location: rec?.location ?? null,
        wfhToday:   wfhTodayIds.has(u.id),
        leaveToday: leaveTodayIds.has(u.id),
        leaveKind:  leaveKindByUser.get(u.id) ?? null,
      };
    });

    const counts = {
      present: board.filter((u) => u.status === "present" || u.status === "late").length,
      absent: board.filter((u) => u.status === "absent").length,
      late: board.filter((u) => u.status === "late").length,
      onLeave: board.filter((u) => u.status === "on_leave").length,
      total: allUsers.length,
    };

    return NextResponse.json({ board, counts, date: today });
  } catch (e) {
    return serverError(e, "GET /api/hr/attendance/board");
  }
}
