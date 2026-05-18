import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, isHRAdmin, serverError } from "@/lib/api-auth";
import { notifyUsers } from "@/lib/notifications";
import { countWorkingDays } from "@/lib/hr/working-days";

// GET /api/hr/leaves — list leave applications
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const { searchParams } = new URL(req.url);
    const isAdmin = isHRAdmin(self);
    const view = searchParams.get("view") || "my";

    let where: any = {};
    if (view === "all") {
      // HR-admin only — full org-wide view used by the admin Leaves panel.
      if (!isAdmin) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      // No userId filter — admin sees everyone.
    } else if (view === "team") {
      if (isAdmin) {
        // admin sees all teams
      } else {
        const team = await prisma.user.findMany({ where: { managerId: myId }, select: { id: true } });
        where.userId = { in: team.map((u) => u.id) };
      }
    } else {
      where.userId = myId;
    }
    const status = searchParams.get("status");
    if (status) where.status = status;

    const applications = await prisma.leaveApplication.findMany({
      where, include: {
        leaveType: true,
        user: { select: { id: true, name: true, email: true, profilePictureUrl: true } },
        approver: { select: { id: true, name: true } },
      },
      // Admin view loads the full history; per-user view stays paginated at 100.
      orderBy: { appliedAt: "desc" },
      take: view === "all" ? 500 : 100,
    });
    return NextResponse.json(applications);
  } catch (e) { return serverError(e, "GET /api/hr/leaves"); }
}

// POST /api/hr/leaves — apply for leave
//
// Self-apply (default): creates a `pending` request that flows through L1/L2.
// HR-admin "apply on behalf" (when `targetUserId` is set + caller is HR admin):
//   • Allows ANY active leave type (including LWP) regardless of the
//     subject's existing balance rows.
//   • If `useLwpFallback: true` and the subject's chosen-type balance is
//     missing OR insufficient, auto-switches to Leave Without Pay so the
//     request still goes through without manual back-and-forth.
//   • Auto-approves the application (status="approved") and writes the
//     usual side effects — debit balance to `used`, mark each working day's
//     attendance as `on_leave`. HR already has the authority to approve,
//     so the extra L1/L2 round-trip would be friction with no policy benefit.
export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const body = await req.json();
    const fromDate = body.fromDate, toDate = body.toDate, reason = body.reason;
    const notifyUserIds = body.notifyUserIds;
    let leaveTypeId = Number(body.leaveTypeId);
    const targetUserId    = typeof body.targetUserId === "number" ? body.targetUserId : null;
    const useLwpFallback  = body.useLwpFallback === true;
    const callerIsHRAdmin = isHRAdmin(self);
    const onBehalf        = targetUserId !== null && targetUserId !== myId;
    if (onBehalf && !callerIsHRAdmin) {
      return NextResponse.json(
        { error: "Only HR admins can apply for leave on behalf of another user." },
        { status: 403 },
      );
    }
    const subjectUserId = onBehalf ? targetUserId! : myId;

    if (!leaveTypeId || !fromDate || !toDate || !reason)
      return NextResponse.json({ error: "All fields are required" }, { status: 400 });
    const extras = Array.isArray(notifyUserIds) ? notifyUserIds.filter((x: any) => Number.isInteger(x)) : [];

    const from = new Date(fromDate), to = new Date(toDate);
    if (from > to) return NextResponse.json({ error: "Invalid date range" }, { status: 400 });

    // Block balance-only types (e.g. Carry Over Leave) — the UI hides
    // them but a hand-crafted POST would otherwise sneak through.
    let leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
    if (!leaveType || !leaveType.isActive) {
      return NextResponse.json({ error: "Unknown leave type" }, { status: 400 });
    }
    if (leaveType.applicable === false) {
      return NextResponse.json({ error: "This leave type is not applicable — balance is encashed at exit." }, { status: 400 });
    }
    // Note: we intentionally do NOT gate applications by user.leavePolicyId.
    // HR manages balances manually in the Leave Balances matrix and can
    // grant any type to any user; the balance check below is the canonical
    // "do you have enough days" guard. Policy only drives monthly accrual.

    // Half-day requests carry a marker in the reason field — the apply form
    // adds `[Half Day]`, `[First Half]`, or `[Second Half]` so the API
    // doesn't need a separate column. When present, the request only ever
    // covers a single calendar date and counts as 0.5 days.
    const isHalfDay = /^\s*\[(Half Day|First Half|Second Half)\]/i.test(String(reason ?? ""));
    let totalDays = isHalfDay
      ? 0.5
      : await countWorkingDays(from, to);
    if (totalDays === 0) return NextResponse.json({ error: "Selected dates are all weekends/holidays" }, { status: 400 });

    const year = from.getFullYear();
    // Look up the subject's balance for the chosen type. May be missing
    // (e.g. LWP never has a default row) — that's handled below.
    let balance = await prisma.leaveBalance.findUnique({
      where: { userId_leaveTypeId_year: { userId: subjectUserId, leaveTypeId, year } },
    });
    const isLwp = leaveType.code === "LWP";

    // Helper: switch the application to Leave Without Pay, upserting a
    // zero-totalDays balance row if needed so the usual increment math works.
    async function switchToLwp() {
      const lwp = await prisma.leaveType.findUnique({ where: { code: "LWP" } });
      if (!lwp || !lwp.isActive) {
        return NextResponse.json({ error: "Leave Without Pay type is not configured." }, { status: 400 });
      }
      leaveType   = lwp;
      leaveTypeId = lwp.id;
      balance = await prisma.leaveBalance.upsert({
        where:  { userId_leaveTypeId_year: { userId: subjectUserId, leaveTypeId, year } },
        create: { userId: subjectUserId, leaveTypeId, year, totalDays: 0, usedDays: 0, pendingDays: 0 },
        update: {},
      });
      return null;
    }

    if (!balance) {
      // No row at all. LWP intentionally has no default rows — upsert one.
      // Other types: only HR admin gets the LWP-fallback path.
      if (isLwp) {
        await switchToLwp();
      } else if (onBehalf && useLwpFallback) {
        const fb = await switchToLwp();
        if (fb) return fb;
      } else {
        return NextResponse.json({ error: "No leave balance found. Contact HR." }, { status: 400 });
      }
    } else if (!isLwp) {
      // Standard balance check. HR-admin-on-behalf with LWP fallback can
      // bypass by switching to LWP; everyone else has to stay within their
      // balance.
      const available = parseFloat(balance.totalDays.toString())
                      - parseFloat(balance.usedDays.toString())
                      - parseFloat(balance.pendingDays.toString());
      if (totalDays > available) {
        if (onBehalf && useLwpFallback) {
          const fb = await switchToLwp();
          if (fb) return fb;
        } else {
          return NextResponse.json({ error: `Insufficient balance. Available: ${available}, requested: ${totalDays}` }, { status: 400 });
        }
      }
    }

    const overlap = await prisma.leaveApplication.findFirst({
      where: { userId: subjectUserId, status: { in: ["pending", "approved"] }, fromDate: { lte: to }, toDate: { gte: from } },
    });
    if (overlap) return NextResponse.json({ error: "Overlapping leave exists" }, { status: 400 });

    // HR-admin-on-behalf = auto-approved; self-apply (or HR applying for
    // themselves) = pending → flows through normal L1/L2.
    const finalStatus = onBehalf && callerIsHRAdmin ? "approved" : "pending";

    const application = await prisma.$transaction(async (tx) => {
      const app = await tx.leaveApplication.create({
        data: {
          userId: subjectUserId, leaveTypeId, fromDate: from, toDate: to, totalDays, reason,
          status: finalStatus,
          approvedById: finalStatus === "approved" ? myId : null,
          approvedAt:   finalStatus === "approved" ? new Date() : null,
          notifyUserIds: extras,
        },
        include: { leaveType: true, user: { select: { managerId: true, name: true } } },
      });
      // Balance debit. Approved → straight to `used`. Pending → reserve as `pending`.
      await tx.leaveBalance.update({
        where: { userId_leaveTypeId_year: { userId: subjectUserId, leaveTypeId, year } },
        data: finalStatus === "approved"
          ? { usedDays:    { increment: totalDays } }
          : { pendingDays: { increment: totalDays } },
      });
      // Auto-approved: mark each working day in the range as on_leave so
      // the attendance dashboards reflect the leave immediately. Mirrors
      // the date-iteration logic in src/app/api/hr/leaves/[id]/route.ts
      // (UTC-only arithmetic, IST-safe).
      if (finalStatus === "approved") {
        const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
        const end = new Date(Date.UTC(to.getUTCFullYear(),   to.getUTCMonth(),   to.getUTCDate()));
        while (cur.getTime() <= end.getTime()) {
          const dow = cur.getUTCDay();
          if (dow !== 0 && dow !== 6) {
            const dateOnly = new Date(cur);
            await tx.attendance.upsert({
              where:  { userId_date: { userId: subjectUserId, date: dateOnly } },
              create: { userId: subjectUserId, date: dateOnly, status: "on_leave" },
              update: { status: "on_leave" },
            });
          }
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      }
      return app;
    });

    // Initial notification recipients: the applicant's direct manager (L1
    // approver), every CEO / HR manager / developer (L2 final approvers),
    // and anyone the applicant tagged in the "Notify" picker. HR/CEO are
    // included up-front so they see every new leave immediately rather
    // than only after the manager forwards via L1 approval.
    const requesterName = application.user?.name || "An employee";
    const managerId = application.user?.managerId ?? null;
    const devEmails = (process.env.DEVELOPER_EMAILS || "")
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    const finalApprovers = await prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          // CEO + Special Access + HR Manager (role) + Developers.
          // Excludes role=admin alone + orgLevel="hr_manager"-only members.
          { orgLevel: { in: ["ceo", "special_access"] } },
          { role: "hr_manager" },
          ...(devEmails.length > 0 ? [{ email: { in: devEmails } }] : []),
        ],
      },
      select: { id: true },
    });
    const dateLabel = `${from.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} – ${to.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`;
    const daysLabel = `${totalDays} day${totalDays === 1 ? "" : "s"}`;
    const typeName  = application.leaveType?.name || "leave";

    if (finalStatus === "approved" && onBehalf) {
      // HR applied on behalf — notify the subject (their leave is on-record)
      // plus the manager and other admins as a heads-up. No "awaiting
      // approval" framing because nothing is pending.
      const recipients = Array.from(new Set([
        subjectUserId,
        ...(managerId ? [managerId] : []),
        ...finalApprovers.map((u) => u.id).filter((id) => id !== myId),
        ...extras,
      ]));
      await notifyUsers({
        actorId:  myId,
        userIds:  recipients,
        type:     "leave",
        entityId: application.id,
        title:    `HR applied ${typeName} for ${requesterName}`,
        body:     `${dateLabel} (${daysLabel}) — on record.`,
        linkUrl:  "/dashboard/hr/leaves",
      });
    } else {
      // Standard self-apply flow: ping the L1 manager + L2 approvers.
      const initialRecipients = Array.from(new Set([
        ...(managerId ? [managerId] : []),
        ...finalApprovers.map((u) => u.id),
        ...extras,
      ]));
      await notifyUsers({
        actorId:  myId,
        userIds:  initialRecipients,
        type:     "leave",
        entityId: application.id,
        title:    `${requesterName} requested ${typeName}`,
        body:     `${dateLabel} (${daysLabel}) — awaiting manager approval.`,
        linkUrl:  "/dashboard/hr/approvals",
      });
    }

    return NextResponse.json(application);
  } catch (e) { return serverError(e, "POST /api/hr/leaves"); }
}
