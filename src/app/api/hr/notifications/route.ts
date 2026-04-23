import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// GET /api/hr/notifications?view=unread|all&limit=20
export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const { searchParams } = new URL(req.url);
    const view  = searchParams.get("view") || "all";
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10) || 20, 100);

    const where: any = { userId: myId };
    if (view === "unread") where.isRead = false;

    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        include: { actor: { select: { id: true, name: true, profilePictureUrl: true } } },
      }),
      prisma.notification.count({ where: { userId: myId, isRead: false } }),
    ]);

    return NextResponse.json({ items, unreadCount });
  } catch (e) { return serverError(e, "GET /api/hr/notifications"); }
}

// PATCH /api/hr/notifications
// Body: { id: number, action: "read" } | { action: "read_all" }
export async function PATCH(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const body = await req.json();
    const now  = new Date();

    if (body?.action === "read_all") {
      const res = await prisma.notification.updateMany({
        where: { userId: myId, isRead: false },
        data:  { isRead: true, readAt: now },
      });
      return NextResponse.json({ updated: res.count });
    }
    if (body?.action === "read" && typeof body.id === "number") {
      const res = await prisma.notification.updateMany({
        where: { id: body.id, userId: myId },
        data:  { isRead: true, readAt: now },
      });
      if (res.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ updated: res.count });
    }
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e) { return serverError(e, "PATCH /api/hr/notifications"); }
}

// DELETE /api/hr/notifications?scope=read
// Removes notifications belonging to the current user. The `scope` query
// controls what's deleted:
//   • "read" (default) — delete only notifications already marked isRead.
//   • "all"            — delete everything for this user (tidy-up nuke).
export async function DELETE(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get("scope") || "read";
    if (scope !== "read" && scope !== "all") {
      return NextResponse.json({ error: "scope must be 'read' or 'all'" }, { status: 400 });
    }
    const where = scope === "all"
      ? { userId: myId }
      : { userId: myId, isRead: true };
    const res = await prisma.notification.deleteMany({ where });
    return NextResponse.json({ deleted: res.count });
  } catch (e) { return serverError(e, "DELETE /api/hr/notifications"); }
}
