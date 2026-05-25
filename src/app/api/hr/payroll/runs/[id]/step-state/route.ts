// GET  /api/hr/payroll/runs/[id]/step-state                      -> { states: {...} }
// PATCH /api/hr/payroll/runs/[id]/step-state  body: { step:N, state:"complete"|"pending" }
//
// Backs the 6 outer-step "Done / Pending" badges on the Run Payroll page.
// HR-admin only on writes.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, canViewSalary, resolveUserId, serverError } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

type RunRow = { id: number; status: string; stepStates: Record<string, string> | null };

async function loadRun(idStr: string): Promise<RunRow | null> {
  const id = parseInt(idStr);
  if (!Number.isFinite(id)) return null;
  const rows = await prisma.$queryRawUnsafe<RunRow[]>(
    `SELECT id, status, "stepStates" FROM "PayrollRun" WHERE id = $1`,
    id,
  );
  return rows[0] ?? null;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id } = await ctx.params;
    const run = await loadRun(id);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    return NextResponse.json({ states: (run as any).stepStates ?? {} });
  } catch (e) { return serverError(e, "GET /api/hr/payroll/runs/[id]/step-state"); }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id } = await ctx.params;
    const run = await loadRun(id);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (run.status === "locked" || run.status === "paid") {
      return NextResponse.json({ error: "Run is locked" }, { status: 409 });
    }

    const body = await req.json();
    const step  = parseInt(body?.step);
    const state = String(body?.state ?? "");
    if (!Number.isFinite(step) || step < 1 || step > 6) {
      return NextResponse.json({ error: "step must be 1..6" }, { status: 400 });
    }
    if (state !== "complete" && state !== "pending") {
      return NextResponse.json({ error: "state must be complete|pending" }, { status: 400 });
    }

    const next: Record<string, string> = { ...(run.stepStates ?? {}) };
    next[String(step)] = state;

    await prisma.$executeRawUnsafe(
      `UPDATE "PayrollRun" SET "stepStates" = $1::jsonb, "updatedAt" = NOW() WHERE id = $2`,
      JSON.stringify(next), run.id,
    );

    const actorId = await resolveUserId(session);
    await writeAuditLog({
      req,
      actorId: actorId ?? null,
      actorEmail: (session!.user as any).email ?? null,
      action: `payroll.step.${state}`,
      entityType: "PayrollRun",
      entityId: run.id,
      after: { step, state },
    });

    return NextResponse.json({ states: next });
  } catch (e) { return serverError(e, "PATCH /api/hr/payroll/runs/[id]/step-state"); }
}
