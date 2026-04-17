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

    const [user] = await prisma.$transaction([
      prisma.user.update({
        where: { id: myId },
        data: { profilePictureUrl: profilePictureUrl || undefined },
        select: { id: true, name: true, email: true, profilePictureUrl: true },
      }),
      prisma.employeeProfile.upsert({
        where: { userId: myId },
        create: {
          userId: myId,
          employeeId: `NB-${new Date().getFullYear()}-${String(myId).padStart(3, "0")}`,
          phone, gender, bloodGroup,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
          emergencyContact, emergencyPhone, address, city, state,
        },
        update: {
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
