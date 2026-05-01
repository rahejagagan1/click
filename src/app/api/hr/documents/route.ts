import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

// Mirrors src/lib/access.ts:isHRAdmin. Used to gate the privileged
// branches below — admins see / write any user's docs; non-admins see
// only their own and can't POST.
function isHRAdmin(u: any): boolean {
  return (
    u?.orgLevel === "ceo" ||
    u?.isDeveloper === true ||
    u?.orgLevel === "special_access" ||
    u?.role === "admin" ||
    u?.orgLevel === "hr_manager"
  );
}

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const self = session!.user as any;
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const { searchParams } = new URL(req.url);
    const admin = isHRAdmin(self);
    // Admins can list any user's docs (or all if no userId param);
    // non-admins are scoped to their own. Asking for someone else's
    // when not admin → 403 (not silent fallback to self) so UI bugs
    // surface instead of leaking your own docs into the wrong page.
    const requested = searchParams.get("userId");
    let userId: number;
    if (requested) {
      const n = parseInt(requested);
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: "Bad userId" }, { status: 400 });
      }
      if (!admin && n !== myId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      userId = n;
    } else {
      userId = myId;
    }

    const docs = await prisma.employeeDocument.findMany({
      where: admin && !requested ? {} : { userId },
      include: {
        user: { select: { id: true, name: true } },
        uploadedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(docs);
  } catch (e) { return serverError(e, "GET /api/hr/documents"); }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  // Creating documents is HR-admin-only. Previously any authenticated
  // user could POST and create a record against another employee's
  // userId — straight-up access bug.
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const myId = await resolveUserId(session);
    if (!myId) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const body = await req.json();
    if (body.expiryDate) body.expiryDate = new Date(body.expiryDate);
    const doc = await prisma.employeeDocument.create({
      data: { ...body, uploadedById: myId },
    });
    return NextResponse.json(doc);
  } catch (e) { return serverError(e, "POST /api/hr/documents"); }
}
