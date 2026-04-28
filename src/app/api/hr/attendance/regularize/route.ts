import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { parseBody } from "@/lib/validate";
import { notifyUsers } from "@/lib/notifications";
import { writeAuditLog } from "@/lib/audit-log";
import { istTimeOnDate, istMonthRange, istTodayDateOnly, istDateOnlyFrom } from "@/lib/ist-date";

// Schema covers both self-apply and admin-grant flavours of regularize POST.
const RegularizePost = z.object({
  date: z.string().min(1).max(40),
  reason: z.string().trim().min(1, "Reason is required").max(500),
  requestedIn:  z.union([z.string().min(1).max(40), z.null()]).optional(),
  requestedOut: z.union([z.string().min(1).max(40), z.null()]).optional(),
  notifyUserIds: z.array(z.number().int()).max(50).optional(),
  userId: z.number().int().optional(),
  forceGrant: z.boolean().optional(),
});

const RegularizePut = z.object({
  id: z.number().int(),
  action: z.enum(["approve", "reject"]),
  approvalNote: z.string().max(500).optional().nullable(),
});

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

    // Raw SQL — the generated Prisma client may be stale on dev machines
    // that haven't re-run `prisma generate` after the two-stage approval
    // migration. Scalar columns (finalApprovedById, grantedByAdminId, etc.)
    // and their relations would otherwise throw "Unknown field" errors.
    let whereSql = `r."userId" = $1`;
    let params: any[] = [myId];
    if (view === "team" && !admin) {
      whereSql = `u."managerId" = $1`;
    } else if (view === "all" && admin) {
      whereSql = `1=1`;
      params = [];
    }

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
         r."id", r."userId", r."date", r."requestedIn", r."requestedOut",
         r."reason", r."status",
         r."approvedById", r."approvedAt", r."approvalNote",
         r."finalApprovedById", r."finalApprovedAt", r."finalApprovalNote",
         r."grantedByAdminId",
         r."createdAt", r."updatedAt",
         u."id" AS "u_id", u."name" AS "u_name", u."profilePictureUrl" AS "u_pic",
         a."id" AS "a_id", a."name" AS "a_name",
         fa."id" AS "fa_id", fa."name" AS "fa_name",
         g."id"  AS "g_id",  g."name"  AS "g_name"
       FROM "AttendanceRegularization" r
       JOIN "User" u  ON u."id"  = r."userId"
       LEFT JOIN "User" a  ON a."id"  = r."approvedById"
       LEFT JOIN "User" fa ON fa."id" = r."finalApprovedById"
       LEFT JOIN "User" g  ON g."id"  = r."grantedByAdminId"
       WHERE ${whereSql}
       ORDER BY r."createdAt" DESC`,
      ...params
    );

    const regs = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      date: r.date,
      requestedIn: r.requestedIn,
      requestedOut: r.requestedOut,
      reason: r.reason,
      status: r.status,
      approvedById: r.approvedById,
      approvedAt: r.approvedAt,
      approvalNote: r.approvalNote,
      finalApprovedById: r.finalApprovedById,
      finalApprovedAt: r.finalApprovedAt,
      finalApprovalNote: r.finalApprovalNote,
      grantedByAdminId: r.grantedByAdminId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      user: { id: r.u_id, name: r.u_name, profilePictureUrl: r.u_pic },
      approver: r.a_id ? { id: r.a_id, name: r.a_name } : null,
      finalApprover: r.fa_id ? { id: r.fa_id, name: r.fa_name } : null,
      grantedByAdmin: r.g_id ? { id: r.g_id, name: r.g_name } : null,
    }));
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
    const parsed = await parseBody(req, RegularizePost);
    if (!parsed.ok) return parsed.error;
    const { date, requestedIn, requestedOut, reason, notifyUserIds } = parsed.data;
    const bodyUserId = parsed.data.userId ?? null;
    const forceGrant = parsed.data.forceGrant === true;
    const extras = notifyUserIds ?? [];

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

    // Regularization is HR-admin-only — skip the direct manager and only
    // notify CEO / HR managers / Developers (and any "Notify" extras the
    // applicant tagged on the form).
    const devEmails = (process.env.DEVELOPER_EMAILS || "")
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    const admins = await prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { orgLevel: { in: ["ceo", "hr_manager"] } },
          { role: "admin" },
          ...(devEmails.length > 0 ? [{ email: { in: devEmails } }] : []),
        ],
      },
      select: { id: true },
    });
    const adminIds = admins.map((u) => u.id).filter((id) => id !== targetUserId);

    await Promise.all([
      notifyUsers({
        actorId:  isAdminGrant ? myId : targetUserId,
        userIds:  [...adminIds, ...extras],
        type:     "regularization",
        entityId: reg.id,
        title:    isAdminGrant
          ? `Regularization granted for ${target?.name || "an employee"} — awaiting your approval`
          : `${target?.name || "An employee"} requested regularization`,
        body:     `Date: ${dateLabel} — ${String(reason).slice(0, 120)}`,
        linkUrl:  "/dashboard/hr/approvals?tab=regularize",
      }),
      notifyUsers({
        actorId:  isAdminGrant ? myId : null,
        userIds:  [targetUserId],
        type:     "regularization",
        entityId: reg.id,
        title:    isAdminGrant
          ? `HR granted you a regularization for ${dateLabel}`
          : `Regularization request submitted`,
        body:     isAdminGrant
          ? `On record. Reason: ${String(reason).slice(0, 120)}`
          : `Your request for ${dateLabel} is awaiting HR approval.`,
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
    const parsed = await parseBody(req, RegularizePut);
    if (!parsed.ok) return parsed.error;
    const { id, action } = parsed.data;
    const approvalNote = parsed.data.approvalNote ?? null;

    const reg = await prisma.attendanceRegularization.findUnique({
      where: { id },
      include: { user: { select: { id: true, managerId: true } } },
    });
    if (!reg) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Status guard: must be open (pending or partially_approved — partially
    // is kept here only so any legacy rows from the old two-stage flow can
    // still be finalised).
    if (reg.status !== "pending" && reg.status !== "partially_approved") {
      return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });
    }

    // Regularization is HR-admin-only — no manager L1 stage. Only CEO /
    // HR manager / Developer can decide. This is intentionally tighter
    // than leave / WFH / OD / comp-off (which are L1→L2): regularizations
    // edit attendance records directly, so we want a small set of trusted
    // approvers.
    if (!admin) {
      return NextResponse.json(
        { error: "Forbidden — only HR admin / CEO / Developer can decide regularizations." },
        { status: 403 },
      );
    }

    // Single-stage transition: pending|partially_approved → approved|rejected.
    const nextStatus = action === "reject" ? "rejected" : "approved";

    // Always stamp BOTH the L1 and L2 approver fields with the same admin
    // user. The schema kept the two-pair shape from the old flow; setting
    // both fields keeps existing UI components (which still render L1/L2)
    // showing a consistent decision rather than a missing-stage gap.
    const now = new Date();
    const data: any = {
      status:            nextStatus,
      approvedById:      reg.approvedById ?? myId,
      approvedAt:        reg.approvedAt   ?? now,
      approvalNote:      reg.approvalNote ?? approvalNote,
      finalApprovedById: myId,
      finalApprovedAt:   now,
      finalApprovalNote: approvalNote,
    };

    const { count } = await prisma.attendanceRegularization.updateMany({
      where: { id, status: reg.status },
      data,
    });
    if (count === 0) {
      return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });
    }
    const updated = await prisma.attendanceRegularization.findUnique({ where: { id } });

    // Audit trail — captures who decided, when, before/after status, and IP.
    await writeAuditLog({
      req,
      actorId: myId,
      actorEmail: callerUser?.email ?? null,
      action: `regularize.${action}`,
      entityType: "AttendanceRegularization",
      entityId: id,
      before: { status: reg.status },
      after:  { status: nextStatus, approvalNote },
    });

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
    const title = action === "reject"
      ? `Your regularization for ${dateLabel} was rejected`
      : `Your regularization for ${dateLabel} was approved`;
    await notifyUsers({
      actorId:  myId,
      userIds:  [reg.userId],
      type:     "regularization",
      entityId: reg.id,
      title,
      body:     approvalNote ? String(approvalNote).slice(0, 160) : undefined,
      linkUrl:  "/dashboard/hr/attendance",
    });

    return NextResponse.json(updated);
  } catch (e) { return serverError(e, "PUT /api/hr/attendance/regularize"); }
}
