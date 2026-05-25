// One-time bonus / perk payouts per employee. HR-admin tier writes;
// the affected employee + admins can read.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, canViewSalary, serverError } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

type BonusRow = {
  id: number;
  userId: number;
  amount: string;
  reason: string | null;
  effectiveDate: Date;
  bonusType: string | null;
  paymentStatus: string;
  createdAt: Date;
  createdBy: number | null;
};

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;
    const myId = await resolveUserId(session);
    const admin = canViewSalary(self);

    const { searchParams } = new URL(req.url);
    const monthRaw = searchParams.get("month");  // 0-indexed (Jan=0)
    const yearRaw  = searchParams.get("year");
    const requested = searchParams.get("userId");

    // Admin-only: ?month=N&year=YYYY returns every bonus whose
    // effectiveDate falls inside that calendar month, including the
    // affected employee's name + role for table rendering. Used by
    // the Run Payroll page's Step 3 (Bonus, Salary Revisions & Overtime)
    // panel to enumerate the whole cycle's bonuses.
    if (monthRaw !== null && yearRaw !== null) {
      if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const month = parseInt(monthRaw);
      const year  = parseInt(yearRaw);
      if (!Number.isFinite(month) || month < 0 || month > 11 || !Number.isFinite(year)) {
        return NextResponse.json({ error: "Bad month/year" }, { status: 400 });
      }
      const start = new Date(Date.UTC(year, month, 1));
      const end   = new Date(Date.UTC(year, month + 1, 1));
      const items = await prisma.$queryRawUnsafe<(BonusRow & { name: string; role: string })[]>(
        `SELECT b.id, b."userId", b.amount, b.reason, b."effectiveDate",
                b."bonusType", b."paymentStatus", b."createdAt", b."createdBy",
                u.name, u.role::text AS role
           FROM "EmployeeBonus" b
           JOIN "User" u ON u.id = b."userId"
          WHERE b."effectiveDate" >= $1 AND b."effectiveDate" < $2
          ORDER BY b."effectiveDate" ASC, b.id ASC`,
        start, end,
      );
      return NextResponse.json({ items });
    }

    let userId: number;
    if (requested) {
      const n = parseInt(requested);
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: "Bad userId" }, { status: 400 });
      }
      if (!admin && n !== myId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      userId = n;
    } else {
      userId = myId!;
    }

    const items = await prisma.$queryRawUnsafe<BonusRow[]>(
      `SELECT id, "userId", amount, reason, "effectiveDate",
              "bonusType", "paymentStatus",
              "createdAt", "createdBy"
         FROM "EmployeeBonus"
        WHERE "userId" = $1
        ORDER BY "effectiveDate" DESC, id DESC`,
      userId,
    );
    return NextResponse.json({ items });
  } catch (e) {
    return serverError(e, "GET /api/hr/payroll/bonus");
  }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const userId        = parseInt(String(body?.userId ?? ""));
    const amount        = Number(body?.amount);
    const reason        = (body?.reason ? String(body.reason).slice(0, 500) : null) || null;
    const effectiveRaw  = String(body?.effectiveDate ?? "");
    const bonusType     = (body?.bonusType ? String(body.bonusType).slice(0, 80) : null) || null;
    const paymentStatusRaw = String(body?.paymentStatus ?? "due_future");
    const paymentStatus = ["due_future", "paid_past"].includes(paymentStatusRaw) ? paymentStatusRaw : "due_future";
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveRaw)) {
      return NextResponse.json({ error: "effectiveDate must be YYYY-MM-DD" }, { status: 400 });
    }

    const createdBy = await resolveUserId(session);
    const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
      `INSERT INTO "EmployeeBonus"
              ("userId", amount, reason, "effectiveDate", "bonusType", "paymentStatus", "createdBy")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      userId, amount, reason, new Date(effectiveRaw), bonusType, paymentStatus, createdBy,
    );

    await writeAuditLog({
      req,
      actorId: createdBy ?? null,
      actorEmail: (session!.user as any).email ?? null,
      action: "payroll.bonus.add",
      entityType: "EmployeeBonus",
      entityId: rows[0]?.id ?? null,
      after: { userId, amount, reason, effectiveDate: effectiveRaw, bonusType, paymentStatus },
    });

    return NextResponse.json({ ok: true, id: rows[0]?.id }, { status: 201 });
  } catch (e) {
    return serverError(e, "POST /api/hr/payroll/bonus");
  }
}

export async function DELETE(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const idRaw = searchParams.get("id");
    const id = idRaw && /^\d+$/.test(idRaw) ? parseInt(idRaw, 10) : NaN;
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Bad id" }, { status: 400 });
    }
    await prisma.$executeRawUnsafe(`DELETE FROM "EmployeeBonus" WHERE id = $1`, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "DELETE /api/hr/payroll/bonus");
  }
}
