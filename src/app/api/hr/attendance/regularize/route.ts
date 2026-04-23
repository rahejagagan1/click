import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, requireHRAdmin, resolveUserId, serverError } from "@/lib/api-auth";
import { notifyApprovers, notifyUsers } from "@/lib/notifications";
import { istTimeOnDate, istMonthRange } from "@/lib/ist-date";

// Monthly quota: each user can have at most this many active (approved + pending)
// regularizations per IST calendar month. Rejected / cancelled requests don't
// count, so users are never penalised for admin decisions. Auto-"resets" on
// the 1st of each month because the month window shifts forward.
const REGULARIZATION_MONTHLY_QUOTA = 2;

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

    const where = view === "team" && !isAdmin
      ? { user: { managerId: myId! } }
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

    // One pending regularization per user per date. Reject duplicate submissions
    // so people can't spam the approvers' inbox while they wait.
    const dateStart = new Date(date);
    const dupe = await prisma.attendanceRegularization.findFirst({
      where: { userId: myId, date: dateStart, status: "pending" },
      select: { id: true },
    });
    if (dupe) {
      return NextResponse.json(
        { error: "You already have a pending regularization for this date. Wait for it to be approved or rejected." },
        { status: 409 }
      );
    }

    // Monthly quota check — approved + pending rows in the IST month of the
    // target date. Rejected / cancelled don't count, so admins refusing a
    // request frees the slot back up.
    const { start, end } = istMonthRange(dateStart);
    const usedThisMonth = await prisma.attendanceRegularization.count({
      where: {
        userId: myId,
        date: { gte: start, lte: end },
        status: { in: ["pending", "approved"] },
      },
    });
    if (usedThisMonth >= REGULARIZATION_MONTHLY_QUOTA) {
      const monthLabel = start.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
      return NextResponse.json(
        {
          error: `Monthly regularization limit reached. You've used ${usedThisMonth} of ${REGULARIZATION_MONTHLY_QUOTA} for ${monthLabel}. Quota resets on the 1st of next month.`,
          code: "quota_exhausted",
          used: usedThisMonth,
          limit: REGULARIZATION_MONTHLY_QUOTA,
        },
        { status: 429 }
      );
    }

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
    const dateLabel = new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    await Promise.all([
      notifyApprovers({
        actorId:  myId,
        type:     "regularization",
        entityId: reg.id,
        title:    `${requester?.name || "An employee"} requested regularization`,
        body:     `Date: ${dateLabel} — ${String(reason).slice(0, 120)}`,
        linkUrl:  "/dashboard/hr/approvals?tab=regularize",
        extraUserIds: extras,
      }),
      // Self-confirmation so the submitter sees their request in their bell.
      notifyUsers({
        actorId:  null,
        userIds:  [myId],
        type:     "regularization",
        entityId: reg.id,
        title:    `Regularization request submitted`,
        body:     `Your request for ${dateLabel} is awaiting approval.`,
        linkUrl:  "/dashboard/hr/attendance",
      }),
    ]);
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

    // Apply approved punch correction to attendance. Three cases, per spec:
    //
    //  1. Clocked in, missed clock-out
     //     → keep clockIn (cap at 10:00 IST if late), clockOut = 23:59 IST.
    //  2. Both clock-in and clock-out exist (user was late or needs fix)
    //     → cap clockIn at 10:00 IST, keep clockOut.
    //  3. Missed both clock-in AND clock-out
    //     → standard 9-hour shift: 09:00 → 18:00 IST.
    if (action === "approve") {
      const dateOnly = new Date(reg.date);
      const existing = await prisma.attendance.findUnique({
        where: { userId_date: { userId: reg.userId, date: dateOnly } },
      });
      const nineAmIst    = istTimeOnDate(dateOnly,  9,  0);
      const tenAmIst     = istTimeOnDate(dateOnly, 10,  0);
      const sixPmIst     = istTimeOnDate(dateOnly, 18,  0);
      const endOfDayIst  = istTimeOnDate(dateOnly, 23, 59);

      const rawIn  = reg.requestedIn  ?? existing?.clockIn  ?? null;
      const rawOut = reg.requestedOut ?? existing?.clockOut ?? null;

      let finalClockIn:  Date;
      let finalClockOut: Date;
      if (rawIn === null && rawOut === null) {
        // Case 3: missed both → standard 9-hour shift
        finalClockIn  = nineAmIst;
        finalClockOut = sixPmIst;
      } else if (rawIn !== null && rawOut === null) {
        // Case 1: missed clock-out → keep (capped) clockIn + 23:59 clockOut
        finalClockIn  = rawIn.getTime() > tenAmIst.getTime() ? tenAmIst : rawIn;
        finalClockOut = endOfDayIst;
      } else if (rawIn === null && rawOut !== null) {
        // Rare: clockOut with no clockIn → 10 AM default + keep clockOut
        finalClockIn  = tenAmIst;
        finalClockOut = rawOut;
      } else {
        // Case 2: both present → cap late clockIn at 10 AM, keep clockOut
        finalClockIn  = rawIn!.getTime() > tenAmIst.getTime() ? tenAmIst : rawIn!;
        finalClockOut = rawOut!;
      }

      const totalMin = Math.max(0, Math.round((finalClockOut.getTime() - finalClockIn.getTime()) / 60000));
      await prisma.attendance.upsert({
        where: { userId_date: { userId: reg.userId, date: dateOnly } },
        create: {
          userId: reg.userId, date: dateOnly,
          clockIn: finalClockIn, clockOut: finalClockOut,
          status: "present", totalMinutes: totalMin, isRegularized: true,
        },
        update: {
          clockIn: finalClockIn, clockOut: finalClockOut,
          status: "present", totalMinutes: totalMin, isRegularized: true,
        },
      });
    }

    // Notify the submitter of the outcome so their bell stays accurate.
    const dateLabel = new Date(reg.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    await notifyUsers({
      actorId:  myId,
      userIds:  [reg.userId],
      type:     "regularization",
      entityId: reg.id,
      title:    action === "approve"
        ? `Your regularization for ${dateLabel} was approved`
        : `Your regularization for ${dateLabel} was rejected`,
      body:     approvalNote ? String(approvalNote).slice(0, 160) : undefined,
      linkUrl:  "/dashboard/hr/attendance",
    });
    return NextResponse.json(updated);
  } catch (e) { return serverError(e, "PUT /api/hr/attendance/regularize"); }
}
