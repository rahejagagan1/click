import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin, serverError } from "@/lib/api-auth";

// PUT /api/hr/assets/:id — update or assign/return. Admin-only.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;
  try {
    const assetId = Number(params.id);
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

    // General update
    const data: any = {};
    if (typeof body.name === "string" && body.name) data.name = body.name;
    if (typeof body.condition === "string" && body.condition) data.condition = body.condition;
    if (typeof body.status === "string" && body.status) data.status = body.status;
    if (body.notes !== undefined) data.notes = body.notes;
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });

    const asset = await prisma.asset.update({ where: { id: assetId }, data });
    return NextResponse.json(asset);
  } catch (e) { return serverError(e, "PUT /api/hr/assets/[id]"); }
}
