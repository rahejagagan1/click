import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, requireHRAdmin, serverError } from "@/lib/api-auth";
import { serializeBigInt } from "@/lib/utils";

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

    return NextResponse.json(serializeBigInt(users));
  } catch (e) {
    return serverError(e, "GET /api/hr/employees");
  }
}

// POST /api/hr/employees — create an employee via the Add Employee wizard (Page 1).
// Creates the User row if missing, allocates an employeeId from the chosen number
// series atomically, and writes the EmployeeProfile. Requires HR admin.
export async function POST(req: NextRequest) {
  const { errorResponse } = await requireHRAdmin();
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const {
      workCountry,
      firstName,
      middleName,
      lastName,
      displayName,
      gender,
      dateOfBirth,
      nationality,
      numberSeriesId,
      workEmail,
      mobileNumber,
    } = body || {};

    const required: Record<string, unknown> = {
      workCountry, firstName, lastName, displayName, gender, dateOfBirth,
      nationality, numberSeriesId, workEmail, mobileNumber,
    };
    const missing = Object.entries(required).filter(([, v]) => v === undefined || v === null || v === "").map(([k]) => k);
    if (missing.length > 0) {
      return NextResponse.json({ error: `Missing required fields: ${missing.join(", ")}` }, { status: 400 });
    }

    const email = String(workEmail).trim().toLowerCase();
    const dob = new Date(dateOfBirth);
    if (isNaN(dob.getTime())) {
      return NextResponse.json({ error: "Invalid dateOfBirth" }, { status: 400 });
    }

    // Reject up front if this email already has an employee profile.
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, employeeProfile: { select: { id: true, employeeId: true } } },
    });
    if (existing?.employeeProfile) {
      return NextResponse.json(
        { error: `An employee already exists for ${email} (ID ${existing.employeeProfile.employeeId})` },
        { status: 409 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // Atomic allocate: UPDATE ... SET nextNumber = nextNumber + 1 RETURNING ...
      // The row lock held during UPDATE serializes concurrent callers, so each
      // transaction gets a unique post-increment value.
      const bumped = await tx.employeeNumberSeries.update({
        where: { id: Number(numberSeriesId) },
        data: { nextNumber: { increment: 1 } },
        select: { id: true, prefix: true, nextNumber: true, isActive: true },
      });
      if (!bumped.isActive) {
        throw new Error("Selected number series is inactive");
      }
      const claimed = bumped.nextNumber - 1;
      const employeeId = `${bumped.prefix}${claimed}`;

      // Find or create the User — HR-first identity; clickupUserId stays null and
      // is backfilled by the ClickUp sync on email match.
      const user = await tx.user.upsert({
        where: { email },
        create: {
          email,
          name: String(displayName).trim(),
          role: "member",
          orgLevel: "member",
        },
        update: { name: String(displayName).trim() },
      });

      const profile = await tx.employeeProfile.create({
        data: {
          userId: user.id,
          employeeId,
          firstName: String(firstName).trim(),
          middleName: middleName ? String(middleName).trim() : null,
          lastName: String(lastName).trim(),
          workCountry: String(workCountry).trim(),
          nationality: String(nationality).trim(),
          numberSeriesId: bumped.id,
          gender: String(gender),
          dateOfBirth: dob,
          phone: String(mobileNumber).trim(),
        },
      });

      return { user, profile };
    });

    return NextResponse.json(serializeBigInt(result));
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json(
        { error: "Duplicate email or employee ID — please try again" },
        { status: 409 },
      );
    }
    if (e?.code === "P2025") {
      return NextResponse.json({ error: "Number series not found" }, { status: 400 });
    }
    return serverError(e, "POST /api/hr/employees");
  }
}
