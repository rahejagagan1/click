import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { encryptPII } from "@/lib/pii-crypto";

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
      // Sensitive fields — encrypted at rest before insert.
      bankName, bankAccountNumber, bankIfsc, bankBranch, accountHolderName,
      panNumber, parentName, aadhaarNumber, aadhaarEnrollment,
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

    // Build the EmployeeProfile patch. Encrypt PII columns just before
    // writing so the DB never sees plaintext for these fields.
    const profileData: Record<string, unknown> = {
      phone, gender, bloodGroup,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      emergencyContact, emergencyPhone, address, city, state,
      bankName, bankBranch, accountHolderName, parentName,
    };
    if (bankAccountNumber !== undefined) profileData.bankAccountNumber = encryptPII(bankAccountNumber);
    if (bankIfsc           !== undefined) profileData.bankIfsc           = encryptPII(bankIfsc);
    if (panNumber          !== undefined) profileData.panNumber          = encryptPII(panNumber);
    if (aadhaarNumber      !== undefined) profileData.aadhaarNumber      = encryptPII(aadhaarNumber);
    if (aadhaarEnrollment  !== undefined) profileData.aadhaarEnrollment  = encryptPII(aadhaarEnrollment);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: myId },
        data: { profilePictureUrl: profilePictureUrl || undefined },
      }),
      prisma.employeeProfile.update({
        where: { userId: myId },
        data: profileData as any,
      }),
    ]);

    const updated = await prisma.user.findUnique({
      where: { id: myId },
      select: { id: true, name: true, email: true, profilePictureUrl: true, employeeProfile: true },
    });
    return NextResponse.json(updated);
  } catch (e) { return serverError(e, "PUT /api/hr/profile"); }
}
