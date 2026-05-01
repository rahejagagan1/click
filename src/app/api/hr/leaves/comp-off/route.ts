import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const myId = await resolveUserId(session);
  // Mirrors src/lib/access.ts:isHRAdmin — was missing special_access + role=admin + role=hr_manager.
  const isAdmin = user.orgLevel === "ceo" || user.isDeveloper || user.orgLevel === "hr_manager"
                || user.orgLevel === "special_access" || user.role === "admin" || user.role === "hr_manager";
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
  // Mirrors src/lib/access.ts:isHRAdmin — was missing special_access + role=admin + role=hr_manager.
  const isAdmin = user.orgLevel === "ceo" || user.isDeveloper || user.orgLevel === "hr_manager"
                || user.orgLevel === "special_access" || user.role === "admin" || user.role === "hr_manager";

  try {
    const { id, action, approvalNote } = await req.json();
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
    }

    const record = await prisma.compOffRequest.findUnique({
      where: { id },
      include: { user: { select: { id: true, managerId: true } } },
    });
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (record.status !== "pending" && record.status !== "partially_approved") {
      return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });
    }

    // Two-stage approval: pending (L1 manager) → partially_approved (L2 HR/CEO/Dev) → approved.
    const isDirectManager = record.user?.managerId === myId;
    if (record.status === "pending" && !isDirectManager && !isAdmin) {
      return NextResponse.json({ error: "Forbidden — only the L1 manager or HR/CEO can act at stage 1." }, { status: 403 });
    }
    if (record.status === "partially_approved" && !isAdmin) {
      return NextResponse.json({ error: "Forbidden — only HR / CEO / Developer can give final approval." }, { status: 403 });
    }

    if (action === "reject") {
      const updated = await prisma.compOffRequest.update({
        where: { id },
        data: { status: "rejected", approvedById: record.approvedById ?? myId!, approvalNote: approvalNote ?? record.approvalNote },
      });
      return NextResponse.json(updated);
    }

    // Stage 1 (manager) → partially_approved.
    if (record.status === "pending") {
      const updated = await prisma.compOffRequest.update({
        where: { id },
        data: { status: "partially_approved", approvedById: myId!, approvalNote },
      });
      return NextResponse.json(updated);
    }

    // Stage 2 (HR/CEO/Dev) → final approval.
    const updated = await prisma.compOffRequest.update({
      where: { id },
      data: { status: "approved", approvalNote: approvalNote ?? record.approvalNote },
    });
    return NextResponse.json(updated);
  } catch (e) { return serverError(e, "PUT /api/hr/leaves/comp-off"); }
}
