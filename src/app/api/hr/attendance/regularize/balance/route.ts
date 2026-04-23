import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { istMonthRange, istTodayDateOnly } from "@/lib/ist-date";

export const dynamic = "force-dynamic";

// Matches the constant in ../route.ts. Keep them in sync.
const REGULARIZATION_MONTHLY_QUOTA = 2;

/**
 * GET /api/hr/attendance/regularize/balance?date=YYYY-MM-DD
 *
 * Returns the caller's regularization quota usage for the IST month that
 * contains the given date (defaults to today's IST month).
 *
 * Response: { used, limit, remaining, month: "April 2026", start, end }
 */
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date");
    const ref = dateParam ? new Date(dateParam) : istTodayDateOnly();
    const { start, end } = istMonthRange(ref);

    const used = await prisma.attendanceRegularization.count({
      where: {
        userId: myId,
        date: { gte: start, lte: end },
        status: { in: ["pending", "approved"] },
      },
    });

    return NextResponse.json({
      used,
      limit: REGULARIZATION_MONTHLY_QUOTA,
      remaining: Math.max(0, REGULARIZATION_MONTHLY_QUOTA - used),
      month: start.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
      start: start.toISOString(),
      end:   end.toISOString(),
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/attendance/regularize/balance");
  }
}
