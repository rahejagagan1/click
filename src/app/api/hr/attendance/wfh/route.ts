import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { notifyApprovers, notifyUsers } from "@/lib/notifications";
import { istTimeOnDate, istDateOnlyFrom, istMonthRange } from "@/lib/ist-date";
import { stringifyAttLoc } from "@/lib/attendance-location";
import { checkPastDateAllowed } from "@/lib/hr/leave-date-rules";
import { sendEmail } from "@/lib/email/sender";
import { pocAssignmentEmail } from "@/lib/email/templates";
import { devEmailRecipientsClause } from "@/lib/email/toggles";
import { assertSameBrandOrSuperAdmin } from "@/lib/hr/cross-brand-guard";

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

    // Past-date gate: regular users can't pre-emptively backdate a WFH
    // request — that goes through Regularization. CEO / role=hr_manager
    // / isDeveloper bypass via canApplyRestrictedLeave.
    const pastErr = checkPastDateAllowed(date, self);
    if (pastErr) return NextResponse.json({ error: pastErr }, { status: 400 });

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

    // Handoff fields — company-standard WFH format. Work Status + Time
    // of Unavailability are always required. POC is N/A-able: the form
    // has a "Mark as N/A" toggle for cases where no specific cover is
    // assigned, which sends pocUserId=null. When a POC is named, it
    // must be a real active user.
    // Coerce defensively: Number(null) === 0 and Number.isFinite(0) === true,
    // so a missing/N/A POC would otherwise become userId 0 and fail the FK.
    const pocUserId      = Number.isInteger(Number(body.pocUserId)) && Number(body.pocUserId) > 0 ? Number(body.pocUserId) : null;
    const workStatus     = typeof body.workStatus     === "string" ? body.workStatus.trim()     : "";
    const unavailability = typeof body.unavailability === "string" ? body.unavailability.trim() : "";
    if (!workStatus)             return NextResponse.json({ error: "Work Status is required." }, { status: 400 });
    if (!unavailability)         return NextResponse.json({ error: "Time of Unavailability is required." }, { status: 400 });
    const pocUser = pocUserId
      ? await prisma.user.findUnique({
          where: { id: pocUserId },
          select: { id: true, name: true, email: true, isActive: true },
        })
      : null;
    if (pocUserId && (!pocUser || !pocUser.isActive)) {
      return NextResponse.json({ error: "Selected POC is not an active employee." }, { status: 400 });
    }

    // Normalise to IST calendar days so any UTC-vs-IST drift around 18:30 UTC
    // doesn't shift which day a request belongs to.
    const fromIst = istDateOnlyFrom(new Date(date));
    const toIst   = toDateRaw ? istDateOnlyFrom(new Date(toDateRaw)) : fromIst;
    if (toIst.getTime() < fromIst.getTime()) {
      return NextResponse.json({ error: "toDate must be on or after fromDate" }, { status: 400 });
    }
    // Range support is HR-on-behalf only (forceGrant not required —
    // ranges go through normal L1→L2 approval like single days).
    // Self-apply ignores toDate.
    const isRange = onBehalf && callerIsHRAdmin && toIst.getTime() > fromIst.getTime();
    if (!onBehalf && toDateRaw && toIst.getTime() !== fromIst.getTime()) {
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
          // pocUserId / workStatus / unavailability may be unknown to the
          // typed client until `prisma generate` reruns (Windows DLL lock).
          // Runtime is fine — the migration already added all three.
          data: ({
            userId: subjectUserId,
            date: d,
            reason,
            status: finalStatus,
            approvedById: finalStatus === "approved" ? myId : null,
            pocUserId, workStatus, unavailability,
          } as any),
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

    // Structured emailData so the WFH email mirrors leave / on-duty —
    // Reason block = just the typed reason, Date / From-To shows the
    // user's chosen dates (not the submission day).
    const wfhEmailBase = {
      applicantName: subject?.name || "An employee",
      date:          fromIst,
      toDate:        isRange ? toIst : undefined,
      reason:        String(reason || "").trim() || undefined,
    };
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
        emailData: wfhEmailBase,
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
          emailData: wfhEmailBase,
        }),
        notifyUsers({
          actorId:  null,
          userIds:  [subjectUserId],
          type:     "wfh",
          entityId: created[0].id,
          title:    `Work From Home request submitted`,
          body:     `Your request for ${rangeLabel} is awaiting approval.`,
          linkUrl:  "/dashboard/hr/attendance",
          emailData: wfhEmailBase,
        }),
      ]);
    }

    // POC heads-up — separate from the approver chain so the named
    // backup gets a direct ping. Fire-and-forget so SMTP hiccups
    // don't 500 the save. When POC is N/A (HR on-behalf), pocUser is
    // null — skip the email.
    if (pocUser && pocUser.email && pocUserId !== subjectUserId) {
      void sendEmail({
        to: pocUser.email,
        content: pocAssignmentEmail({
          pocName:       pocUser.name || "there",
          applicantName: subject?.name || "An employee",
          requestType:   "Work From Home",
          dateLabel:     rangeLabel,
          daysLabel:     `${created.length} day${created.length === 1 ? "" : "s"}`,
          workStatus,
          reason:        String(reason || "").trim() || undefined,
        }),
      });
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

    // Cross-brand approval guard — YT Labs HR cannot action an NB
    // Media employee's WFH/OD request (and vice versa). Founder bypasses.
    if (record.user?.id != null) {
      const crossBrand = await assertSameBrandOrSuperAdmin(session, record.user.id);
      if (crossBrand) return crossBrand;
    }

    const dateLabel = new Date(record.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const requesterName = record.user?.name || "An employee";
    const approver = await prisma.user.findUnique({ where: { id: myId }, select: { name: true } });
    const approverName = approver?.name || "An approver";

    // Shared payload — mirrors leave / on-duty / regularize so every
    // stage email shows the requester, the actual WFH date, and the
    // user-typed reason instead of falling back to the body line.
    const wfhEmailBase = {
      applicantName: requesterName,
      date:          record.date,
      reason:        record.reason || undefined,
    };

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
        emailData: { ...wfhEmailBase, approverName, stageLabel: "Rejected by", approvalNote: approvalNote ?? undefined },
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

      // CEO + Special Access + HR Manager (role). Developer accounts
      // gated by the "Notify developers" toggle in Admin → Emails.
      const finalApprovers = await prisma.user.findMany({
        where: {
          isActive: true,
          OR: [
            { orgLevel: { in: ["ceo", "special_access"] } },
            { role: "hr_manager" },
            ...(await devEmailRecipientsClause()),
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
          emailData: { ...wfhEmailBase, l1ApproverName: approverName, l1ApprovalNote: approvalNote ?? undefined },
        }),
        notifyUsers({
          actorId:  myId,
          userIds:  [record.userId],
          type:     "wfh",
          entityId: record.id,
          title:    `Your WFH for ${dateLabel} is partially approved`,
          body:     `Awaiting final approval from CEO / HR.${approvalNote ? `\nNote: ${String(approvalNote).slice(0, 240)}` : ""}`,
          linkUrl:  "/dashboard/hr/attendance",
          emailData: { ...wfhEmailBase, l1ApproverName: approverName, l1ApprovalNote: approvalNote ?? undefined },
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

    // L1 approver lookup so the final email lists manager + finaliser.
    const l1Approver = record.approvedById
      ? await prisma.user.findUnique({ where: { id: record.approvedById }, select: { name: true } })
      : null;
    await notifyUsers({
      actorId:  myId,
      userIds:  [record.userId],
      type:     "wfh",
      entityId: record.id,
      title:    `Your WFH for ${dateLabel} is approved`,
      body:     `Final approval granted.${approvalNote ? `\nNote: ${String(approvalNote).slice(0, 240)}` : ""}`,
      linkUrl:  "/dashboard/hr/attendance",
      emailData: {
        ...wfhEmailBase,
        l1ApproverName: l1Approver?.name,
        l1ApprovalNote: record.approvalNote ?? undefined,
        approverName,
        stageLabel:     "Approved by",
        approvalNote:   approvalNote ?? undefined,
      },
    });
    return NextResponse.json(await prisma.wFHRequest.findUnique({ where: { id } }));
  } catch (e) { return serverError(e, "PUT /api/hr/attendance/wfh"); }
}
