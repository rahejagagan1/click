import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, requireAdmin, resolveUserId, serverError } from "@/lib/api-auth";
import { accrueLeavesForUser, ymKey } from "@/lib/leave-accrual";

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

    // Self-heal: ensure the user has a LeaveBalance row for every active
    // LeaveType in the requested year. Every type defaults to 0 days —
    // Sick Leave fills via monthly accrual; everything else is HR-managed
    // through the admin matrix.
    const types = await prisma.leaveType.findMany({
      where: { isActive: true }, select: { id: true, code: true, daysPerYear: true },
    });
    const existing = await prisma.leaveBalance.findMany({
      where: { userId, year }, select: { leaveTypeId: true },
    });
    const existingTypeIds = new Set(existing.map((b) => b.leaveTypeId));
    const missing = types.filter((t) => !existingTypeIds.has(t.id));
    if (missing.length > 0) {
      const currentYm = ymKey(new Date());
      // Use createMany for typed columns, then patch lastAccrualMonth via raw
      // SQL so we don't depend on a freshly-generated Prisma client.
      await prisma.leaveBalance.createMany({
        data: missing.map((t) => ({
          userId,
          leaveTypeId: t.id,
          year,
          totalDays:   0,
          usedDays:    0,
          pendingDays: 0,
        })),
        skipDuplicates: true,
      });
      await prisma.$executeRawUnsafe(
        `UPDATE "LeaveBalance" SET "lastAccrualMonth" = $1
           WHERE "userId" = $2 AND year = $3 AND "lastAccrualMonth" IS NULL`,
        currentYm, userId, year,
      );
    }

    // Lazy monthly accrual: bumps Sick Leave by 1 day for every full month
    // since the last accrual stamp. Idempotent — same-month re-reads do
    // nothing.
    try { await accrueLeavesForUser(userId); } catch (e) { /* swallow — read should still succeed */ }

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
