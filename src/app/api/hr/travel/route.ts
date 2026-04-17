import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const myId = await resolveUserId(session);
  const isAdmin = user.orgLevel === "ceo" || user.isDeveloper || user.orgLevel === "hr_manager";
  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view") || "my";

  try {
    const where =
      view === "team" && !isAdmin ? { user: { managerId: myId! } } :
      view === "all"  && isAdmin  ? {} :
                                    { userId: myId! };

    const reqs = await prisma.travelRequest.findMany({
      where,
      include: { user: { select: { id: true, name: true, profilePictureUrl: true } }, approvedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(reqs);
  } catch (e) { return serverError(e, "GET /api/hr/travel"); }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const { purpose, fromLocation, toLocation, travelDate, returnDate, estimatedCost, advanceNeeded, advanceAmount } = await req.json();
    if (!purpose || !fromLocation || !toLocation || !travelDate)
      return NextResponse.json({ error: "purpose, fromLocation, toLocation, travelDate required" }, { status: 400 });

    const rec = await prisma.travelRequest.create({
      data: {
        userId: myId, purpose, fromLocation, toLocation,
        travelDate: new Date(travelDate),
        returnDate: returnDate ? new Date(returnDate) : null,
        estimatedCost: estimatedCost ? parseFloat(estimatedCost) : null,
        advanceNeeded: !!advanceNeeded,
        advanceAmount: advanceAmount ? parseFloat(advanceAmount) : null,
      },
    });
    return NextResponse.json(rec, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/travel"); }
}
