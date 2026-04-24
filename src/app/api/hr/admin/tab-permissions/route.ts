import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

function canManage(session: any): boolean {
  const u = session?.user;
  return u?.orgLevel === "ceo" || u?.isDeveloper === true
    || u?.orgLevel === "hr_manager" || u?.role === "admin"
    || u?.orgLevel === "special_access";
}

/**
 * GET /api/hr/admin/tab-permissions
 *
 * Returns every active user with an `isNew` flag = true when they have
 * zero rows in UserTabPermission yet. Uses raw SQL for the
 * permission-lookup so the handler stays functional even before the
 * Prisma client is regenerated after adding the new model.
 */
export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, email: true, profilePictureUrl: true,
        orgLevel: true, role: true,
      },
      orderBy: [{ name: "asc" }],
    });

    // Raw SQL avoids needing the UserTabPermission model on the typed
    // client — works immediately after `prisma migrate deploy`, before
    // `prisma generate` has re-run. If the table doesn't exist yet (pre-
    // migrate), treat every user as NEW.
    let userIdsWithPerms = new Set<number>();
    try {
      const rows = await prisma.$queryRawUnsafe<{ userId: number }[]>(
        `SELECT DISTINCT "userId" FROM "UserTabPermission"`
      );
      userIdsWithPerms = new Set(rows.map((r) => Number(r.userId)));
    } catch {
      // Table not created yet — everyone is NEW.
    }

    return NextResponse.json(
      users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        profilePictureUrl: u.profilePictureUrl,
        orgLevel: u.orgLevel,
        role: u.role,
        isNew: !userIdsWithPerms.has(u.id),
      }))
    );
  } catch (e) {
    return serverError(e, "GET /api/hr/admin/tab-permissions");
  }
}
