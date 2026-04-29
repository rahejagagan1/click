import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { accrueLeavesForEveryone } from "@/lib/leave-accrual";

export const dynamic = "force-dynamic";

function isHRAdmin(u: any) {
  return u?.orgLevel === "ceo" || u?.isDeveloper === true || u?.orgLevel === "hr_manager";
}

/**
 * GET /api/hr/admin/leave-balances?year=2026
 *
 * HR-admin only. Returns one row per (active employee × leave type) for
 * the given year. Missing rows are returned as zeros so the UI can render
 * a complete matrix even before the first leave is filed.
 *
 * Shape:
 *   {
 *     year, leaveTypes: [{ id, name, code, daysPerYear }],
 *     employees: [{
 *       id, name, email, profilePictureUrl,
 *       balances: { [leaveTypeId]: { id?, total, used, pending } }
 *     }]
 *   }
 */
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const self = session!.user as any;
  if (!isHRAdmin(self)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year") || new Date().getFullYear());

    // Idempotent monthly accrual — guarantees the matrix reflects this
    // month's +1 Sick Leave for everyone before we read.
    try { await accrueLeavesForEveryone(); } catch (e) { /* swallow */ }

    const [users, leaveTypes, balances] = await Promise.all([
      prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, name: true, email: true, profilePictureUrl: true },
        orderBy: { name: "asc" },
      }),
      prisma.leaveType.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true, daysPerYear: true },
        orderBy: { name: "asc" },
      }),
      prisma.leaveBalance.findMany({
        where: { year },
        select: {
          id: true, userId: true, leaveTypeId: true,
          totalDays: true, usedDays: true, pendingDays: true,
        },
      }),
    ]);

    // Index balances by `${userId}:${leaveTypeId}` for O(1) lookup.
    const idx = new Map<string, any>();
    for (const b of balances) idx.set(`${b.userId}:${b.leaveTypeId}`, b);

    const employees = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      profilePictureUrl: u.profilePictureUrl,
      balances: leaveTypes.reduce<Record<number, any>>((acc, lt) => {
        const b = idx.get(`${u.id}:${lt.id}`);
        acc[lt.id] = b
          ? {
              id:      b.id,
              total:   Number(b.totalDays),
              used:    Number(b.usedDays),
              pending: Number(b.pendingDays),
            }
          : { id: null, total: 0, used: 0, pending: 0 };
        return acc;
      }, {}),
    }));

    return NextResponse.json({ year, leaveTypes, employees });
  } catch (e) { return serverError(e, "GET /api/hr/admin/leave-balances"); }
}

/**
 * PUT /api/hr/admin/leave-balances
 *
 * HR-admin only. Upserts a single (userId, leaveTypeId, year) balance row.
 * Any of `totalDays`, `usedDays`, `pendingDays` can be updated; missing
 * fields are left untouched on existing rows (and default to 0 on insert).
 *
 * Body:
 *   { userId, leaveTypeId, year, totalDays?, usedDays?, pendingDays? }
 */
export async function PUT(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const self = session!.user as any;
  if (!isHRAdmin(self)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const userId      = Number(body?.userId);
    const leaveTypeId = Number(body?.leaveTypeId);
    const year        = Number(body?.year || new Date().getFullYear());
    if (!Number.isInteger(userId) || !Number.isInteger(leaveTypeId)) {
      return NextResponse.json({ error: "userId and leaveTypeId required" }, { status: 400 });
    }

    const numOrUndef = (v: any) => {
      if (v === undefined || v === null || v === "") return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const totalDays   = numOrUndef(body?.totalDays);
    const usedDays    = numOrUndef(body?.usedDays);
    const pendingDays = numOrUndef(body?.pendingDays);

    const updateData: any = {};
    if (totalDays   !== undefined) updateData.totalDays   = totalDays;
    if (usedDays    !== undefined) updateData.usedDays    = usedDays;
    if (pendingDays !== undefined) updateData.pendingDays = pendingDays;

    const row = await prisma.leaveBalance.upsert({
      where: { userId_leaveTypeId_year: { userId, leaveTypeId, year } },
      create: {
        userId, leaveTypeId, year,
        totalDays:   totalDays   ?? 0,
        usedDays:    usedDays    ?? 0,
        pendingDays: pendingDays ?? 0,
      },
      update: updateData,
    });

    return NextResponse.json({
      id: row.id,
      total:   Number(row.totalDays),
      used:    Number(row.usedDays),
      pending: Number(row.pendingDays),
    });
  } catch (e) { return serverError(e, "PUT /api/hr/admin/leave-balances"); }
}
