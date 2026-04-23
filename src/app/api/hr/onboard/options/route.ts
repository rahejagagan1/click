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
    const [shifts, leaveTypes, managers] = await Promise.all([
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
    ]);
    return NextResponse.json({ shifts, leaveTypes, managers });
  } catch (e) {
    return serverError(e, "GET /api/hr/onboard/options");
  }
}
