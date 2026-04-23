import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { notifyApprovers, notifyUsers } from "@/lib/notifications";
import { istTimeOnDate } from "@/lib/ist-date";
import { stringifyAttLoc } from "@/lib/attendance-location";

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
    // Session email isn't in the User table → we can't scope "my" or
    // "team" queries. Return an empty list instead of crashing Prisma with
    // `userId: null`. (view=all still works for admins.)
    if (!myId && view !== "all") return NextResponse.json([]);
    if (!myId && view === "all" && !isAdmin) return NextResponse.json([]);

    const where =
      view === "team" && !isAdmin ? { user: { managerId: myId! } } :
      view === "all"  && isAdmin  ? {} :
                                    { userId: myId! };

    const reqs = await prisma.wFHRequest.findMany({
      where,
      include: { user: { select: { id: true, name: true, profilePictureUrl: true } }, approver: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(reqs);
  } catch (e) { return serverError(e, "GET /api/hr/attendance/wfh"); }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const { date, reason, notifyUserIds } = await req.json();
    if (!date || !reason) return NextResponse.json({ error: "date and reason required" }, { status: 400 });
    const extras = Array.isArray(notifyUserIds) ? notifyUserIds.filter((x: any) => Number.isInteger(x)) : [];

    const req2 = await prisma.wFHRequest.create({
      data: { userId: myId, date: new Date(date), reason },
    });
    const requester = await prisma.user.findUnique({ where: { id: myId }, select: { name: true } });
    const dateLabel = new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    await Promise.all([
      notifyApprovers({
        actorId:  myId,
        type:     "wfh",
        entityId: req2.id,
        title:    `${requester?.name || "An employee"} requested Work From Home`,
        body:     `Date: ${dateLabel} — ${String(reason).slice(0, 120)}`,
        linkUrl:  "/dashboard/hr/approvals?tab=wfh",
        extraUserIds: extras,
      }),
      notifyUsers({
        actorId:  null,
        userIds:  [myId],
        type:     "wfh",
        entityId: req2.id,
        title:    `Work From Home request submitted`,
        body:     `Your request for ${dateLabel} is awaiting approval.`,
        linkUrl:  "/dashboard/hr/attendance",
      }),
    ]);
    return NextResponse.json(req2, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/attendance/wfh"); }
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

    const record = await prisma.wFHRequest.findUnique({ where: { id } });
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (!isAdmin) {
      const isMgr = await prisma.user.findFirst({ where: { id: record.userId, managerId: myId } });
      if (!isMgr) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Race-safe status transition: only write if the request is still pending.
    const newStatus = action === "approve" ? "approved" : "rejected";
    const { count } = await prisma.wFHRequest.updateMany({
      where: { id, status: "pending" },
      data:  { status: newStatus, approvedById: myId, approvalNote },
    });
    if (count === 0) {
      return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });
    }
    const updated = await prisma.wFHRequest.findUnique({ where: { id } });

    // On approval, seed an Attendance row for that date so the WFH day counts
    // as worked even if the user never clocked in/out. Matches the
    // regularize-approval policy: 10:00 IST → 23:59 IST, marked remote.
    if (action === "approve" && updated) {
      const dateOnly = new Date(record.date);
      const existing = await prisma.attendance.findUnique({
        where: { userId_date: { userId: record.userId, date: dateOnly } },
      });
      const finalClockIn  = existing?.clockIn  ?? istTimeOnDate(dateOnly, 10, 0);
      const finalClockOut = existing?.clockOut ?? istTimeOnDate(dateOnly, 23, 59);
      const totalMin = Math.max(0, Math.round((finalClockOut.getTime() - finalClockIn.getTime()) / 60000));
      const location = stringifyAttLoc({ mode: "remote" });
      await prisma.attendance.upsert({
        where: { userId_date: { userId: record.userId, date: dateOnly } },
        create: {
          userId: record.userId, date: dateOnly,
          clockIn: finalClockIn, clockOut: finalClockOut,
          status: "present", totalMinutes: totalMin, isRegularized: true, location,
        },
        update: {
          clockIn: finalClockIn, clockOut: finalClockOut,
          status: "present", totalMinutes: totalMin, isRegularized: true, location,
        },
      });
    }

    // Notify the submitter of the outcome.
    if (updated) {
      const dateLabel = new Date(record.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      await notifyUsers({
        actorId:  myId,
        userIds:  [record.userId],
        type:     "wfh",
        entityId: record.id,
        title:    action === "approve"
          ? `Your Work From Home for ${dateLabel} was approved`
          : `Your Work From Home for ${dateLabel} was rejected`,
        body:     approvalNote ? String(approvalNote).slice(0, 160) : undefined,
        linkUrl:  "/dashboard/hr/attendance",
      });
    }
    return NextResponse.json(updated);
  } catch (e) { return serverError(e, "PUT /api/hr/attendance/wfh"); }
}
