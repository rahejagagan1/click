import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

// POST /api/onboarding/complete
// Finishes the first-login wizard for the signed-in user:
//   1. Patches a few self-service profile fields.
//   2. Clears the onboardingPending flag so future logins land on the
//      dashboard instead of bouncing back here.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({} as any));
  const phone           = typeof body?.phone === "string"           ? body.phone.trim()           : null;
  const address         = typeof body?.address === "string"         ? body.address.trim()         : null;
  const city            = typeof body?.city === "string"            ? body.city.trim()            : null;
  const state           = typeof body?.state === "string"           ? body.state.trim()           : null;
  const emergencyContact = typeof body?.emergencyContact === "string" ? body.emergencyContact.trim() : null;
  const emergencyPhone  = typeof body?.emergencyPhone === "string"  ? body.emergencyPhone.trim()  : null;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Patch the EmployeeProfile if one exists; otherwise skip silently — the
  // flag flip alone unblocks them and HR can fill the profile in later.
  try {
    await prisma.employeeProfile.update({
      where: { userId: user.id },
      data: {
        ...(phone            ? { phone }            : {}),
        ...(address          ? { address }          : {}),
        ...(city             ? { city }             : {}),
        ...(state            ? { state }            : {}),
        ...(emergencyContact ? { emergencyContact } : {}),
        ...(emergencyPhone   ? { emergencyPhone }   : {}),
      },
    });
  } catch { /* no profile row — ignore */ }

  // Raw SQL: the typed client may be stale on the column.
  await prisma.$executeRawUnsafe(
    `UPDATE "User" SET "onboardingPending" = false WHERE id = $1`,
    user.id,
  );

  return NextResponse.json({ ok: true });
}
