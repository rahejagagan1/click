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
  // Mirrors src/lib/access.ts:isHRAdmin — was missing special_access + role=admin + role=hr_manager.
  const isAdmin = user.orgLevel === "ceo" || user.isDeveloper || user.orgLevel === "hr_manager"
                || user.orgLevel === "special_access" || user.role === "admin" || user.role === "hr_manager";
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
    const body = await req.json();
    const { date, fromTime, toTime, purpose, location, notifyUserIds, toDate, targetUserId } = body;
    if (!date || !purpose) return NextResponse.json({ error: "date and purpose required" }, { status: 400 });
    const extras = Array.isArray(notifyUserIds) ? notifyUserIds.filter((x: any) => Number.isInteger(x)) : [];

    // HR-on-behalf: when targetUserId is set and the caller is HR-admin,
    // the on-duty is created for that user instead of the caller.
    const callerUser = session!.user as any;
    const callerIsHRAdmin = callerUser.orgLevel === "ceo" || callerUser.isDeveloper
                          || callerUser.orgLevel === "hr_manager" || callerUser.orgLevel === "special_access"
                          || callerUser.role === "admin" || callerUser.role === "hr_manager";
    const tid = typeof targetUserId === "number" ? targetUserId : null;
    const onBehalf = tid !== null && tid !== myId && callerIsHRAdmin;
    const subjectUserId = onBehalf ? tid! : myId;

    // Date range: only HR-on-behalf can grant a multi-day on-duty.
    // Self-apply ignores `toDate`. Weekends are skipped server-side
    // so HR can drop a Mon–Fri range without worrying about Sat/Sun.
    const fromDate = new Date(date);
    const toDateObj = toDate ? new Date(toDate) : fromDate;
    if (toDateObj.getTime() < fromDate.getTime()) {
      return NextResponse.json({ error: "toDate must be on or after date" }, { status: 400 });
    }
    if (!onBehalf && toDateObj.getTime() !== fromDate.getTime()) {
      return NextResponse.json({ error: "Date ranges are only available when HR applies on behalf." }, { status: 400 });
    }
    const targetDays: Date[] = [];
    for (let cur = new Date(fromDate.getTime()); cur.getTime() <= toDateObj.getTime(); cur.setUTCDate(cur.getUTCDate() + 1)) {
      const dow = cur.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      targetDays.push(new Date(cur));
    }
    if (targetDays.length === 0) {
      return NextResponse.json({ error: "Selected dates are all weekends." }, { status: 400 });
    }
    const created = await prisma.$transaction(
      targetDays.map((d) => prisma.onDutyRequest.create({
        data: {
          userId:   subjectUserId,
          date:     d,
          fromTime: fromTime ? new Date(`${d.toISOString().slice(0,10)}T${fromTime}:00`) : null,
          toTime:   toTime   ? new Date(`${d.toISOString().slice(0,10)}T${toTime}:00`)   : null,
          purpose,
          location,
        },
      })),
    );
    const rec = created[0];
    const isRange = created.length > 1;
    const requester = await prisma.user.findUnique({ where: { id: subjectUserId }, select: { name: true } });
    const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
    const dateLabel = isRange ? `${fmt(fromDate)} – ${fmt(toDateObj)} (${created.length} day${created.length === 1 ? "" : "s"})` : new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    // Structured emailData so the on-duty email mirrors WFH / leave —
    // Reason block shows just the user-typed purpose, Date row shows the
    // chosen on-duty date (not the submission date), Location surfaces
    // as its own row when set.
    const odEmailBase = {
      applicantName: requester?.name || "An employee",
      date,
      location: location || undefined,
      reason: String(purpose || "").trim() || undefined,
    };
    await Promise.all([
      notifyApprovers({
        actorId:  myId,
        type:     "on_duty",
        entityId: rec.id,
        title:    `${requester?.name || "An employee"} requested On Duty`,
        body:     `Date: ${dateLabel}${location ? ` @ ${location}` : ""} — ${String(purpose).slice(0, 120)}`,
        linkUrl:  "/dashboard/hr/approvals?tab=wfh",
        extraUserIds: extras,
        emailData: odEmailBase,
      }),
      notifyUsers({
        actorId:  null,
        userIds:  [myId],
        type:     "on_duty",
        entityId: rec.id,
        title:    `On Duty request submitted`,
        body:     `Your request for ${dateLabel}${location ? ` @ ${location}` : ""} is awaiting approval.`,
        linkUrl:  "/dashboard/hr/attendance",
        emailData: odEmailBase,
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

    const record = await prisma.onDutyRequest.findUnique({
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
    const approver = await prisma.user.findUnique({ where: { id: myId }, select: { name: true } });
    const approverName = approver?.name || "An approver";

    // Reused across every branch so the email matches WFH / leave format —
    // Reason = original purpose, Date = chosen on-duty date, plus the
    // existing approver context flows through to the chain rows.
    const odEmailBase = {
      applicantName: requesterName,
      date:          record.date,
      location:      record.location ?? undefined,
      reason:        record.purpose || undefined,
    };

    // ── REJECT (any open stage) ────────────────────────────────────
    if (action === "reject") {
      const { count } = await prisma.onDutyRequest.updateMany({
        where: { id, status: { in: ["pending", "partially_approved"] } },
        data:  { status: "rejected", approvedById: record.approvedById ?? myId, approvalNote: approvalNote ?? record.approvalNote },
      });
      if (count === 0) return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });
      await notifyUsers({
        actorId:  myId,
        userIds:  [record.userId],
        type:     "on_duty",
        entityId: record.id,
        title:    `Your On Duty request for ${dateLabel} was rejected`,
        body:     approvalNote ? String(approvalNote).slice(0, 160) : undefined,
        linkUrl:  "/dashboard/hr/attendance",
        emailData: { ...odEmailBase, approverName, stageLabel: "Rejected by", approvalNote: approvalNote ?? undefined },
      });
      return NextResponse.json(await prisma.onDutyRequest.findUnique({ where: { id } }));
    }

    // ── APPROVE STAGE 1 — manager → partially_approved ─────────────
    if (record.status === "pending") {
      const { count } = await prisma.onDutyRequest.updateMany({
        where: { id, status: "pending" },
        data:  { status: "partially_approved", approvedById: myId, approvalNote },
      });
      if (count === 0) return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });

      const devEmails = (process.env.DEVELOPER_EMAILS || "")
        .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
      // CEO + Special Access + HR Manager (role) + Developers.
      const finalApprovers = await prisma.user.findMany({
        where: {
          isActive: true,
          OR: [
            { orgLevel: { in: ["ceo", "special_access"] } },
            { role: "hr_manager" },
            ...(devEmails.length > 0 ? [{ email: { in: devEmails } }] : []),
          ],
        },
        select: { id: true },
      });
      await Promise.all([
        notifyUsers({
          actorId:  myId,
          userIds:  finalApprovers.map((u) => u.id),
          type:     "on_duty",
          entityId: record.id,
          title:    `${requesterName}'s On Duty for ${dateLabel} needs final approval`,
          body:     `Manager approved — awaiting CEO / HR.${approvalNote ? `\nNote: ${String(approvalNote).slice(0, 240)}` : ""}`,
          linkUrl:  "/dashboard/hr/approvals?tab=wfh",
          emailData: { ...odEmailBase, l1ApproverName: approverName, l1ApprovalNote: approvalNote ?? undefined },
        }),
        notifyUsers({
          actorId:  myId,
          userIds:  [record.userId],
          type:     "on_duty",
          entityId: record.id,
          title:    `Your On Duty for ${dateLabel} is partially approved`,
          body:     `Awaiting final approval from CEO / HR.${approvalNote ? `\nNote: ${String(approvalNote).slice(0, 240)}` : ""}`,
          linkUrl:  "/dashboard/hr/attendance",
          emailData: { ...odEmailBase, l1ApproverName: approverName, l1ApprovalNote: approvalNote ?? undefined },
        }),
      ]);
      return NextResponse.json(await prisma.onDutyRequest.findUnique({ where: { id } }));
    }

    // ── APPROVE STAGE 2 — HR/CEO/Dev → approved (final) ────────────
    const { count } = await prisma.onDutyRequest.updateMany({
      where: { id, status: "partially_approved" },
      data:  { status: "approved", approvalNote: approvalNote ?? record.approvalNote },
    });
    if (count === 0) return NextResponse.json({ error: "Request has already been decided" }, { status: 409 });

    // Look up the L1 manager so the final email lists them alongside the
    // CEO/HR finaliser (mirrors the leave email's two-row chain).
    const l1Approver = record.approvedById
      ? await prisma.user.findUnique({ where: { id: record.approvedById }, select: { name: true } })
      : null;

    await notifyUsers({
      actorId:  myId,
      userIds:  [record.userId],
      type:     "on_duty",
      entityId: record.id,
      title:    `Your On Duty for ${dateLabel} is approved`,
      body:     `Final approval granted.${approvalNote ? `\nNote: ${String(approvalNote).slice(0, 240)}` : ""}`,
      linkUrl:  "/dashboard/hr/attendance",
      emailData: {
        ...odEmailBase,
        l1ApproverName: l1Approver?.name,
        l1ApprovalNote: record.approvalNote ?? undefined,
        approverName,
        stageLabel:     "Approved by",
        approvalNote:   approvalNote ?? undefined,
      },
    });
    return NextResponse.json(await prisma.onDutyRequest.findUnique({ where: { id } }));
  } catch (e) { return serverError(e, "PUT /api/hr/attendance/on-duty"); }
}
