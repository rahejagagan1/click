import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, requireAdmin, resolveUserId, serverError } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const { searchParams } = new URL(req.url);
    const isAdmin = self.orgLevel === "ceo" || self.isDeveloper || self.orgLevel === "hr_manager";
    const userId = isAdmin ? parseInt(searchParams.get("userId") || String(myId)) : myId;
    const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()));
    const balances = await prisma.leaveBalance.findMany({
      where: { userId, year }, include: { leaveType: true },
    });
    return NextResponse.json(balances);
  } catch (e) { return serverError(e, "GET /api/hr/leaves/balance"); }
}

export async function POST(req: NextRequest) {
  const { errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;
  try {
    const { userId, year } = await req.json();
    const types = await prisma.leaveType.findMany({ where: { isActive: true } });
    const results = await Promise.all(
      types.map((lt) =>
        prisma.leaveBalance.upsert({
          where: { userId_leaveTypeId_year: { userId, leaveTypeId: lt.id, year } },
          create: { userId, leaveTypeId: lt.id, year, totalDays: lt.daysPerYear, usedDays: 0, pendingDays: 0 },
          update: {},
        })
      )
    );
    return NextResponse.json(results);
  } catch (e) { return serverError(e, "POST /api/hr/leaves/balance"); }
}
