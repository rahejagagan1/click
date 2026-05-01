// One-time bonus / perk payouts per employee. HR-admin tier writes;
// the affected employee + admins can read.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

function isHRAdmin(u: any): boolean {
  return (
    u?.orgLevel === "ceo" ||
    u?.isDeveloper === true ||
    u?.orgLevel === "special_access" ||
    u?.role === "admin" ||
    u?.orgLevel === "hr_manager"
  );
}

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
    const admin = isHRAdmin(self);

    const { searchParams } = new URL(req.url);
    const requested = searchParams.get("userId");
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
  if (!isHRAdmin(session!.user)) {
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
  if (!isHRAdmin(session!.user)) {
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
