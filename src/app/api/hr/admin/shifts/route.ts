import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, requireHRAdmin, serverError } from "@/lib/api-auth";
import { getBrandScope } from "@/lib/hr/brand-scope";

export const dynamic = "force-dynamic";

// Parse + validate the alternate-Saturday rule from a request body.
//   saturdayPolicy: "all" | "alternate" | "weeks"
//   saturdayWeeks:  ints 1-5 (only meaningful for "weeks")
function parseSaturday(body: any): { policy: string; weeks: number[] } {
  const policy = ["all", "alternate", "weeks"].includes(String(body?.saturdayPolicy))
    ? String(body.saturdayPolicy) : "all";
  const raw: number[] = Array.isArray(body?.saturdayWeeks)
    ? (body.saturdayWeeks as any[]).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5)
    : [];
  const weeks = Array.from(new Set(raw)).sort((a, b) => a - b);
  return { policy, weeks: policy === "weeks" ? weeks : [] };
}

// Postgres int[] literal from a validated (integer-only) array — injection-safe.
function weeksLiteral(weeks: number[]): string {
  return weeks.length ? `ARRAY[${weeks.join(",")}]::int[]` : `ARRAY[]::int[]`;
}

// The saturday* columns are read/written via raw SQL so this route keeps
// working even before `prisma generate` picks up the new columns.
async function setSaturday(shiftId: number, policy: string, weeks: number[]) {
  await prisma.$executeRawUnsafe(
    `UPDATE "Shift" SET "saturdayPolicy" = $1, "saturdayWeeks" = ${weeksLiteral(weeks)} WHERE id = $2`,
    policy, shiftId,
  );
}

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    // Brand-scope filter — NB Media HR Manager only sees NB Media
    // shifts (+ brand=NULL shifts that pre-date the brand column).
    // Developers + CROSS_BRAND_HR_USER_IDS see everything.
    const scope = getBrandScope(session!.user);
    let shifts: any;
    if (scope.allBrands) {
      shifts = await prisma.$queryRawUnsafe(
        `SELECT * FROM "Shift" ORDER BY name ASC`,
      );
    } else if (scope.brand) {
      shifts = await prisma.$queryRawUnsafe(
        `SELECT * FROM "Shift"
          WHERE brand = $1 OR brand IS NULL
          ORDER BY name ASC`,
        scope.brand,
      );
    } else {
      // No brand assigned to this user — return only the un-branded
      // legacy shifts (defensive — should rarely hit this path).
      shifts = await prisma.$queryRawUnsafe(
        `SELECT * FROM "Shift" WHERE brand IS NULL ORDER BY name ASC`,
      );
    }
    return NextResponse.json(shifts);
  } catch (e) { return serverError(e, "GET /api/hr/admin/shifts"); }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireHRAdmin();
  if (errorResponse) return errorResponse;
  try {
    const body = await req.json();
    // Frontend uses gracePeriodMinutes / workingDays; the Shift model
    // stores breakMinutes / workDays. Accept either alias.
    const { name, startTime, endTime } = body;
    const rawBreak = body.breakMinutes ?? body.gracePeriodMinutes ?? 60;
    const breakMinutes = Number.parseInt(String(rawBreak), 10);
    if (!Number.isFinite(breakMinutes)) {
      return NextResponse.json({ error: "breakMinutes must be an integer" }, { status: 400 });
    }
    const workDays = body.workDays ?? body.workingDays ?? ["Mon", "Tue", "Wed", "Thu", "Fri"];
    if (!name || !startTime || !endTime) return NextResponse.json({ error: "name, startTime, endTime required" }, { status: 400 });
    const { policy, weeks } = parseSaturday(body);

    // Brand auto-tag: client may pass body.brand explicitly (allowed
    // for super-admins). Otherwise default to the creator's brand —
    // an NB Media HR Manager creating a new shift implicitly stamps
    // it NB Media so it won't show up for YT Labs HR.
    const scope = getBrandScope(session!.user);
    const explicitBrand =
      body.brand === "NB Media" || body.brand === "YT Labs" ? body.brand : null;
    const brand = scope.allBrands ? (explicitBrand ?? null) : (scope.brand ?? null);

    const shift = await prisma.shift.create({
      data: { name, startTime, endTime, breakMinutes, workDays },
    });
    await setSaturday(shift.id, policy, weeks);
    if (brand) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Shift" SET brand = $1 WHERE id = $2`,
        brand, shift.id,
      );
    }
    return NextResponse.json({ ...shift, saturdayPolicy: policy, saturdayWeeks: weeks, brand }, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/admin/shifts"); }
}

export async function PUT(req: NextRequest) {
  const { errorResponse } = await requireHRAdmin();
  if (errorResponse) return errorResponse;
  try {
    const body = await req.json();
    const { id, name, startTime, endTime } = body;
    const shiftId = parseInt(id);
    const rawBreak = body.breakMinutes ?? body.gracePeriodMinutes;
    // PUT is a partial update — only coerce + send breakMinutes when the
    // caller actually supplied it. An undefined Prisma field is a no-op.
    let breakMinutes: number | undefined = undefined;
    if (rawBreak !== undefined && rawBreak !== null && rawBreak !== "") {
      const parsed = Number.parseInt(String(rawBreak), 10);
      if (!Number.isFinite(parsed)) {
        return NextResponse.json({ error: "breakMinutes must be an integer" }, { status: 400 });
      }
      breakMinutes = parsed;
    }
    const workDays = body.workDays ?? body.workingDays;
    const shift = await prisma.shift.update({
      where: { id: shiftId },
      data: { name, startTime, endTime, breakMinutes, workDays },
    });
    // Update the Saturday rule whenever it was supplied (the form always sends it).
    if (body.saturdayPolicy !== undefined || body.saturdayWeeks !== undefined) {
      const { policy, weeks } = parseSaturday(body);
      await setSaturday(shiftId, policy, weeks);
      return NextResponse.json({ ...shift, saturdayPolicy: policy, saturdayWeeks: weeks });
    }
    return NextResponse.json(shift);
  } catch (e) { return serverError(e, "PUT /api/hr/admin/shifts"); }
}
