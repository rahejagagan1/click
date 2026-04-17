import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const { searchParams } = new URL(req.url);
    const isAdmin = self.orgLevel === "ceo" || self.isDeveloper || self.orgLevel === "hr_manager";
    const userId = isAdmin ? parseInt(searchParams.get("userId") || String(myId)) : myId;

    const docs = await prisma.employeeDocument.findMany({
      where: isAdmin && !searchParams.get("userId") ? {} : { userId },
      include: {
        user: { select: { id: true, name: true } },
        uploadedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(docs);
  } catch (e) { return serverError(e, "GET /api/hr/documents"); }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const body = await req.json();
    if (body.expiryDate) body.expiryDate = new Date(body.expiryDate);
    const doc = await prisma.employeeDocument.create({
      data: { ...body, uploadedById: myId },
    });
    return NextResponse.json(doc);
  } catch (e) { return serverError(e, "POST /api/hr/documents"); }
}
