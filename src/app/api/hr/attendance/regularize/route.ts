import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { notifyApprovers, notifyUsers } from "@/lib/notifications";
import { istTimeOnDate, istMonthRange, istTodayDateOnly, istDateOnlyFrom } from "@/lib/ist-date";

// Monthly quota: each user can have at most this many active (approved + pending +
// partially_approved) regularizations per IST calendar month. Rejected / cancelled
// requests don't count, so users are never penalised for admin decisions. Admin
// emergency grants DO count (on-book), so a user may end up at 3/2 for the month.
const REGULARIZATION_MONTHLY_QUOTA = 2;

// 48-hour cutoff, measured in IST calendar days. A request for date D is only
// allowed while today_IST - D ≤ WINDOW_DAYS. Example: miss on 2 Mar → can apply
// through end of 4 Mar IST. Bypassed for admin emergency grants.
const REGULARIZATION_WINDOW_DAYS = 2;

export const dynamic = "force-dynamic";

function isHRAdmin(user: any): boolean {
  return user?.orgLevel === "ceo" || user?.isDeveloper === true || user?.orgLevel === "hr_manager";
}

/** Day-difference between two IST calendar days (both stored as UTC-midnight). */
function dayDiff(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
}

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const myId = await resolveUserId(session);
  const admin = isHRAdmin(user);
  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view") || "my";

  try {
    if (!myId && view !== "all") return NextResponse.json([]);
    if (!myId && view === "all" && !admin) return NextResponse.json([]);

    const where = view === "team" && !admin
      ? { user: { managerId: myId! } }
      : view === "all" && admin
      ? {}
      : { userId: myId! };

    const regs = await prisma.attendanceRegularization.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, profilePictureUrl: true } },
        approver: { select: { id: true, name: true } },
        finalApprover: { select: { id: true, name: true } },
        grantedByAdmin: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(regs);
  } catch (e) { return serverError(e, "GET /api/hr/attendance/regularize"); }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const callerUser = session!.user as any;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const body = await req.json();
    const { date, requestedIn, requestedOut, reason, notifyUserIds } = body;
    const bodyUserId = Number.isInteger(body.userId) ? (body.userId as number) : null;
    const forceGrant = body.forceGrant === true;
    if (!date || !reason) return NextResponse.json({ error: "date and reason required" }, { status: 400 });
    const extras = Array.isArray(notifyUserIds) ? notifyUserIds.filter((x: any) => Number.isInteger(x)) : [];

    // Normalize the target date to UTC-midnight of the IST calendar day. Input
    // may be "YYYY-MM-DD" (from a date picker) or a full ISO timestamp.
    const targetDateOnly = istDateOnlyFrom(new Date(date));

    // Decide whether this is an admin emergency grant. Grants require:
    //   - caller is CEO / Developer / HR_manager,
    //   - explicit `forceGrant: true` flag (so a self-apply by an HR user isn't
    //     silently elevated into a bypass),
    //   - a target userId different from self (grant implies "on behalf of").
    const admin = isHRAdmin(callerUser);
    const isAdminGrant = admin && forceGrant && bodyUserId !== null && bodyUserId !== myId;
    const targetUserId = isAdminGrant ? bodyUserId! : myId;

    // Non-admin callers can never specify a userId other than their own.
    if (bodyUserId !== null && bodyUserId !== myId && !isAdminGrant) {
      return NextResponse.json(
        { error: "Only CEO / Developer / HR can grant regularizations on behalf of another user." },
        { status: 403 }
      );
    }

    // One pending regularization per user per date. Reject duplicate submissions
    // so people can't spam the approvers' inbox while they wait.
    const dupe = await prisma.attendanceRegularization.findFirst({
      where: { userId: targetUserId, date: targetDateOnly, status: { in: ["pending", "partially_approved"] } },
      select: { id: true },
    });
    if (dupe) {
      return NextResponse.json(
        { error: "A pending regularization already exists for this date." },
        { status: 409 }
      );
    }

    // 48-hour window — bypassed on admin grant.
    if (!isAdminGrant) {
      const todayIst = istTodayDateOnly();
      const diff = dayDiff(todayIst, targetDateOnly);
      if (diff < 0) {
        return NextResponse.json(
          { error: "Cannot apply for a future date.", code: "future_date" },
          { status: 400 }
        );
      }
      if (diff > REGULARIZATION_WINDOW_DAYS) {
        const dateLabel = targetDateOnly.toLocaleDateString("en-IN", {
          day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
        });
        return NextResponse.json(
          {
            error: `Regularization window closed. You can only apply within ${REGULARIZATION_WINDOW_DAYS} days after the missed date (${dateLabel}).`,
            code: "date_too_old",
            windowDays: REGULARIZATION_WINDOW_DAYS,
          },
          { status: 422 }
        );
      }
    }

    // Monthly quota — self-apply only. Admin grants bypass the cap but still
    // count toward the visible monthly total (on-book).
    if (!isAdminGrant) {
      const { start, end } = istMonthRange(targetDateOnly);
      const usedThisMonth = await prisma.attendanceRegularization.count({
        where: {
          userId: targetUserId,
          date: { gte: start, lte: end },
          status: { in: ["pending", "partially_approved", "approved"] },
        },
      });
      if (usedThisMonth >= REGULARIZATION_MONTHLY_QUOTA) {
        const monthLabel = start.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
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
    }

    const reg = await prisma.attendanceRegularization.create({
      data: {
        userId: targetUserId,
        date: targetDateOnly,
        requestedIn: requestedIn ? new Date(requestedIn) : null,
        requestedOut: requestedOut ? new Date(requestedOut) : null,
        reason,
        grantedByAdminId: isAdminGrant ? myId : null,
      },
    });

    const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { name: true } });
    const dateLabel = targetDateOnly.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

    await Promise.all([
      // L1 manager + extras get the approval request.
      notifyApprovers({
        actorId:  isAdminGrant ? myId : targetUserId,
        type:     "regularization",
        entityId: reg.id,
        title:    isAdminGrant
          ? `Regularization granted for ${target?.name || "an employee"} — needs L1 approval`
          : `${target?.name || "An employee"} requested regularization`,
        body:     `Date: ${dateLabel} — ${String(reason).slice(0, 120)}`,
        linkUrl:  "/dashboard/hr/approvals?tab=regularize",
        extraUserIds: extras,
      }),
      // Target user gets a confirmation — they need to see the item even if
      // an admin created it on their behalf.
      notifyUsers({
        actorId:  isAdminGrant ? myId : null,
        userIds:  [targetUserId],
        type:     "regularization",
        entityId: reg.id,
        title:    isAdminGrant
          ? `HR granted you a regularization for ${dateLabel}`
          : `Regularization request submitted`,
        body:     isAdminGrant
          ? `Your manager still needs to approve it. Reason on record: ${String(reason).slice(0, 120)}`
          : `Your request for ${dateLabel} is awaiting approval.`,
        linkUrl:  "/dashboard/hr/attendance",
      }),
    ]);
    return NextResponse.json(reg, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/attendance/regularize"); }
}

export async function PUT(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const callerUser = session!.user as any;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const admin = isHRAdmin(callerUser);

  try {
    const body = await req.json();
    const id = Number(body.id);
    const action = body.action;
    const approvalNote = typeof body.approvalNote === "string" ? body.approvalNote : null;
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
    }

    const reg = await prisma.attendanceRegularization.findUnique({
      where: { id },
      include: { user: { select: { id: true, managerId: true } } },
    });
    if (!reg) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Status guard: must be open (pending or partially_approved).
    if (reg.status !== "pending" && reg.status !== "partially_approved") {
      return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });
    }

    // Resolve the user's manager chain once — used for both stages.
    const l1Id = reg.user?.managerId ?? null;
    const l1 = l1Id ? await prisma.user.findUnique({ where: { id: l1Id }, select: { id: true, managerId: true } }) : null;
    const l2Id = l1?.managerId ?? null; // grand-manager (may be null)

    // Permission model (hybrid):
    //   Stage 1 (pending → partially_approved):
    //     - L1 (direct manager) OR CEO / HR manager may act.
    //     - CEO/HR fallback is needed when a user has no direct manager.
    //   Stage 2 (partially_approved → approved):
    //     - L2 (grand-manager, anywhere up the chain) OR CEO / HR manager may act.
    //     - "Anywhere up the chain" = l2Id, or l2's manager, etc. For now we
    //       accept l2 directly; CEO/HR covers the rest.
    //   Reject is allowed at whichever stage the caller could approve.
    const isL1 = l1Id !== null && l1Id === myId;
    const isL2OrAbove = l2Id !== null && l2Id === myId; // TODO: extend to full ancestor chain if needed
    const canActStage1 = isL1 || admin;
    const canActStage2 = isL2OrAbove || admin;

    const nextStatus = action === "reject"
      ? "rejected"
      : reg.status === "pending" ? "partially_approved" : "approved";

    if (action === "approve") {
      if (reg.status === "pending" && !canActStage1) {
        return NextResponse.json({ error: "Forbidden — only the L1 manager or HR/CEO can approve stage 1." }, { status: 403 });
      }
      if (reg.status === "partially_approved" && !canActStage2) {
        return NextResponse.json({ error: "Forbidden — only the L2 (grand-manager) or HR/CEO can give final approval." }, { status: 403 });
      }
    } else {
      // Reject — anyone who could act at the current stage may reject.
      if (reg.status === "pending" && !canActStage1) {
        return NextResponse.json({ error: "Forbidden — only the L1 manager or HR/CEO can reject at stage 1." }, { status: 403 });
      }
      if (reg.status === "partially_approved" && !canActStage2) {
        return NextResponse.json({ error: "Forbidden — only the L2 (grand-manager) or HR/CEO can reject at stage 2." }, { status: 403 });
      }
    }

    // Race-safe transition: re-check the current status in the where clause.
    const data: any = { status: nextStatus };
    if (action === "approve" && reg.status === "pending") {
      data.approvedById = myId;
      data.approvedAt = new Date();
      data.approvalNote = approvalNote;
    } else if (action === "approve" && reg.status === "partially_approved") {
      data.finalApprovedById = myId;
      data.finalApprovedAt = new Date();
      data.finalApprovalNote = approvalNote;
    } else if (action === "reject") {
      // Stamp whichever stage was current so the audit trail shows who killed it.
      if (reg.status === "pending") {
        data.approvedById = myId;
        data.approvedAt = new Date();
        data.approvalNote = approvalNote;
      } else {
        data.finalApprovedById = myId;
        data.finalApprovedAt = new Date();
        data.finalApprovalNote = approvalNote;
      }
    }

    const { count } = await prisma.attendanceRegularization.updateMany({
      where: { id, status: reg.status },
      data,
    });
    if (count === 0) {
      return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });
    }
    const updated = await prisma.attendanceRegularization.findUnique({ where: { id } });

    // Apply approved punch correction only on FINAL approval.
    //
    //  1. Clocked in, missed clock-out
    //     → keep clockIn (cap at 10:00 IST if late), clockOut = 23:59 IST.
    //  2. Both clock-in and clock-out exist (user was late or needs fix)
    //     → cap clockIn at 10:00 IST, keep clockOut.
    //  3. Missed both clock-in AND clock-out
    //     → standard 9-hour shift: 09:00 → 18:00 IST.
    if (action === "approve" && nextStatus === "approved") {
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
        finalClockIn  = nineAmIst;
        finalClockOut = sixPmIst;
      } else if (rawIn !== null && rawOut === null) {
        finalClockIn  = rawIn.getTime() > tenAmIst.getTime() ? tenAmIst : rawIn;
        finalClockOut = endOfDayIst;
      } else if (rawIn === null && rawOut !== null) {
        finalClockIn  = tenAmIst;
        finalClockOut = rawOut;
      } else {
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
    const dateLabel = new Date(reg.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
    let title: string;
    if (action === "reject") {
      title = `Your regularization for ${dateLabel} was rejected`;
    } else if (nextStatus === "partially_approved") {
      title = `Your regularization for ${dateLabel} passed stage 1 — awaiting final approval`;
    } else {
      title = `Your regularization for ${dateLabel} was approved`;
    }
    await notifyUsers({
      actorId:  myId,
      userIds:  [reg.userId],
      type:     "regularization",
      entityId: reg.id,
      title,
      body:     approvalNote ? String(approvalNote).slice(0, 160) : undefined,
      linkUrl:  "/dashboard/hr/attendance",
    });

    // If the request moved to partially_approved, ping the stage-2 approvers.
    if (action === "approve" && nextStatus === "partially_approved") {
      await notifyApprovers({
        actorId:  myId,
        type:     "regularization",
        entityId: reg.id,
        title:    `Regularization awaiting your final approval`,
        body:     `Date: ${dateLabel} — ${String(reg.reason).slice(0, 120)}`,
        linkUrl:  "/dashboard/hr/approvals?tab=regularize",
      });
    }

    return NextResponse.json(updated);
  } catch (e) { return serverError(e, "PUT /api/hr/attendance/regularize"); }
}
