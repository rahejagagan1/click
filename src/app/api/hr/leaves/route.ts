import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

async function countWorkingDays(from: Date, to: Date): Promise<number> {
  const holidays = await prisma.holidayCalendar.findMany({
    where: { date: { gte: from, lte: to } }, select: { date: true },
  });
  const holidaySet = new Set(holidays.map((h) => h.date.toDateString()));
  let count = 0;
  const cur = new Date(from);
  while (cur <= to) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6 && !holidaySet.has(cur.toDateString())) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// GET /api/hr/leaves — list leave applications
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const { searchParams } = new URL(req.url);
    const isAdmin = self.orgLevel === "ceo" || self.isDeveloper || self.orgLevel === "hr_manager";
    const view = searchParams.get("view") || "my";

    let where: any = {};
    if (view === "team") {
      if (isAdmin) {
        // admin sees all
      } else {
        const team = await prisma.user.findMany({ where: { managerId: myId }, select: { id: true } });
        where.userId = { in: team.map((u) => u.id) };
      }
    } else {
      where.userId = myId;
    }
    const status = searchParams.get("status");
    if (status) where.status = status;

    const applications = await prisma.leaveApplication.findMany({
      where, include: {
        leaveType: true,
        user: { select: { id: true, name: true, profilePictureUrl: true } },
        approver: { select: { id: true, name: true } },
      },
      orderBy: { appliedAt: "desc" }, take: 100,
    });
    return NextResponse.json(applications);
  } catch (e) { return serverError(e, "GET /api/hr/leaves"); }
}

// POST /api/hr/leaves — apply for leave
export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const { leaveTypeId, fromDate, toDate, reason } = await req.json();
    if (!leaveTypeId || !fromDate || !toDate || !reason)
      return NextResponse.json({ error: "All fields are required" }, { status: 400 });

    const from = new Date(fromDate), to = new Date(toDate);
    if (from > to) return NextResponse.json({ error: "Invalid date range" }, { status: 400 });

    const totalDays = await countWorkingDays(from, to);
    if (totalDays === 0) return NextResponse.json({ error: "Selected dates are all weekends/holidays" }, { status: 400 });

    const year = from.getFullYear();
    const balance = await prisma.leaveBalance.findUnique({
      where: { userId_leaveTypeId_year: { userId: myId, leaveTypeId, year } },
    });
    if (!balance) return NextResponse.json({ error: "No leave balance found. Contact HR." }, { status: 400 });

    const available = parseFloat(balance.totalDays.toString()) - parseFloat(balance.usedDays.toString()) - parseFloat(balance.pendingDays.toString());
    if (totalDays > available) return NextResponse.json({ error: `Insufficient balance. Available: ${available}, requested: ${totalDays}` }, { status: 400 });

    const overlap = await prisma.leaveApplication.findFirst({
      where: { userId: myId, status: { in: ["pending", "approved"] }, fromDate: { lte: to }, toDate: { gte: from } },
    });
    if (overlap) return NextResponse.json({ error: "Overlapping leave exists" }, { status: 400 });

    const [application] = await prisma.$transaction([
      prisma.leaveApplication.create({
        data: { userId: myId, leaveTypeId, fromDate: from, toDate: to, totalDays, reason, status: "pending" },
        include: { leaveType: true },
      }),
      prisma.leaveBalance.update({
        where: { userId_leaveTypeId_year: { userId: myId, leaveTypeId, year } },
        data: { pendingDays: { increment: totalDays } },
      }),
    ]);
    return NextResponse.json(application);
  } catch (e) { return serverError(e, "POST /api/hr/leaves"); }
}
