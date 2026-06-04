// PATCH  /api/admin/rbac/designations/[id]  → update label / scorecardFunction / isActive / permission grants
// DELETE /api/admin/rbac/designations/[id]  → delete (non-system, zero users only)

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { canManageDesignations, syncGrants } from "@/lib/permissions/designation-admin";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageDesignations(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = parseInt((await params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const actorId = (session.user as { dbId?: number }).dbId ?? null;

  const sets: string[] = [];
  const args: unknown[] = [];
  let i = 1;
  if (typeof body.label === "string" && body.label.trim()) {
    sets.push(`"label" = $${i++}`); args.push(body.label.trim());
  }
  if ("scorecardFunction" in body) {
    sets.push(`"scorecardFunction" = $${i++}`);
    args.push(body.scorecardFunction ? String(body.scorecardFunction) : null);
  }
  if (typeof body.isActive === "boolean") {
    sets.push(`"isActive" = $${i++}`); args.push(body.isActive);
  }
  if (sets.length) {
    sets.push(`"updatedAt" = NOW()`);
    args.push(id);
    await prisma.$executeRawUnsafe(`UPDATE "Designation" SET ${sets.join(", ")} WHERE "id" = $${i}`, ...args);
  }

  if (Array.isArray(body.permissionKeys)) {
    await syncGrants(id, body.permissionKeys.map(String), actorId);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageDesignations(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = parseInt((await params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const rows = await prisma.$queryRawUnsafe<{ isSystem: boolean; userCount: number }[]>(
    `SELECT d."isSystem", (SELECT count(*)::int FROM "User" u WHERE u."designationId" = d."id") AS "userCount"
     FROM "Designation" d WHERE d."id" = $1`,
    id
  );
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (rows[0].isSystem) {
    return NextResponse.json({ error: "Built-in designations can't be deleted (you can edit or deactivate them)." }, { status: 409 });
  }
  if (Number(rows[0].userCount) > 0) {
    return NextResponse.json({ error: `Reassign the ${rows[0].userCount} user(s) on this designation first.` }, { status: 409 });
  }
  // DesignationPermission rows cascade on delete.
  await prisma.$executeRawUnsafe(`DELETE FROM "Designation" WHERE "id" = $1`, id);
  return NextResponse.json({ ok: true });
}
