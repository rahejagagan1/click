import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { notifyApprovers, notifyUsers } from "@/lib/notifications";
import { istTimeOnDate, istDateOnlyFrom, istMonthRange } from "@/lib/ist-date";
import { stringifyAttLoc } from "@/lib/attendance-location";

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
  const self = session!.user as any;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
  // Same gate the rest of the HR module uses for "on-behalf" actions.
  const callerIsHRAdmin = self?.orgLevel === "ceo" || self?.isDeveloper
    || self?.orgLevel === "special_access" || self?.role === "admin"
    || self?.orgLevel === "hr_manager"     || self?.role === "hr_manager";

  try {
    const body = await req.json();
    const date = body.date, reason = body.reason, notifyUserIds = body.notifyUserIds;
    // toDate is optional and only honored on the HR-on-behalf+forceGrant path.
    // For self-apply, `date` is single-day as before.
    const toDateRaw = body.toDate ?? null;
    if (!date || !reason) return NextResponse.json({ error: "date and reason required" }, { status: 400 });
    const extras = Array.isArray(notifyUserIds) ? notifyUserIds.filter((x: any) => Number.isInteger(x)) : [];

    // HR on-behalf: when targetUserId is set and the caller is HR-admin,
    // the WFH is created for that user instead of the caller. forceGrant
    // skips the monthly 2-of-2 cap (HR is overriding policy intentionally)
    // and unlocks the from/to RANGE form — one approved WFHRequest per
    // working day in the range.
    const targetUserId    = typeof body.targetUserId === "number" ? body.targetUserId : null;
    const forceGrant      = body.forceGrant === true;
    const onBehalf        = targetUserId !== null && targetUserId !== myId;
    if (onBehalf && !callerIsHRAdmin) {
      return NextResponse.json(
        { error: "Only HR admins can grant WFH on behalf of another user." },
        { status: 403 },
      );
    }
    const subjectUserId = onBehalf ? targetUserId! : myId;
    const isHRGrant     = onBehalf && callerIsHRAdmin && forceGrant;

    // Normalise to IST calendar days so any UTC-vs-IST drift around 18:30 UTC
    // doesn't shift which day a request belongs to.
    const fromIst = istDateOnlyFrom(new Date(date));
    const toIst   = toDateRaw ? istDateOnlyFrom(new Date(toDateRaw)) : fromIst;
    if (toIst.getTime() < fromIst.getTime()) {
      return NextResponse.json({ error: "toDate must be on or after fromDate" }, { status: 400 });
    }
    // Range support is HR-grant-only. Self-apply ignores toDate.
    const isRange = isHRGrant && toIst.getTime() > fromIst.getTime();
    if (!isHRGrant && toDateRaw && toIst.getTime() !== fromIst.getTime()) {
      return NextResponse.json(
        { error: "Date ranges are only available when HR applies on behalf." },
        { status: 400 },
      );
    }

    // ── Monthly WFH cap ────────────────────────────────────────────────
    // Each employee can WFH at most twice per IST calendar month (the cap
    // doesn't carry over). Pending and approved requests both count
    // against the limit so users can't queue up more than 2 in flight.
    if (!isHRGrant) {
      const { start: monthStart, end: monthEnd } = istMonthRange(fromIst);
      const usedThisMonth = await prisma.wFHRequest.count({
        where: {
          userId: subjectUserId,
          status: { in: ["pending", "approved"] },
          date:   { gte: monthStart, lte: monthEnd },
        },
      });
      if (usedThisMonth >= 2) {
        const monthLabel = monthStart.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
        return NextResponse.json({
          error: `WFH limit reached: 2 of 2 already used for ${monthLabel}.`,
        }, { status: 400 });
      }
    }

    // Build the list of IST calendar days to create. Skip Sat/Sun (no
    // working WFH on a weekend) and any day the subject already has a
    // pending/approved WFH for (idempotent — HR can re-run the same
    // range without duplicating rows).
    const targetDays: Date[] = [];
    for (let cur = new Date(fromIst.getTime()); cur.getTime() <= toIst.getTime(); cur.setUTCDate(cur.getUTCDate() + 1)) {
      const dow = cur.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      targetDays.push(new Date(cur));
    }
    if (targetDays.length === 0) {
      return NextResponse.json({ error: "Selected dates are all weekends." }, { status: 400 });
    }
    const existing = await prisma.wFHRequest.findMany({
      where: {
        userId: subjectUserId,
        status: { in: ["pending", "approved"] },
        date: { in: targetDays },
      },
      select: { date: true },
    });
    const existingKeys = new Set(existing.map((r) => r.date.toISOString().slice(0, 10)));
    const daysToCreate = targetDays.filter((d) => !existingKeys.has(d.toISOString().slice(0, 10)));
    if (daysToCreate.length === 0) {
      return NextResponse.json(
        { error: "All selected days already have a pending or approved WFH." },
        { status: 409 },
      );
    }

    // HR-on-behalf auto-approves. Self-apply stays pending → L1/L2.
    const finalStatus = isHRGrant ? "approved" : "pending";
    // Create rows in a single transaction so partial failures don't leave
    // half a range behind.
    const created = await prisma.$transaction(
      daysToCreate.map((d) =>
        prisma.wFHRequest.create({
          data: {
            userId: subjectUserId,
            date: d,
            reason,
            status: finalStatus,
            approvedById: finalStatus === "approved" ? myId : null,
          },
        }),
      ),
    );

    const subject = await prisma.user.findUnique({ where: { id: subjectUserId }, select: { name: true } });
    const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
    const rangeLabel = isRange
      ? `${fmt(fromIst)} – ${fmt(toIst)}`
      : fmt(fromIst);
    const skippedNote = existingKeys.size > 0
      ? ` (skipped ${existingKeys.size} day(s) that already had WFH)`
      : "";

    if (finalStatus === "approved" && onBehalf) {
      await notifyApprovers({
        actorId:  myId,
        type:     "wfh",
        entityId: created[0].id,
        title:    isRange
          ? `HR granted ${subject?.name || "an employee"} WFH for ${created.length} day(s)`
          : `HR granted ${subject?.name || "an employee"} a WFH for ${rangeLabel}`,
        body:     `${rangeLabel}${skippedNote} · ${String(reason).slice(0, 120)}`,
        linkUrl:  "/dashboard/hr/approvals?tab=wfh",
        extraUserIds: [subjectUserId, ...extras],
      });
    } else {
      await Promise.all([
        notifyApprovers({
          actorId:  myId,
          type:     "wfh",
          entityId: created[0].id,
          title:    `${subject?.name || "An employee"} requested Work From Home`,
          body:     `Date: ${rangeLabel} — ${String(reason).slice(0, 120)}`,
          linkUrl:  "/dashboard/hr/approvals?tab=wfh",
          extraUserIds: extras,
        }),
        notifyUsers({
          actorId:  null,
          userIds:  [subjectUserId],
          type:     "wfh",
          entityId: created[0].id,
          title:    `Work From Home request submitted`,
          body:     `Your request for ${rangeLabel} is awaiting approval.`,
          linkUrl:  "/dashboard/hr/attendance",
        }),
      ]);
    }
    // Backwards-compat shape for the single-day path; range returns a list.
    return NextResponse.json(
      isRange
        ? { created, skipped: Array.from(existingKeys) }
        : created[0],
      { status: 201 },
    );
  } catch (e) { return serverError(e, "POST /api/hr/attendance/wfh"); }
}

export async function PUT(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
  // Mirrors src/lib/access.ts:isHRAdmin — was missing special_access + role=admin + role=hr_manager.
  const isAdmin = user.orgLevel === "ceo" || user.isDeveloper || user.orgLevel === "hr_manager"
                || user.orgLevel === "special_access" || user.role === "admin" || user.role === "hr_manager";

  try {
    const body = await req.json();
    const id = Number(body.id);
    const action = body.action;
    const approvalNote = typeof body.approvalNote === "string" ? body.approvalNote : null;
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
    }

    const record = await prisma.wFHRequest.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, managerId: true } } },
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

    const dateLabel = new Date(record.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const requesterName = record.user?.name || "An employee";

    // ── REJECT (any open stage) ────────────────────────────────────
    if (action === "reject") {
      const { count } = await prisma.wFHRequest.updateMany({
        where: { id, status: { in: ["pending", "partially_approved"] } },
        data:  { status: "rejected", approvedById: record.approvedById ?? myId, approvalNote: approvalNote ?? record.approvalNote },
      });
      if (count === 0) return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });
      await notifyUsers({
        actorId:  myId,
        userIds:  [record.userId],
        type:     "wfh",
        entityId: record.id,
        title:    `Your Work From Home for ${dateLabel} was rejected`,
        body:     approvalNote ? String(approvalNote).slice(0, 160) : undefined,
        linkUrl:  "/dashboard/hr/attendance",
      });
      return NextResponse.json(await prisma.wFHRequest.findUnique({ where: { id } }));
    }

    // ── APPROVE STAGE 1 — manager → partially_approved ─────────────
    if (record.status === "pending") {
      const { count } = await prisma.wFHRequest.updateMany({
        where: { id, status: "pending" },
        data:  { status: "partially_approved", approvedById: myId, approvalNote },
      });
      if (count === 0) return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });

      const devEmails = (process.env.DEVELOPER_EMAILS || "")
        .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
      const finalApprovers = await prisma.user.findMany({
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
      await Promise.all([
        notifyUsers({
          actorId:  myId,
          userIds:  finalApprovers.map((u) => u.id),
          type:     "wfh",
          entityId: record.id,
          title:    `${requesterName}'s WFH for ${dateLabel} needs final approval`,
          body:     `Manager approved — awaiting CEO / HR.${approvalNote ? `\nNote: ${String(approvalNote).slice(0, 240)}` : ""}`,
          linkUrl:  "/dashboard/hr/approvals?tab=wfh",
        }),
        notifyUsers({
          actorId:  myId,
          userIds:  [record.userId],
          type:     "wfh",
          entityId: record.id,
          title:    `Your WFH for ${dateLabel} is partially approved`,
          body:     `Awaiting final approval from CEO / HR.${approvalNote ? `\nNote: ${String(approvalNote).slice(0, 240)}` : ""}`,
          linkUrl:  "/dashboard/hr/attendance",
        }),
      ]);
      return NextResponse.json(await prisma.wFHRequest.findUnique({ where: { id } }));
    }

    // ── APPROVE STAGE 2 — HR/CEO/Dev → approved (final) ────────────
    const { count } = await prisma.wFHRequest.updateMany({
      where: { id, status: "partially_approved" },
      data:  { status: "approved", approvalNote: approvalNote ?? record.approvalNote },
    });
    if (count === 0) return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });

    // Seed an Attendance row so the WFH day counts as worked.
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

    await notifyUsers({
      actorId:  myId,
      userIds:  [record.userId],
      type:     "wfh",
      entityId: record.id,
      title:    `Your WFH for ${dateLabel} is approved`,
      body:     `Final approval granted.${approvalNote ? `\nNote: ${String(approvalNote).slice(0, 240)}` : ""}`,
      linkUrl:  "/dashboard/hr/attendance",
    });
    return NextResponse.json(await prisma.wFHRequest.findUnique({ where: { id } }));
  } catch (e) { return serverError(e, "PUT /api/hr/attendance/wfh"); }
}
