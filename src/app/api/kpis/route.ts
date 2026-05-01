// KPI listing — returns the KPI document(s) the caller is allowed to
// see. Scope is role-based:
//
//   • Admin tier (CEO / developer / special_access / role=admin /
//     role=hr_manager / orgLevel=hr_manager) → every department's doc.
//   • Everyone else → only their own department's doc (resolved from
//     EmployeeProfile.department).
//
// Each entry includes the doc URL (or null if the department has no
// doc uploaded yet) plus a small "members" preview so the listing
// page can show who the doc applies to.

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type Member = {
  id: number;
  name: string | null;
  profilePictureUrl: string | null;
  designation: string | null;
};
type DepartmentEntry = {
  department: string;
  fileName: string | null;
  fileUrl:  string | null;
  uploadedAt: string | null;
  members: Member[];
};

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const myId = await resolveUserId(session);
    const u = session!.user as any;
    const isTopTier =
      u?.orgLevel === "ceo" ||
      u?.isDeveloper === true ||
      u?.orgLevel === "special_access" ||
      u?.role === "admin" ||
      u?.orgLevel === "hr_manager" ||
      u?.role === "hr_manager";

    // Resolve the viewer's department once — used for the non-admin
    // single-department view.
    const profile = await prisma.$queryRawUnsafe<Array<{ department: string | null }>>(
      `SELECT department FROM "EmployeeProfile" WHERE "userId" = $1 LIMIT 1`,
      myId,
    );
    const myDepartment = profile[0]?.department || null;

    type DocRow = {
      department: string;
      fileName: string;
      fileUrl: string;
      uploadedAt: Date;
    };
    const docs = isTopTier
      ? await prisma.$queryRawUnsafe<DocRow[]>(
          `SELECT department, "fileName", "fileUrl", "uploadedAt"
             FROM "KpiDocument" ORDER BY department ASC`,
        )
      : myDepartment
        ? await prisma.$queryRawUnsafe<DocRow[]>(
            `SELECT department, "fileName", "fileUrl", "uploadedAt"
               FROM "KpiDocument" WHERE department = $1`,
            myDepartment,
          )
        : [];

    type MemberRow = Member & { department: string | null };
    const members = isTopTier
      ? await prisma.$queryRawUnsafe<MemberRow[]>(
          `SELECT u.id, u.name, u."profilePictureUrl",
                  ep.designation, ep.department
             FROM "User" u
             LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
            WHERE u."isActive" = true
            ORDER BY ep.department ASC NULLS LAST, u.name ASC`,
        )
      : myDepartment
        ? await prisma.$queryRawUnsafe<MemberRow[]>(
            `SELECT u.id, u.name, u."profilePictureUrl",
                    ep.designation, ep.department
               FROM "User" u
               LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
              WHERE u."isActive" = true AND ep.department = $1
              ORDER BY u.name ASC`,
            myDepartment,
          )
        : [];

    // Build per-department entries. For admin tier we include EVERY
    // department that has either a doc OR active employees so the page
    // can show "no doc uploaded" empty states. For everyone else we
    // emit a single entry for their own department.
    const deptKeys = new Set<string>();
    for (const d of docs)    if (d.department) deptKeys.add(d.department);
    for (const m of members) if (m.department) deptKeys.add(m.department);
    if (!isTopTier && myDepartment) deptKeys.add(myDepartment);

    const docByDept   = new Map(docs.map((d) => [d.department, d]));
    const membersByDept = new Map<string, Member[]>();
    for (const m of members) {
      if (!m.department) continue;
      if (!membersByDept.has(m.department)) membersByDept.set(m.department, []);
      membersByDept.get(m.department)!.push({
        id: m.id, name: m.name,
        profilePictureUrl: m.profilePictureUrl,
        designation: m.designation,
      });
    }

    const departments: DepartmentEntry[] = Array.from(deptKeys)
      .sort()
      .map((dept) => {
        const doc = docByDept.get(dept) || null;
        return {
          department: dept,
          fileName:   doc?.fileName  ?? null,
          fileUrl:    doc?.fileUrl   ?? null,
          uploadedAt: doc?.uploadedAt ? new Date(doc.uploadedAt).toISOString() : null,
          members:    membersByDept.get(dept) ?? [],
        };
      });

    return NextResponse.json({
      scope: isTopTier ? "all" : "self",
      myDepartment,
      departments,
    });
  } catch (e) {
    return serverError(e, "GET /api/kpis");
  }
}
