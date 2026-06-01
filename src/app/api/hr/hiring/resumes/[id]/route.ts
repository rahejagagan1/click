// Serve a candidate's resume from the DB.
//
// GET /api/hr/hiring/resumes/[id]
//   Streams JobApplication.resumeBlob with safe headers. HR-admin only.
//
// Replaces the legacy /uploads/resumes/<file>.pdf static URLs, which
// were lost whenever a deployment wiped public/uploads. Files stored
// here can never go missing — they live in the DB row alongside the
// candidate.
//
// Security: MIME is allowlisted (PDF / DOC / DOCX) — anything else
// (e.g. a malicious text/html upload) is served as octet-stream with
// Content-Disposition: attachment + nosniff, so it can never render
// as a script-executing same-origin document on the dashboard origin.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

// MIMEs we trust enough to serve inline (so the candidate drawer's
// iframe can preview them). Anything else gets forced to attachment +
// octet-stream so it can never render as a script-executing document
// on the dashboard origin.
const INLINE_MIMES = new Set([
  "application/pdf",
]);
const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/rtf",
  "text/plain",
]);

// HEAD probe — used by the CandidateDrawer to check resume availability
// before rendering the iframe. Skips the blob fetch (which can be 5 MB)
// so the probe is cheap. Same auth gate as GET.
export async function HEAD(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) return new NextResponse(null, { status: 403 });
  try {
    const { id: idParam } = await params;
    const id = /^\d+$/.test(idParam) ? parseInt(idParam, 10) : NaN;
    if (!Number.isInteger(id)) return new NextResponse(null, { status: 400 });
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "resumeMime", ("resumeBlob" IS NOT NULL) AS "hasBlob"
         FROM "JobApplication" WHERE "id" = $1 LIMIT 1`,
      id,
    );
    const row = rows[0];
    if (!row?.hasBlob) return new NextResponse(null, { status: 404 });
    const stored = String(row.resumeMime ?? "").toLowerCase();
    const ct = ALLOWED_MIMES.has(stored) ? stored : "application/octet-stream";
    return new NextResponse(null, {
      headers: { "Content-Type": ct, "Cache-Control": "private, no-store" },
    });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id: idParam } = await params;
    const id = /^\d+$/.test(idParam) ? parseInt(idParam, 10) : NaN;
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "Bad id" }, { status: 400 });
    }

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "resumeBlob", "resumeMime", "resumeFileName"
         FROM "JobApplication"
        WHERE "id" = $1
        LIMIT 1`,
      id,
    );
    const row = rows[0];
    if (!row || !row.resumeBlob) {
      return NextResponse.json({ error: "Resume not stored for this candidate" }, { status: 404 });
    }

    const stored      = String(row.resumeMime ?? "").toLowerCase();
    const allowed     = ALLOWED_MIMES.has(stored);
    const inline      = allowed && INLINE_MIMES.has(stored);
    const contentType = allowed ? stored : "application/octet-stream";
    // Strip CRLF + quotes from the filename so it can't break headers.
    const safeName = (row.resumeFileName ?? "resume")
      .replace(/[\r\n"]/g, "")
      .slice(0, 200);

    return new NextResponse(row.resumeBlob, {
      headers: {
        "Content-Type":           contentType,
        "Content-Disposition":    `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
        "Cache-Control":          "private, no-store",
        "X-Content-Type-Options": "nosniff",
        // Even when inline, sandbox prevents the document from
        // executing scripts that touch the dashboard origin.
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/hiring/resumes/[id]");
  }
}
