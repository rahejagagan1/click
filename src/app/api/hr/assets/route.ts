import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, requireAdmin, serverError } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const category = searchParams.get("category");
    const where: any = {};
    if (status) where.status = status;
    if (category) where.category = category;

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
