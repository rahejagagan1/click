import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { serializeBigInt } from "@/lib/utils";
import { encryptPII } from "@/lib/pii-crypto";

// Editing other employees' profiles is reserved for HR ops + admins.
// (`requireHRAdmin` would work but we also want to permit role=admin, which
// some admins are flagged as instead of having orgLevel=ceo.)
function canEditOthers(session: any): boolean {
  const u = session?.user;
  if (!u) return false;
  return (
    u.orgLevel === "ceo" ||
    u.orgLevel === "hr_manager" ||
    u.role === "admin" ||
    u.isDeveloper === true
  );
}

// GET /api/hr/people/:id
// Returns the shape expected by /dashboard/hr/people/[id]/page.tsx:
//   { id, name, email, role, orgLevel, profilePictureUrl, profile, documents, assets, directReports, manager, shift, leaveBalances }
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
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

// PUT /api/hr/people/:id
// Lets HR / CEO / admin / developer edit any employee's User row + EmployeeProfile.
// Mirrors /api/hr/profile PUT (own-edit) but targets the path-param userId.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canEditOthers(session)) {
    return NextResponse.json(
      { error: "Only HR / CEO / admins / developers can edit other employees" },
      { status: 403 },
    );
  }

  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await req.json();
    const {
      displayName,
      phone, workPhone, personalEmail,
      dateOfBirth, gender, bloodGroup, maritalStatus,
      emergencyContact, emergencyPhone,
      address, city, state, profilePictureUrl,
      // Sensitive — encrypted at rest before save.
      panNumber, parentName, aadhaarNumber, aadhaarEnrollment,
    } = body;

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    const existing = await prisma.employeeProfile.findUnique({ where: { userId: id } });

    // Build the EmployeeProfile patch using only the typed columns.
    const profileData: Record<string, unknown> = {
      phone, gender, bloodGroup,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      emergencyContact, emergencyPhone, address, city, state, parentName,
    };
    if (panNumber         !== undefined) profileData.panNumber         = encryptPII(panNumber);
    if (aadhaarNumber     !== undefined) profileData.aadhaarNumber     = encryptPII(aadhaarNumber);
    if (aadhaarEnrollment !== undefined) profileData.aadhaarEnrollment = encryptPII(aadhaarEnrollment);

    const userPatch: Record<string, unknown> = {};
    if (profilePictureUrl) userPatch.profilePictureUrl = profilePictureUrl;
    if (typeof displayName === "string" && displayName.trim().length > 0) {
      userPatch.name = displayName.trim().slice(0, 120);
    }

    const txOps: any[] = [];
    if (Object.keys(userPatch).length > 0) {
      txOps.push(prisma.user.update({ where: { id }, data: userPatch }));
    }
    if (existing && Object.values(profileData).some((v) => v !== undefined)) {
      txOps.push(prisma.employeeProfile.update({
        where: { userId: id },
        data: profileData as any,
      }));
    }
    if (txOps.length > 0) {
      try {
        await prisma.$transaction(txOps);
      } catch (e: any) {
        console.error("[people PUT] main transaction failed:", e);
        return NextResponse.json({
          error: `Save failed: ${e?.message ?? "Unknown DB error"}`,
        }, { status: 500 });
      }
    }

    // Patch the columns the typed client may not know about yet (workPhone /
    // personalEmail / maritalStatus). Same pattern used in /api/hr/profile.
    if (existing) {
      const setParts: string[] = [];
      const args: unknown[] = [];
      let i = 1;
      if (workPhone     !== undefined) { setParts.push(`"workPhone" = $${i++}`);     args.push(workPhone     || null); }
      if (personalEmail !== undefined) { setParts.push(`"personalEmail" = $${i++}`); args.push(personalEmail || null); }
      if (maritalStatus !== undefined) { setParts.push(`"maritalStatus" = $${i++}`); args.push(maritalStatus || null); }
      if (setParts.length > 0) {
        args.push(id);
        try {
          await prisma.$executeRawUnsafe(
            `UPDATE "EmployeeProfile" SET ${setParts.join(", ")} WHERE "userId" = $${i}`,
            ...args,
          );
        } catch (e) {
          console.warn("[people PUT] new-column raw update failed:", e);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[people PUT] outer catch:", e);
    return NextResponse.json({
      error: `Save failed: ${e?.message ?? "Unknown error"}`,
    }, { status: 500 });
  }
}
