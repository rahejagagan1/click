// GET  /api/admin/rbac/designations  → permission catalog + all designations (with grants + user counts)
// POST /api/admin/rbac/designations  → create a new designation
//
// Gated to the HR Manager + top admins. Raw SQL (no typed-client dependency).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { PERMISSION_CATALOG } from "@/lib/permissions/catalog";
import { canManageDesignations, syncGrants, toDesignationKey } from "@/lib/permissions/designation-admin";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageDesignations(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const designations = await prisma.$queryRawUnsafe<
    { id: number; key: string; label: string; scorecardFunction: string | null;
      isActive: boolean; isSystem: boolean; sortOrder: number; userCount: number }[]
  >(
    `SELECT d."id", d."key", d."label", d."scorecardFunction", d."isActive", d."isSystem", d."sortOrder",
            (SELECT count(*)::int FROM "User" u WHERE u."designationId" = d."id") AS "userCount"
     FROM "Designation" d ORDER BY d."sortOrder", d."label"`
  );
  const grants = await prisma.$queryRawUnsafe<{ did: number; key: string }[]>(
    `SELECT dp."designationId" AS "did", pm."key" AS "key"
     FROM "DesignationPermission" dp JOIN "Permission" pm ON pm."id" = dp."permissionId"`
  );
  const byDesig = new Map<number, string[]>();
  for (const g of grants) {
    const arr = byDesig.get(g.did) ?? [];
    arr.push(g.key);
    byDesig.set(g.did, arr);
  }

  return NextResponse.json({
    catalog: PERMISSION_CATALOG,
    designations: designations.map((d) => ({
      ...d,
      userCount: Number(d.userCount),
      permissionKeys: byDesig.get(d.id) ?? [],
    })),
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageDesignations(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const label = String(body.label ?? "").trim();
  if (!label) return NextResponse.json({ error: "Label is required" }, { status: 400 });

  const key = (body.key ? toDesignationKey(String(body.key)) : toDesignationKey(label)) || "designation";
  const scorecardFunction = body.scorecardFunction ? String(body.scorecardFunction) : null;
  const permissionKeys: string[] = Array.isArray(body.permissionKeys) ? body.permissionKeys.map(String) : [];
  const actorId = (session.user as { dbId?: number }).dbId ?? null;

  const created = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `INSERT INTO "Designation" ("key","label","scorecardFunction","isActive","sortOrder","isSystem","createdAt","updatedAt")
     VALUES ($1,$2,$3,true, COALESCE((SELECT max("sortOrder") + 1 FROM "Designation"), 0), false, NOW(), NOW())
     ON CONFLICT ("key") DO NOTHING
     RETURNING "id"`,
    key, label, scorecardFunction
  );
  if (!created.length) {
    return NextResponse.json({ error: `A designation with key "${key}" already exists` }, { status: 409 });
  }
  await syncGrants(created[0].id, permissionKeys, actorId);
  return NextResponse.json({ ok: true, id: created[0].id, key });
}
