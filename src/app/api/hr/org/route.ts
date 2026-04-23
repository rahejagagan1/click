import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
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
