// AdhocLineItem CRUD — drives the Run Payroll page's Step 4 sub-steps
// "Adhoc Payments" (kind=payment) and "Adhoc Deductions" (kind=deduction).
// One table backs both — `kind` discriminates. All writes are HR-admin only.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, canViewSalary, serverError } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

type Row = {
  id: number;
  userId: number;
  month: number;
  year: number;
  kind: string;
  type: string | null;
  amount: string;
  comment: string | null;
  createdAt: Date;
  createdBy: number | null;
  name?: string;
  role?: string;
};

function parseKind(s: string | null): "payment" | "deduction" | null {
  return s === "payment" || s === "deduction" ? s : null;
}

// GET /api/hr/payroll/adhoc?month=N&year=YYYY&kind=payment|deduction
//   Returns every adhoc item for that cycle, joined with the affected
//   employee's name + role for the table render.
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const month = parseInt(searchParams.get("month") ?? "");
    const year  = parseInt(searchParams.get("year")  ?? "");
    const kind  = parseKind(searchParams.get("kind"));
    if (!Number.isFinite(month) || month < 0 || month > 11) {
      return NextResponse.json({ error: "Bad month" }, { status: 400 });
    }
    if (!Number.isFinite(year)) {
      return NextResponse.json({ error: "Bad year" }, { status: 400 });
    }
    if (!kind) {
      return NextResponse.json({ error: "kind must be 'payment' or 'deduction'" }, { status: 400 });
    }

    const items = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT a.id, a."userId", a.month, a.year, a.kind, a.type, a.amount, a.comment,
              a."createdAt", a."createdBy",
              u.name, u.role::text AS role
         FROM "AdhocLineItem" a
         JOIN "User" u ON u.id = a."userId"
        WHERE a.month = $1 AND a.year = $2 AND a.kind = $3
        ORDER BY a.id ASC`,
      month, year, kind,
    );
    return NextResponse.json({ items });
  } catch (e) {
    return serverError(e, "GET /api/hr/payroll/adhoc");
  }
}

// POST /api/hr/payroll/adhoc
//   Body shapes:
//     1. Create one row:
//        { month, year, kind, userId, type?, amount, comment? }
//     2. Bulk copy from a previous cycle:
//        { copyFrom: { month, year }, toMonth, toYear, kind }
//        Copies every row of the given kind from the source month into
//        the target month, attributing them to the current user. Skips
//        rows whose user already has a row in the target month so the
//        operation is idempotent.
export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const createdBy = await resolveUserId(session);

    // ── Bulk copy path ───────────────────────────────────────────────
    if (body?.copyFrom && body?.toMonth !== undefined && body?.toYear !== undefined) {
      const srcMonth = parseInt(body.copyFrom.month);
      const srcYear  = parseInt(body.copyFrom.year);
      const dstMonth = parseInt(body.toMonth);
      const dstYear  = parseInt(body.toYear);
      const kind     = parseKind(body.kind);
      if (![srcMonth, srcYear, dstMonth, dstYear].every(Number.isFinite)) {
        return NextResponse.json({ error: "Bad month/year" }, { status: 400 });
      }
      if (!kind) return NextResponse.json({ error: "Bad kind" }, { status: 400 });

      // Idempotent: skip users who already have a row in the target month.
      const result = await prisma.$queryRawUnsafe<{ inserted: number }[]>(
        `WITH src AS (
           SELECT "userId", type, amount, comment
             FROM "AdhocLineItem"
            WHERE month = $1 AND year = $2 AND kind = $3
         ),
         existing AS (
           SELECT "userId"
             FROM "AdhocLineItem"
            WHERE month = $4 AND year = $5 AND kind = $3
         ),
         ins AS (
           INSERT INTO "AdhocLineItem"
                  ("userId", month, year, kind, type, amount, comment, "createdBy")
           SELECT s."userId", $4, $5, $3, s.type, s.amount, s.comment, $6
             FROM src s
            WHERE s."userId" NOT IN (SELECT "userId" FROM existing)
           RETURNING id
         )
         SELECT COUNT(*)::int AS inserted FROM ins`,
        srcMonth, srcYear, kind, dstMonth, dstYear, createdBy,
      );

      await writeAuditLog({
        req,
        actorId: createdBy ?? null,
        actorEmail: (session!.user as any).email ?? null,
        action: "payroll.adhoc.copy_prev_month",
        entityType: "AdhocLineItem",
        entityId: null,
        metadata: { kind, srcMonth, srcYear, dstMonth, dstYear, inserted: result[0]?.inserted ?? 0 },
      });
      return NextResponse.json({ ok: true, inserted: result[0]?.inserted ?? 0 });
    }

    // ── Single row create path ───────────────────────────────────────
    const month  = parseInt(body?.month);
    const year   = parseInt(body?.year);
    const kind   = parseKind(body?.kind);
    const userId = parseInt(body?.userId);
    const amount = Number(body?.amount);
    const type   = body?.type    ? String(body.type).slice(0, 80)    : null;
    const comment = body?.comment ? String(body.comment).slice(0, 500) : null;

    if (!Number.isFinite(month) || month < 0 || month > 11) {
      return NextResponse.json({ error: "Bad month" }, { status: 400 });
    }
    if (!Number.isFinite(year)) {
      return NextResponse.json({ error: "Bad year" }, { status: 400 });
    }
    if (!kind) return NextResponse.json({ error: "Bad kind" }, { status: 400 });
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
    }

    const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
      `INSERT INTO "AdhocLineItem" ("userId", month, year, kind, type, amount, comment, "createdBy")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      userId, month, year, kind, type, amount, comment, createdBy,
    );

    await writeAuditLog({
      req,
      actorId: createdBy ?? null,
      actorEmail: (session!.user as any).email ?? null,
      action: kind === "payment" ? "payroll.adhoc_payment.add" : "payroll.adhoc_deduction.add",
      entityType: "AdhocLineItem",
      entityId: rows[0]?.id ?? null,
      after: { userId, month, year, kind, type, amount, comment },
    });

    return NextResponse.json({ ok: true, id: rows[0]?.id }, { status: 201 });
  } catch (e) {
    return serverError(e, "POST /api/hr/payroll/adhoc");
  }
}

// PATCH /api/hr/payroll/adhoc?id=N — update fields on a single row.
//   Body: { type?, amount?, comment? }
export async function PATCH(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const id = parseInt(searchParams.get("id") ?? "");
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

    const body = await req.json();
    const setParts: string[] = [];
    const args: any[] = [];
    let i = 1;
    if (body?.type !== undefined) {
      setParts.push(`"type" = $${i++}`);
      args.push(body.type ? String(body.type).slice(0, 80) : null);
    }
    if (body?.amount !== undefined) {
      const amt = Number(body.amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return NextResponse.json({ error: "Bad amount" }, { status: 400 });
      }
      setParts.push(`"amount" = $${i++}`);
      args.push(amt);
    }
    if (body?.comment !== undefined) {
      setParts.push(`"comment" = $${i++}`);
      args.push(body.comment ? String(body.comment).slice(0, 500) : null);
    }
    if (setParts.length === 0) {
      return NextResponse.json({ error: "No editable fields supplied" }, { status: 400 });
    }
    args.push(id);
    await prisma.$executeRawUnsafe(
      `UPDATE "AdhocLineItem" SET ${setParts.join(", ")} WHERE id = $${i}`,
      ...args,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "PATCH /api/hr/payroll/adhoc");
  }
}

// DELETE /api/hr/payroll/adhoc?id=N
//   Accepts either ?id=N OR a JSON body { ids: [N, M, ...] } for bulk delete.
export async function DELETE(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get("id");

    if (idParam) {
      const id = parseInt(idParam);
      if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
      await prisma.$executeRawUnsafe(`DELETE FROM "AdhocLineItem" WHERE id = $1`, id);
      return NextResponse.json({ ok: true, deleted: 1 });
    }

    // Bulk: body { ids: number[] }
    const body = await req.json().catch(() => ({}));
    const ids: number[] = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Number.isFinite) : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "id or ids required" }, { status: 400 });
    }
    const result = await prisma.$executeRawUnsafe(
      `DELETE FROM "AdhocLineItem" WHERE id = ANY($1::int[])`,
      ids,
    );
    return NextResponse.json({ ok: true, deleted: result });
  } catch (e) {
    return serverError(e, "DELETE /api/hr/payroll/adhoc");
  }
}
