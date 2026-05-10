// KPI listing — returns the KPI document(s) the caller is allowed to
// see. Scope is role-based:
//
//   • Admin tier (CEO / developer / special_access / role=admin /
//     role=hr_manager / orgLevel=hr_manager) → every department's doc.
//   • Everyone else → only their own bucket (resolved from the
//     viewer's role/orgLevel + EmployeeProfile.department — see
//     bucketFor() below).
//
// Each entry includes the doc URL (or null if the bucket has no doc
// uploaded yet) plus a small "members" preview so the listing page
// can show who the doc applies to.

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { DEPARTMENTS } from "@/lib/departments";

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

// Specific manager-named cards win over the generic "Managers"
// catch-all so a Research Manager lands under "Research Manager".
function bucketForManager(role: string | null): string {
  if (role === "researcher_manager" || role === "research_manager") return "Research Manager";
  if (role === "qa_manager") return "QA Manager";
  if (role === "social_media_manager") return "Social Media Manager";
  return "Managers";
}

// Anyone with a manager-flavoured org level/role goes to a manager
// bucket regardless of their stored EmployeeProfile.department —
// otherwise the "Managers" card shows 0 members because nobody has
// `department = "Managers"` (department is a domain, not a role).
//
// HR-tier users (orgLevel/role = "hr_manager") are an exception:
// they belong to the HR card, not the generic Managers card, since
// HR has its own KPI doc and their domain IS HR.
function bucketFor(m: { orgLevel: string | null; role: string | null; department: string | null }): string | null {
  if (m.orgLevel === "hr_manager" || m.role === "hr_manager") return "HR";
  const isManager =
    m.orgLevel === "manager" ||
    (m.role || "").endsWith("_manager");
  if (isManager) return bucketForManager(m.role);
  return m.department;
}

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

    // Resolve the viewer's department + role/orgLevel — used to pick
    // the right KPI bucket for non-admin viewers.
    const viewerInfo = await prisma.$queryRawUnsafe<Array<{
      department: string | null;
      orgLevel:   string | null;
      role:       string | null;
    }>>(
      `SELECT ep.department, u."orgLevel", u."role"
         FROM "User" u
         LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
        WHERE u.id = $1 LIMIT 1`,
      myId,
    );
    const myDepartment = viewerInfo[0]?.department || null;
    const myOrgLevel   = viewerInfo[0]?.orgLevel   || null;
    const myRole       = viewerInfo[0]?.role       || null;
    const viewerBucket = bucketFor({
      orgLevel: myOrgLevel, role: myRole, department: myDepartment,
    });

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
      : viewerBucket
        ? await prisma.$queryRawUnsafe<DocRow[]>(
            `SELECT department, "fileName", "fileUrl", "uploadedAt"
               FROM "KpiDocument" WHERE department = $1`,
            viewerBucket,
          )
        : [];

    type MemberRow = Member & {
      department: string | null;
      orgLevel:   string | null;
      role:       string | null;
    };
    // Exclude CEO-tier users from the KPI listing — they don't have a
    // KPI document tracked against them, so without this filter their
    // department string ("CEO & FOUNDER") rendered as a one-member
    // empty card. Other tiers (special_access / hr_manager / etc.)
    // are still included so HR's own KPIs show up.
    //
    // Non-admin viewers fetch the same row set; we filter to their
    // bucket in JS below. Cheap given the company-sized dataset and
    // keeps bucket logic in one place.
    const members = await prisma.$queryRawUnsafe<MemberRow[]>(
      `SELECT u.id, u.name, u."profilePictureUrl",
              u."orgLevel", u."role",
              ep.designation, ep.department
         FROM "User" u
         LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
        WHERE u."isActive" = true AND u."orgLevel" <> 'ceo'
        ORDER BY ep.department ASC NULLS LAST, u.name ASC`,
    );

    // Pre-compute each member's bucket once.
    const memberBucket = new Map<number, string | null>();
    for (const m of members) memberBucket.set(m.id, bucketFor(m));

    const visibleMembers = isTopTier
      ? members
      : viewerBucket
        ? members.filter((m) => memberBucket.get(m.id) === viewerBucket)
        : [];

    // Build per-bucket entries.
    // Admin tier sees every CANONICAL department (always — even with
    //   0 members and no doc) so the listing matches the upload form
    //   in /dashboard/kpis/manage. Any legacy stored department label
    //   that still has live members tagged to it (an orphan-with-
    //   people) is appended so HR can spot rows that need re-classifying.
    //   Orphan docs WITHOUT members (e.g. a doc lingering after a team
    //   was retired) are intentionally NOT surfaced — re-upload to a
    //   canonical name to bring them back.
    // Everyone else sees only their own bucket.
    const deptKeys = new Set<string>();
    if (isTopTier) {
      for (const d of DEPARTMENTS) deptKeys.add(d);
      for (const m of visibleMembers) {
        const b = memberBucket.get(m.id);
        if (b) deptKeys.add(b);
      }
    } else if (viewerBucket) {
      deptKeys.add(viewerBucket);
    }

    const docByDept     = new Map(docs.map((d) => [d.department, d]));
    const membersByDept = new Map<string, Member[]>();
    for (const m of visibleMembers) {
      const b = memberBucket.get(m.id);
      if (!b) continue;
      if (!membersByDept.has(b)) membersByDept.set(b, []);
      membersByDept.get(b)!.push({
        id: m.id, name: m.name,
        profilePictureUrl: m.profilePictureUrl,
        designation: m.designation,
      });
    }

    // Sort: canonical order first (matches the upload-form dropdown),
    // then any non-canonical legacy departments alphabetically.
    const canonicalIndex = new Map(DEPARTMENTS.map((d, i) => [d, i]));
    const sortedKeys = Array.from(deptKeys).sort((a, b) => {
      const ai = canonicalIndex.get(a);
      const bi = canonicalIndex.get(b);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;   // canonical wins
      if (bi !== undefined) return 1;
      return a.localeCompare(b);
    });

    const departments: DepartmentEntry[] = sortedKeys.map((dept) => {
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
      myDepartment: viewerBucket,
      departments,
    });
  } catch (e) {
    return serverError(e, "GET /api/kpis");
  }
}
