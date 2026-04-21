import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, requireHRAdmin, resolveUserId, serverError } from "@/lib/api-auth";
import { notifyApprovers } from "@/lib/notifications";

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
    const where = view === "team" && !isAdmin
      ? { user: { managerId: myId } }
      : view === "all" && isAdmin
      ? {}
      : { userId: myId! };

    const regs = await prisma.attendanceRegularization.findMany({
      where,
      include: { user: { select: { id: true, name: true, profilePictureUrl: true } }, approver: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(regs);
  } catch (e) { return serverError(e, "GET /api/hr/attendance/regularize"); }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const { date, requestedIn, requestedOut, reason, notifyUserIds } = await req.json();
    if (!date || !reason) return NextResponse.json({ error: "date and reason required" }, { status: 400 });
    const extras = Array.isArray(notifyUserIds) ? notifyUserIds.filter((x: any) => Number.isInteger(x)) : [];

    const reg = await prisma.attendanceRegularization.create({
      data: {
        userId: myId,
        date: new Date(date),
        requestedIn: requestedIn ? new Date(requestedIn) : null,
        requestedOut: requestedOut ? new Date(requestedOut) : null,
        reason,
      },
    });
    const requester = await prisma.user.findUnique({ where: { id: myId }, select: { name: true } });
    await notifyApprovers({
      actorId:  myId,
      type:     "regularization",
      entityId: reg.id,
      title:    `${requester?.name || "An employee"} requested regularization`,
      body:     `Date: ${new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} — ${String(reason).slice(0, 120)}`,
      linkUrl:  "/dashboard/hr/attendance",
      extraUserIds: extras,
    });
    return NextResponse.json(reg, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/attendance/regularize"); }
}

export async function PUT(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const isAdmin = user.orgLevel === "ceo" || user.isDeveloper || user.orgLevel === "hr_manager";

  try {
    const body = await req.json();
    const id = Number(body.id);
    const action = body.action;
    const approvalNote = typeof body.approvalNote === "string" ? body.approvalNote : null;
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
    }

    const reg = await prisma.attendanceRegularization.findUnique({ where: { id } });
    if (!reg) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (!isAdmin) {
      const isManager = await prisma.user.findFirst({ where: { id: reg.userId, managerId: myId } });
      if (!isManager) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Race-safe status transition: only the first approver wins, duplicate
    // clicks get 409 instead of silently re-running the attendance upsert.
    const newStatus = action === "approve" ? "approved" : "rejected";
    const { count } = await prisma.attendanceRegularization.updateMany({
      where: { id, status: "pending" },
      data:  { status: newStatus, approvedById: myId, approvalNote },
    });
    if (count === 0) {
      return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });
    }
    const updated = await prisma.attendanceRegularization.findUnique({ where: { id } });

    // Apply approved punch correction to attendance (only runs for this caller).
    if (action === "approve" && (reg.requestedIn || reg.requestedOut)) {
      const dateOnly = new Date(reg.date);
      const totalMin = reg.requestedIn && reg.requestedOut
        ? Math.round((new Date(reg.requestedOut).getTime() - new Date(reg.requestedIn).getTime()) / 60000)
        : 0;
      await prisma.attendance.upsert({
        where: { userId_date: { userId: reg.userId, date: dateOnly } },
        create: { userId: reg.userId, date: dateOnly, clockIn: reg.requestedIn, clockOut: reg.requestedOut, status: "present", totalMinutes: totalMin, isRegularized: true },
        update: { clockIn: reg.requestedIn ?? undefined, clockOut: reg.requestedOut ?? undefined, totalMinutes: totalMin, isRegularized: true, status: "present" },
      });
    }
    return NextResponse.json(updated);
  } catch (e) { return serverError(e, "PUT /api/hr/attendance/regularize"); }
}
