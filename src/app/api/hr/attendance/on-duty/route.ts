import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { notifyApprovers, notifyUsers } from "@/lib/notifications";

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
    if (!myId && view !== "all") return NextResponse.json([]);
    if (!myId && view === "all" && !isAdmin) return NextResponse.json([]);

    const where =
      view === "team" && !isAdmin ? { user: { managerId: myId! } } :
      view === "all"  && isAdmin  ? {} :
                                    { userId: myId! };

    const reqs = await prisma.onDutyRequest.findMany({
      where,
      include: { user: { select: { id: true, name: true, profilePictureUrl: true } }, approver: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(reqs);
  } catch (e) { return serverError(e, "GET /api/hr/attendance/on-duty"); }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const { date, fromTime, toTime, purpose, location, notifyUserIds } = await req.json();
    if (!date || !purpose) return NextResponse.json({ error: "date and purpose required" }, { status: 400 });
    const extras = Array.isArray(notifyUserIds) ? notifyUserIds.filter((x: any) => Number.isInteger(x)) : [];

    const rec = await prisma.onDutyRequest.create({
      data: {
        userId: myId,
        date: new Date(date),
        fromTime: fromTime ? new Date(`${date}T${fromTime}:00`) : null,
        toTime:   toTime   ? new Date(`${date}T${toTime}:00`)   : null,
        purpose,
        location,
      },
    });
    const requester = await prisma.user.findUnique({ where: { id: myId }, select: { name: true } });
    const dateLabel = new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    await Promise.all([
      notifyApprovers({
        actorId:  myId,
        type:     "on_duty",
        entityId: rec.id,
        title:    `${requester?.name || "An employee"} requested On Duty`,
        body:     `Date: ${dateLabel}${location ? ` @ ${location}` : ""} — ${String(purpose).slice(0, 120)}`,
        linkUrl:  "/dashboard/hr/approvals?tab=wfh",
        extraUserIds: extras,
      }),
      notifyUsers({
        actorId:  null,
        userIds:  [myId],
        type:     "on_duty",
        entityId: rec.id,
        title:    `On Duty request submitted`,
        body:     `Your request for ${dateLabel}${location ? ` @ ${location}` : ""} is awaiting approval.`,
        linkUrl:  "/dashboard/hr/attendance",
      }),
    ]);
    return NextResponse.json(rec, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/attendance/on-duty"); }
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

    const record = await prisma.onDutyRequest.findUnique({ where: { id } });
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (!isAdmin) {
      const isMgr = await prisma.user.findFirst({ where: { id: record.userId, managerId: myId } });
      if (!isMgr) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Race-safe status transition: only write if the request is still pending.
    const newStatus = action === "approve" ? "approved" : "rejected";
    const { count } = await prisma.onDutyRequest.updateMany({
      where: { id, status: "pending" },
      data:  { status: newStatus, approvedById: myId, approvalNote },
    });
    if (count === 0) {
      return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });
    }
    const updated = await prisma.onDutyRequest.findUnique({ where: { id } });

    // Notify the submitter of the outcome.
    if (updated) {
      const dateLabel = new Date(record.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      await notifyUsers({
        actorId:  myId,
        userIds:  [record.userId],
        type:     "on_duty",
        entityId: record.id,
        title:    action === "approve"
          ? `Your On Duty request for ${dateLabel} was approved`
          : `Your On Duty request for ${dateLabel} was rejected`,
        body:     approvalNote ? String(approvalNote).slice(0, 160) : undefined,
        linkUrl:  "/dashboard/hr/attendance",
      });
    }
    return NextResponse.json(updated);
  } catch (e) { return serverError(e, "PUT /api/hr/attendance/on-duty"); }
}
