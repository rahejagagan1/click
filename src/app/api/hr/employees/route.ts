import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

// GET /api/hr/employees — list all employees with profiles
export async function GET(req: NextRequest) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const department = searchParams.get("department") || "";
    const employmentType = searchParams.get("employmentType") || "";
    const isActive = searchParams.get("isActive");

    const users = await prisma.user.findMany({
      where: {
        AND: [
          search ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          } : {},
          department ? { employeeProfile: { department: { contains: department, mode: "insensitive" } } } : {},
          employmentType ? { employeeProfile: { employmentType } } : {},
          isActive !== null && isActive !== undefined ? { isActive: isActive === "true" } : {},
        ],
      },
      include: {
        employeeProfile: true,
        manager: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(users);
  } catch (e) {
    return serverError(e, "GET /api/hr/employees");
  }
}

// POST /api/hr/employees — create/update employee profile
export async function POST(req: NextRequest) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const { userId, ...profileData } = body;

    if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

    if (!profileData.employeeId) {
      const year = new Date().getFullYear();
      const count = await prisma.employeeProfile.count();
      profileData.employeeId = `NB-${year}-${String(count + 1).padStart(3, "0")}`;
    }

    // Convert date strings
    if (profileData.joiningDate) profileData.joiningDate = new Date(profileData.joiningDate);
    if (profileData.dateOfBirth) profileData.dateOfBirth = new Date(profileData.dateOfBirth);

    const profile = await prisma.employeeProfile.upsert({
      where: { userId },
      create: { userId, ...profileData },
      update: profileData,
    });

    return NextResponse.json(profile);
  } catch (e) {
    return serverError(e, "POST /api/hr/employees");
  }
}
