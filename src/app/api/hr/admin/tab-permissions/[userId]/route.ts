import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import {
  tabPermissionsForUser,
  seedDefaultPermissionsIfMissing,
  hasProtectedRole,
  savePermissions,
} from "@/lib/permissions/resolve";

export const dynamic = "force-dynamic";

function canManage(session: any): boolean {
  const u = session?.user;
  return u?.orgLevel === "ceo" || u?.isDeveloper === true
    || u?.orgLevel === "hr_manager" || u?.role === "admin"
    || u?.orgLevel === "special_access";
}

/**
 * GET /api/hr/admin/tab-permissions/:userId
 *
 * Returns the target user's current tab permissions + protected flag.
 * SIDE EFFECT: if the user has never had permissions set, seeds the
 * defaults and clears the "NEW" badge. Calling GET on a new user's row
 * is how the admin "acknowledges" them.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  try {
    const { userId: userIdRaw } = await params;
    const targetId = parseInt(userIdRaw, 10);
    if (!Number.isFinite(targetId)) {
      return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
    }

    const actorId = await resolveUserId(session);
    const { seeded } = await seedDefaultPermissionsIfMissing(targetId, actorId);

    const [target, permissions] = await Promise.all([
      prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true, name: true, email: true, profilePictureUrl: true, orgLevel: true, role: true },
      }),
      tabPermissionsForUser(targetId),
    ]);

    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const devEmails = (process.env.DEVELOPER_EMAILS || "")
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    const targetIsDeveloper = devEmails.includes(target.email.toLowerCase());

    return NextResponse.json({
      user: { ...target, isDeveloper: targetIsDeveloper },
      protected: hasProtectedRole({ ...target, isDeveloper: targetIsDeveloper }),
      permissions,
      wasNew: seeded,
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/admin/tab-permissions/[userId]");
  }
}

/**
 * PUT /api/hr/admin/tab-permissions/:userId
 *
 * Body: { permissions: { [tabKey]: boolean } }
 * Upserts each key; protected-role users are returned unchanged (UI
 * already greys out their toggles, this is the backend enforcement).
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  try {
    const { userId: userIdRaw } = await params;
    const targetId = parseInt(userIdRaw, 10);
    if (!Number.isFinite(targetId)) {
      return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
    }
    const actorId = await resolveUserId(session);
    const body = await req.json();
    const incoming: Record<string, boolean> = body?.permissions ?? {};

    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { email: true, orgLevel: true, role: true },
    });
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const devEmails = (process.env.DEVELOPER_EMAILS || "")
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    const targetIsDeveloper = devEmails.includes(target.email.toLowerCase());
    if (hasProtectedRole({ ...target, isDeveloper: targetIsDeveloper })) {
      // Silent success — protected users always have everything.
      const permissions = await tabPermissionsForUser(targetId);
      return NextResponse.json({ permissions, protected: true });
    }

    // Uses raw SQL internally so it's resilient to the typed Prisma
    // client not yet knowing about the UserTabPermission model.
    await savePermissions(targetId, incoming, actorId ?? null);
    const permissions = await tabPermissionsForUser(targetId);
    return NextResponse.json({ permissions, protected: false });
  } catch (e) {
    return serverError(e, "PUT /api/hr/admin/tab-permissions/[userId]");
  }
}
