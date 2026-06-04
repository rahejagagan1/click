import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, requireAdmin, serverError } from "@/lib/api-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { can } from "@/lib/permissions/can";

export async function GET(req: NextRequest) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const category = searchParams.get("category");
    const mineParam = searchParams.get("mine") === "true";

    // Scope resolution — anyone without MANAGE_ASSETS is FORCED to
    // their own assigned-and-not-yet-returned items, regardless of
    // any `?mine=` value. Asset-managing roles can still pass
    // ?mine=true explicitly when they want to preview their own view.
    const session = await getServerSession(authOptions);
    const sUser = session?.user as any;
    const canManage = can(sUser, "MANAGE_ASSETS");
    const mine = !canManage || mineParam;

    // Resolve the viewer's user id for the mine-scope filter. Prefer
    // session.dbId (set on every login); fall back to a DB lookup by
    // email so an older session that pre-dates the dbId field still
    // works without a forced re-login.
    let viewerId: number | null = null;
    if (sUser?.dbId != null) {
      const n = Number(sUser.dbId);
      if (Number.isInteger(n) && n > 0) viewerId = n;
    }
    if (viewerId == null && sUser?.email) {
      const row = await prisma.user.findUnique({ where: { email: sUser.email }, select: { id: true } });
      if (row?.id) viewerId = row.id;
    }

    const where: any = {};
    if (status) where.status = status;
    if (category) where.category = category;
    if (mine) {
      // No valid viewer id → return empty rather than leaking the
      // full register through a misconfigured session.
      if (viewerId == null) return NextResponse.json([]);
      where.assignments = { some: { userId: viewerId, returnedAt: null } };
    }

    const assets = await prisma.asset.findMany({
      where, include: { assignments: { where: { returnedAt: null }, include: { user: { select: { id: true, name: true } } }, take: 1 } },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(assets);
  } catch (e) { return serverError(e, "GET /api/hr/assets"); }
}

export async function POST(req: NextRequest) {
  const { errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;
  try {
    const body = await req.json();
    if (body.purchaseDate) body.purchaseDate = new Date(body.purchaseDate);

    const { assignedToUserId, ...assetData } = body;
    if (assignedToUserId) assetData.status = "assigned";

    const asset = await prisma.asset.create({
      data: {
        ...assetData,
        ...(assignedToUserId
          ? {
              assignments: {
                create: {
                  userId: Number(assignedToUserId),
                  conditionOnAssign: assetData.condition ?? null,
                },
              },
            }
          : {}),
      },
      include: { assignments: { include: { user: { select: { id: true, name: true } } } } },
    });
    return NextResponse.json(asset);
  } catch (e) { return serverError(e, "POST /api/hr/assets"); }
}
