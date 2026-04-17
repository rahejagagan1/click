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

    const reqs = await prisma.compOffRequest.findMany({
      where,
      include: { user: { select: { id: true, name: true, profilePictureUrl: true } }, approver: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(reqs);
  } catch (e) { return serverError(e, "GET /api/hr/leaves/comp-off"); }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const { workedDate, creditDays, reason } = await req.json();
    if (!workedDate || !reason) return NextResponse.json({ error: "workedDate and reason required" }, { status: 400 });

    const expiry = new Date(workedDate);
    expiry.setMonth(expiry.getMonth() + 3);

    const rec = await prisma.compOffRequest.create({
      data: {
        userId: myId,
        workedDate: new Date(workedDate),
        creditDays: parseFloat(creditDays || "1"),
        reason,
        expiryDate: expiry,
      },
    });
    return NextResponse.json(rec, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/leaves/comp-off"); }
}

export async function PUT(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const myId = await resolveUserId(session);
  const isAdmin = user.orgLevel === "ceo" || user.isDeveloper || user.orgLevel === "hr_manager";

  try {
    const { id, action, approvalNote } = await req.json();
    const record = await prisma.compOffRequest.findUnique({ where: { id } });
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (!isAdmin) {
      const isMgr = await prisma.user.findFirst({ where: { id: record.userId, managerId: myId! } });
      if (!isMgr) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const updated = await prisma.compOffRequest.update({
      where: { id },
      data: { status: action === "approve" ? "approved" : "rejected", approvedById: myId, approvalNote },
    });
    return NextResponse.json(updated);
  } catch (e) { return serverError(e, "PUT /api/hr/leaves/comp-off"); }
}
