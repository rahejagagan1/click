import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { can } from "@/lib/permissions/can";

// Mirror of canManageAssets in the parent route — kept inline rather
// than imported because Next.js route files are isolated bundles.
// See parent route for the rationale (RBAC + legacy OR-gate).
function canManageAssets(user: any): boolean {
  if (!user) return false;
  if (can(user, "MANAGE_ASSETS")) return true;
  return user.orgLevel === "ceo"
    || user.orgLevel === "special_access"
    || user.orgLevel === "hr_manager"
    || user.role === "hr_manager"
    || user.role === "admin"
    || user.isDeveloper === true;
}

// PUT /api/hr/assets/:id — update fields, assign, or return.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManageAssets(session?.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id: idParam } = await params;
    const assetId = Number(idParam);
    if (!Number.isInteger(assetId)) return NextResponse.json({ error: "Invalid asset id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));

    // ── ASSIGN ────────────────────────────────────────────────────────────
    // Race-safe: only one "assign" call can flip status from available→assigned
    // for this asset. A second concurrent assign gets 409.
    if (body.action === "assign") {
      const userId = Number(body.userId);
      if (!Number.isInteger(userId)) return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
      const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!userExists) return NextResponse.json({ error: "User not found" }, { status: 404 });

      const result = await prisma.$transaction(async (tx) => {
        const { count } = await tx.asset.updateMany({
          where: { id: assetId, status: { in: ["available", "in_repair", "retired"] } },
          data:  { status: "assigned" },
        });
        if (count === 0) return { raced: true as const };
        await tx.assetAssignment.create({
          data: { assetId, userId, conditionOnAssign: typeof body.condition === "string" ? body.condition : null },
        });
        return { raced: false as const };
      });
      if (result.raced) return NextResponse.json({ error: "Asset is already assigned" }, { status: 409 });
      return NextResponse.json({ success: true });
    }

    // ── RETURN ────────────────────────────────────────────────────────────
    // Atomic: only one concurrent return can flip the active assignment's
    // returnedAt. A second request finds no active assignment and no-ops.
    if (body.action === "return") {
      const active = await prisma.assetAssignment.findFirst({ where: { assetId, returnedAt: null } });
      if (!active) return NextResponse.json({ success: true }); // already returned; idempotent

      const cond = typeof body.condition === "string" && body.condition ? body.condition : "good";
      const result = await prisma.$transaction(async (tx) => {
        const { count } = await tx.assetAssignment.updateMany({
          where: { id: active.id, returnedAt: null },
          data:  { returnedAt: new Date(), conditionOnReturn: cond },
        });
        if (count === 0) return { raced: true as const };
        await tx.asset.update({
          where: { id: assetId },
          data:  { status: "available", condition: cond },
        });
        return { raced: false as const };
      });
      if (result.raced) return NextResponse.json({ success: true }); // someone else returned it; still fine
      return NextResponse.json({ success: true });
    }

    // General update — set only the fields HR explicitly sent. Edit
    // modal posts name + category + serialNumber + condition + value
    // + purchaseDate + notes; assign/return go through the action
    // branches above. Empty strings clear nullable fields.
    const data: any = {};
    if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
    if (typeof body.category === "string" && body.category.trim()) data.category = body.category.trim();
    if (body.serialNumber !== undefined) {
      data.serialNumber = body.serialNumber ? String(body.serialNumber).trim() : null;
    }
    if (typeof body.condition === "string" && body.condition) data.condition = body.condition;
    if (typeof body.status === "string" && body.status) data.status = body.status;
    if (body.currentValue !== undefined) {
      data.currentValue = body.currentValue === "" || body.currentValue === null
        ? null
        : Number(body.currentValue);
    }
    if (body.purchaseDate !== undefined) {
      data.purchaseDate = body.purchaseDate ? new Date(body.purchaseDate) : null;
    }
    if (body.notes !== undefined) data.notes = body.notes || null;
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });

    const asset = await prisma.asset.update({
      where: { id: assetId },
      data,
      include: { assignments: { where: { returnedAt: null }, include: { user: { select: { id: true, name: true } } }, take: 1 } },
    });
    return NextResponse.json(asset);
  } catch (e) { return serverError(e, "PUT /api/hr/assets/[id]"); }
}

// DELETE /api/hr/assets/:id — wipe an asset + every AssetAssignment
// row that referenced it (FK has no ON DELETE CASCADE). Same write
// gate as PUT — anyone in the asset-manager tier can delete.
//
// Hard delete is the right model here: HR's mental model is "remove
// this from the register". Assignment history is gone with the asset
// — if you need it preserved, retire (status=retired) instead.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManageAssets(session?.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id: idParam } = await params;
    const assetId = Number(idParam);
    if (!Number.isInteger(assetId)) {
      return NextResponse.json({ error: "Invalid asset id" }, { status: 400 });
    }
    await prisma.$transaction([
      prisma.assetAssignment.deleteMany({ where: { assetId } }),
      prisma.asset.delete({ where: { id: assetId } }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e?.code === "P2025") {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    return serverError(e, "DELETE /api/hr/assets/[id]");
  }
}
