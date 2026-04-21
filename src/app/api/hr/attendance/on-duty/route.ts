import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { notifyApprovers } from "@/lib/notifications";

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
    await notifyApprovers({
      actorId:  myId,
      type:     "on_duty",
      entityId: rec.id,
      title:    `${requester?.name || "An employee"} requested On Duty`,
      body:     `Date: ${new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}${location ? ` @ ${location}` : ""} — ${String(purpose).slice(0, 120)}`,
      linkUrl:  "/dashboard/hr/attendance",
      extraUserIds: extras,
    });
    return NextResponse.json(rec, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/attendance/on-duty"); }
}

export async function PUT(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;
  const myId = await resolveUserId(session);
  const isAdmin = user.orgLevel === "ceo" || user.isDeveloper || user.orgLevel === "hr_manager";

  try {
    const { id, action, approvalNote } = await req.json();
    const record = await prisma.onDutyRequest.findUnique({ where: { id } });
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (!isAdmin) {
      const isMgr = await prisma.user.findFirst({ where: { id: record.userId, managerId: myId! } });
      if (!isMgr) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const updated = await prisma.onDutyRequest.update({
      where: { id },
      data: { status: action === "approve" ? "approved" : "rejected", approvedById: myId, approvalNote },
    });
    return NextResponse.json(updated);
  } catch (e) { return serverError(e, "PUT /api/hr/attendance/on-duty"); }
}
