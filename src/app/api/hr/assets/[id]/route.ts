import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

// PUT /api/hr/assets/:id — update or assign/return
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const assetId = parseInt(params.id);
    const body = await req.json();

    if (body.action === "assign") {
      await prisma.$transaction([
        prisma.assetAssignment.create({ data: { assetId, userId: body.userId, conditionOnAssign: body.condition } }),
        prisma.asset.update({ where: { id: assetId }, data: { status: "assigned" } }),
      ]);
      return NextResponse.json({ success: true });
    }
    if (body.action === "return") {
      const active = await prisma.assetAssignment.findFirst({ where: { assetId, returnedAt: null } });
      if (active) {
        await prisma.$transaction([
          prisma.assetAssignment.update({ where: { id: active.id }, data: { returnedAt: new Date(), conditionOnReturn: body.condition } }),
          prisma.asset.update({ where: { id: assetId }, data: { status: "available", condition: body.condition || "good" } }),
        ]);
      }
      return NextResponse.json({ success: true });
    }

    // General update
    const data: any = {};
    if (body.name) data.name = body.name;
    if (body.condition) data.condition = body.condition;
    if (body.status) data.status = body.status;
    if (body.notes !== undefined) data.notes = body.notes;
    const asset = await prisma.asset.update({ where: { id: assetId }, data });
    return NextResponse.json(asset);
  } catch (e) { return serverError(e, "PUT /api/hr/assets/[id]"); }
}
