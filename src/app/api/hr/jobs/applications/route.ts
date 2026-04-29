// HR-side list of all candidate submissions. Joins to JobOpening so the
// table shows the role title alongside each row.

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

function canViewHiring(session: any): boolean {
  const u = session?.user;
  return !!u && (u.orgLevel === "ceo" || u.orgLevel === "hr_manager" || u.role === "admin" || u.isDeveloper === true);
}

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewHiring(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        id: number; status: string; fullName: string; email: string; phone: string | null;
        coverLetter: string | null; linkedinUrl: string | null; portfolioUrl: string | null;
        experienceYears: number | null; currentCompany: string | null; noticePeriod: string | null;
        resumeFileName: string | null; resumeUrl: string | null; hrNotes: string | null;
        createdAt: Date; jobOpeningId: number; roleTitle: string;
      }>
    >(
      `SELECT a.id, a.status, a."fullName", a.email, a.phone, a."coverLetter",
              a."linkedinUrl", a."portfolioUrl", a."experienceYears",
              a."currentCompany", a."noticePeriod", a."resumeFileName",
              a."resumeUrl", a."hrNotes", a."createdAt",
              a."jobOpeningId", o.title AS "roleTitle"
         FROM "JobApplication" a
         JOIN "JobOpening"     o ON o.id = a."jobOpeningId"
        ORDER BY a."createdAt" DESC`,
    );
    return NextResponse.json(rows);
  } catch (e: any) {
    console.error("[GET /api/hr/jobs/applications] failed:", e);
    return NextResponse.json({ error: "Could not load applications" }, { status: 500 });
  }
}
