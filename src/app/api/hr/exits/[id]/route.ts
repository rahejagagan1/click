// PATCH a single EmployeeExit — used by HR to tick off clearance items
// (assets returned / docs handled / final settlement / exit interview),
// flip status (notice_period → cleared → offboarded), or update notes.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

function canManage(session: any): boolean {
  const u = session?.user;
  return !!u && (u.orgLevel === "ceo" || u.orgLevel === "hr_manager" || u.role === "admin" || u.isDeveloper === true);
}

const STATUS_VALUES = new Set(["notice_period", "cleared", "offboarded"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const body = await req.json();

    const sets: string[] = [];
    const args: any[] = [];
    let i = 1;
    if (body.status !== undefined) {
      if (!STATUS_VALUES.has(String(body.status)))
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      sets.push(`status = $${i++}`); args.push(body.status);
    }
    for (const k of ["assetsReturned", "documentsHandled", "finalSettlementDone", "exitInterviewDone"]) {
      if (body[k] !== undefined) { sets.push(`"${k}" = $${i++}`); args.push(!!body[k]); }
    }
    if (body.notes !== undefined) { sets.push(`notes = $${i++}`); args.push(body.notes || null); }
    if (sets.length === 0) return NextResponse.json({ ok: true });
    sets.push(`"updatedAt" = now()`);
    args.push(id);
    await prisma.$executeRawUnsafe(
      `UPDATE "EmployeeExit" SET ${sets.join(", ")} WHERE id = $${i}`,
      ...args,
    );
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[PATCH /api/hr/exits/:id] failed:", e);
    return NextResponse.json({ error: e?.message || "Save failed" }, { status: 500 });
  }
}
