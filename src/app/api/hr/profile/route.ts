import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const user = await prisma.user.findUnique({
      where: { id: myId },
      select: {
        id: true, name: true, email: true, profilePictureUrl: true,
        employeeProfile: true,
      },
    });
    return NextResponse.json(user);
  } catch (e) { return serverError(e, "GET /api/hr/profile"); }
}

export async function PUT(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const myId = await resolveUserId(session);
  if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const body = await req.json();
    const {
      phone, dateOfBirth, gender, bloodGroup,
      emergencyContact, emergencyPhone,
      address, city, state, profilePictureUrl,
    } = body;

    // Self-edit updates the profile in place. We don't auto-create here: creation
    // belongs to the HR Add Employee wizard so firstName/lastName/employeeId/series
    // get populated correctly. Users without a profile must be onboarded by HR.
    const existing = await prisma.employeeProfile.findUnique({ where: { userId: myId } });
    if (!existing) {
      return NextResponse.json(
        { error: "No employee profile found — please ask HR to onboard you first." },
        { status: 400 },
      );
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: myId },
        data: { profilePictureUrl: profilePictureUrl || undefined },
      }),
      prisma.employeeProfile.update({
        where: { userId: myId },
        data: {
          phone, gender, bloodGroup,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
          emergencyContact, emergencyPhone, address, city, state,
        },
      }),
    ]);

    const updated = await prisma.user.findUnique({
      where: { id: myId },
      select: { id: true, name: true, email: true, profilePictureUrl: true, employeeProfile: true },
    });
    return NextResponse.json(updated);
  } catch (e) { return serverError(e, "PUT /api/hr/profile"); }
}
