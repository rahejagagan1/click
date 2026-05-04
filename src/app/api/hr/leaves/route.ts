import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
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
    const isAdmin = self.orgLevel === "ceo" || self.isDeveloper || self.orgLevel === "hr_manager";
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
export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const { leaveTypeId, fromDate, toDate, reason, notifyUserIds } = await req.json();
    if (!leaveTypeId || !fromDate || !toDate || !reason)
      return NextResponse.json({ error: "All fields are required" }, { status: 400 });
    const extras = Array.isArray(notifyUserIds) ? notifyUserIds.filter((x: any) => Number.isInteger(x)) : [];

    const from = new Date(fromDate), to = new Date(toDate);
    if (from > to) return NextResponse.json({ error: "Invalid date range" }, { status: 400 });

    // Block balance-only types (e.g. Carry Over Leave) — the UI hides
    // them but a hand-crafted POST would otherwise sneak through.
    const leaveType = await prisma.leaveType.findUnique({ where: { id: Number(leaveTypeId) } });
    if (!leaveType || !leaveType.isActive) {
      return NextResponse.json({ error: "Unknown leave type" }, { status: 400 });
    }
    if (leaveType.applicable === false) {
      return NextResponse.json({ error: "This leave type is not applicable — balance is encashed at exit." }, { status: 400 });
    }

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
    const balance = await prisma.leaveBalance.findUnique({
      where: { userId_leaveTypeId_year: { userId: myId, leaveTypeId, year } },
    });
    if (!balance) return NextResponse.json({ error: "No leave balance found. Contact HR." }, { status: 400 });

    const available = parseFloat(balance.totalDays.toString()) - parseFloat(balance.usedDays.toString()) - parseFloat(balance.pendingDays.toString());
    if (totalDays > available) return NextResponse.json({ error: `Insufficient balance. Available: ${available}, requested: ${totalDays}` }, { status: 400 });

    const overlap = await prisma.leaveApplication.findFirst({
      where: { userId: myId, status: { in: ["pending", "approved"] }, fromDate: { lte: to }, toDate: { gte: from } },
    });
    if (overlap) return NextResponse.json({ error: "Overlapping leave exists" }, { status: 400 });

    const [application] = await prisma.$transaction([
      prisma.leaveApplication.create({
        data: {
          userId: myId, leaveTypeId, fromDate: from, toDate: to, totalDays, reason,
          status: "pending", notifyUserIds: extras,
        },
        include: { leaveType: true, user: { select: { managerId: true, name: true } } },
      }),
      prisma.leaveBalance.update({
        where: { userId_leaveTypeId_year: { userId: myId, leaveTypeId, year } },
        data: { pendingDays: { increment: totalDays } },
      }),
    ]);

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
          { orgLevel: { in: ["ceo", "hr_manager"] } },
          { role: "admin" },
          ...(devEmails.length > 0 ? [{ email: { in: devEmails } }] : []),
        ],
      },
      select: { id: true },
    });
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
      title:    `${requesterName} requested ${application.leaveType?.name || "leave"}`,
      body:     `${from.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} – ${to.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} (${totalDays} day${totalDays === 1 ? "" : "s"}) — awaiting manager approval.`,
      linkUrl:  "/dashboard/hr/approvals",
    });

    return NextResponse.json(application);
  } catch (e) { return serverError(e, "POST /api/hr/leaves"); }
}
