// HR Hiring — list candidates, optionally scoped to a job opening.
//
// GET /api/hr/hiring/candidates?openingId=N
//   → returns candidates for that job, hydrated with current stage +
//     basic counts (resume, interviews, offers). Used by the kanban.
//
// GET /api/hr/hiring/candidates
//   → returns all candidates across all jobs (Candidates tab).
//
// Each row includes:
//   { id, fullName, email, phone, experienceYears, currentCompany,
//     resumeUrl, source, overallRating, currentStage: { id, key,
//     label, kind, color }, enteredStageAt, jobOpeningId, roleTitle }

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { gravatarUrl } from "@/lib/gravatar";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  // HR-admin gate — candidate rows include phone, email, salary
  // expectations and resume URLs. Non-HR employees have no business
  // seeing this. Mirrors the gate on POST/PATCH.
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const openingIdRaw = searchParams.get("openingId");
    const openingId = openingIdRaw && /^\d+$/.test(openingIdRaw) ? parseInt(openingIdRaw, 10) : null;

    // Raw SQL so the new currentStageId column doesn't trip the typed
    // client when prisma generate hasn't been re-run. Two-step query
    // with a fallback for the pre-migration dev DB: if currentStageId
    // / HiringStage don't exist yet, fall back to the legacy schema
    // (no stage join) so the page still renders.
    let rows: any[] = [];
    try {
      rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT
           a."id", a."fullName", a."email", a."phone", a."experienceYears",
           a."currentCompany", a."noticePeriod", a."resumeUrl", a."resumeFileName",
           a."source", a."overallRating", a."status",
           a."currentStageId", a."enteredStageAt", a."createdAt", a."updatedAt",
           a."jobOpeningId",
           a."archivedAt", a."archiveReason",
           o."title" AS "roleTitle",
           s."id"   AS "s_id",
           s."key"  AS "s_key",
           s."label" AS "s_label",
           s."kind"  AS "s_kind",
           s."color" AS "s_color"
         FROM "JobApplication" a
         LEFT JOIN "JobOpening" o ON o."id" = a."jobOpeningId"
         LEFT JOIN "HiringStage" s ON s."id" = a."currentStageId"
         ${openingId ? `WHERE a."jobOpeningId" = $1` : ""}
         ORDER BY a."createdAt" DESC`,
        ...(openingId ? [openingId] : []),
      );
    } catch (e: any) {
      const code = e?.meta?.code || e?.code;
      const msg = String(e?.meta?.message || e?.message || "");
      if (code === "42703" || code === "42P01" || /does not exist/i.test(msg)) {
        // Pre-migration fallback — read legacy columns only.
        rows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT
             a."id", a."fullName", a."email", a."phone", a."experienceYears",
             a."currentCompany", a."noticePeriod", a."resumeUrl", a."resumeFileName",
             a."source", a."overallRating", a."status",
             NULL AS "currentStageId", NULL AS "enteredStageAt",
             a."createdAt", a."updatedAt", a."jobOpeningId",
             NULL::timestamp AS "archivedAt", NULL::text AS "archiveReason",
             o."title" AS "roleTitle",
             NULL AS "s_id", NULL AS "s_key", NULL AS "s_label",
             NULL AS "s_kind", NULL AS "s_color"
           FROM "JobApplication" a
           LEFT JOIN "JobOpening" o ON o."id" = a."jobOpeningId"
           ${openingId ? `WHERE a."jobOpeningId" = $1` : ""}
           ORDER BY a."createdAt" DESC`,
          ...(openingId ? [openingId] : []),
        );
      } else {
        throw e;
      }
    }

    // Hydrate tags in a second pass — kept separate so a DB without
    // the JobApplication."tags" column (pre-migration) doesn't break
    // the main list. Soft-fail to an empty map on 42703.
    const tagsById = new Map<number, string[]>();
    if (rows.length > 0) {
      try {
        const tagRows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT "id", "tags" FROM "JobApplication" WHERE "id" = ANY($1::int[])`,
          rows.map((r) => r.id),
        );
        for (const t of tagRows) tagsById.set(Number(t.id), Array.isArray(t.tags) ? t.tags : []);
      } catch { /* column missing — leave map empty */ }
    }

    // Same pattern for recruiterOwnerId — soft-fails if the column
    // isn't migrated yet, leaving every candidate ownerless.
    const ownerById = new Map<number, { id: number | null; name: string | null }>();
    if (rows.length > 0) {
      try {
        const ownerRows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT a."id", a."recruiterOwnerId", u."name" AS "ownerName"
             FROM "JobApplication" a
             LEFT JOIN "User" u ON u."id" = a."recruiterOwnerId"
            WHERE a."id" = ANY($1::int[])`,
          rows.map((r) => r.id),
        );
        for (const o of ownerRows) {
          ownerById.set(Number(o.id), {
            id: o.recruiterOwnerId == null ? null : Number(o.recruiterOwnerId),
            name: o.ownerName ?? null,
          });
        }
      } catch { /* column missing — leave map empty */ }
    }

    const candidates = rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      // Resolves to a Gravatar URL when the candidate's email has
      // one set; null otherwise. The UI does an <img onError> fall-
      // back to initials so a 404 from Gravatar isn't a problem.
      photoUrl: gravatarUrl(r.email, 160),
      phone: r.phone,
      experienceYears: r.experienceYears,
      currentCompany: r.currentCompany,
      noticePeriod: r.noticePeriod,
      resumeUrl: r.resumeUrl,
      resumeFileName: r.resumeFileName,
      source: r.source,
      overallRating: r.overallRating,
      legacyStatus: r.status,
      currentStage: r.s_id
        ? { id: r.s_id, key: r.s_key, label: r.s_label, kind: r.s_kind, color: r.s_color }
        : null,
      enteredStageAt: r.enteredStageAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      jobOpeningId: r.jobOpeningId,
      roleTitle: r.roleTitle,
      // Archived state — set when HR moved them to a rejected/closed
      // stage with a reason. Drives the "Archived" badge in the list
      // view so HR can see at a glance who's out of the pipeline.
      archivedAt:    r.archivedAt ?? null,
      archiveReason: r.archiveReason ?? null,
      tags: tagsById.get(Number(r.id)) ?? [],
      recruiterOwnerId: ownerById.get(Number(r.id))?.id ?? null,
      ownerName:        ownerById.get(Number(r.id))?.name ?? null,
    }));

    return NextResponse.json({ candidates });
  } catch (e) {
    return serverError(e, "GET /api/hr/hiring/candidates");
  }
}
