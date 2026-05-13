import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isDeveloperEmail } from "@/lib/hr/notification-policy";

export const dynamic = "force-dynamic";

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    // Developer invisibility: hide DEVELOPER_EMAILS rows from non-dev viewers.
    const viewer = session!.user as any;
    const viewerIsDev = isDeveloperEmail(viewer?.email ?? null);
    const devEmails = (process.env.DEVELOPER_EMAILS || "")
      .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const hideDevs = !viewerIsDev && devEmails.length > 0;

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        ...(hideDevs ? { NOT: { email: { in: devEmails } } } : {}),
      },
      select: {
        id: true, name: true, email: true, role: true, orgLevel: true,
        managerId: true, profilePictureUrl: true, teamCapsule: true,
        employeeProfile: {
          select: { department: true, designation: true, employmentType: true, joiningDate: true },
        },
      },
      orderBy: { name: "asc" },
    });

    // Build tree: group children under their manager
    const map = new Map<number, any>();
    users.forEach(u => map.set(u.id, { ...u, children: [] }));

    const roots: any[] = [];
    users.forEach(u => {
      if (u.managerId && map.has(u.managerId)) {
        map.get(u.managerId).children.push(map.get(u.id));
      } else {
        roots.push(map.get(u.id));
      }
    });

    return NextResponse.json({ tree: roots, flat: users });
  } catch (e) { return serverError(e, "GET /api/hr/org"); }
}
