import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Small helper the onboarding wizard calls once on mount to populate every
 * dropdown in one round-trip: shifts, leave types, and potential managers.
 * Keeps the wizard component a single-file drop-in.
 */
export async function GET() {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const [shifts, leaveTypes, managers, existingProfiles, allUsers] = await Promise.all([
      prisma.shift.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, startTime: true, endTime: true },
      }),
      prisma.leaveType.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, code: true, daysPerYear: true },
      }),
      prisma.user.findMany({
        where: {
          isActive: true,
          orgLevel: { in: ["ceo", "hod", "manager", "hr_manager", "lead", "sub_lead"] },
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true, email: true, orgLevel: true },
      }),
      // Drives the Keka-import dedupe: the modal greys out any row
      // whose HRM ID already exists, so re-uploading the same export
      // never re-creates an existing employee.
      prisma.employeeProfile.findMany({
        select: { employeeId: true },
      }),
      // Full active-user list for the bulk-import second pass — once
      // every new row is created, we re-resolve manager-name → user-id
      // against this set so previously-unmatched managers get linked.
      prisma.user.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, email: true },
      }),
    ]);
    return NextResponse.json({
      shifts,
      leaveTypes,
      managers,
      existingEmployeeIds: existingProfiles.map((p) => p.employeeId).filter(Boolean),
      allUsers,
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/onboard/options");
  }
}
