import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { serializeBigInt } from "@/lib/utils";

// GET /api/hr/people/:id
// Returns the shape expected by /dashboard/hr/people/[id]/page.tsx:
//   { id, name, email, role, orgLevel, profilePictureUrl, profile, documents, assets, directReports, manager, shift, leaveBalances }
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const id = parseInt(params.id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        employeeProfile: true,
        manager: { select: { id: true, name: true, profilePictureUrl: true, role: true } },
        teamMembers: { select: { id: true, name: true, profilePictureUrl: true, role: true } },
        userShift: { include: { shift: true } },
        leaveBalances: { include: { leaveType: true } },
        heldAssets: { where: { returnedAt: null }, include: { asset: true } },
        ownedDocuments: true,
      },
    });
    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Reshape to what the detail page reads.
    const { employeeProfile, heldAssets, ownedDocuments, teamMembers, userShift, ...rest } = user;
    const payload = {
      ...rest,
      profile:       employeeProfile,
      documents:     ownedDocuments,
      assets:        heldAssets.map((a) => ({ ...a.asset, assignedAt: a.assignedAt })),
      directReports: teamMembers,
      shift:         userShift?.shift ?? null,
    };
    return NextResponse.json(serializeBigInt(payload));
  } catch (e) {
    return serverError(e, "GET /api/hr/people/[id]");
  }
}
