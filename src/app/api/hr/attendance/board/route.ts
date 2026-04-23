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

    const board = allUsers.map((u) => {
      const rec = recordMap.get(u.id);
      return {
        ...u, status: rec?.status || "absent",
        clockIn: rec?.clockIn || null, clockOut: rec?.clockOut || null,
        totalMinutes: rec?.totalMinutes || 0,
        location: rec?.location ?? null,
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
