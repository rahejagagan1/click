// HR JD-attachment endpoints.
//
//   POST   /api/hr/hiring/jobs/[id]/jd   — multipart/form-data { file }
//                                          stores under /public/uploads/jds
//                                          updates jdFileUrl + jdFileName
//   DELETE /api/hr/hiring/jobs/[id]/jd   — clears the attachment (file stays
//                                          on disk; cheap and avoids race
//                                          conditions during edits)
//
// HR-admin only. 5 MB cap, PDF / DOC / DOCX / TXT only.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { renderJdPdfFromText } from "@/lib/jd-doc-from-text";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTS = new Set([".pdf", ".doc", ".docx", ".txt", ".rtf"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Bad id" }, { status: 400 });
    }

    const form = await req.formData();
    const file = form.get("file");
    // jdText: optional edited plain-text version of the JD. When
    // present, HR used the wizard's preview-and-edit UI to tweak
    // the extracted text. We persist alongside the file so the
    // original blob is still downloadable.
    const jdTextRaw = form.get("jdText");
    const jdText = typeof jdTextRaw === "string" ? jdTextRaw.slice(0, 100_000) : null;

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File must be 5 MB or smaller" }, { status: 400 });
    }
    const ext = extname(file.name).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      return NextResponse.json({ error: "File must be a PDF, DOC, DOCX, RTF, or TXT" }, { status: 400 });
    }

    const safeBase = (file.name || "jd").replace(/\.[^.]+$/, "")
      .replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60) || "jd";
    const dir = resolve(process.cwd(), "public", "uploads", "jds");
    await mkdir(dir, { recursive: true });

    // ── Output file selection ───────────────────────────────────
    // When HR included an edited plain-text version of the JD
    // (`jdText` form field — populated by the wizard's inline editor),
    // re-render that text as a fresh PDF and save THAT as the JD on
    // disk. The careers page then serves the cleaned-up version, not
    // the raw upload. When jdText is empty/absent we just save the
    // upload as-is (legacy path / direct file replace).
    let outBytes: Buffer;
    let outExt:   string;
    let outDisplayName: string;
    if (jdText && jdText.trim()) {
      try {
        // Look up the title so the rendered PDF has a proper heading.
        const j = await prisma.$queryRawUnsafe<any[]>(
          `SELECT title FROM "JobOpening" WHERE id = $1`, id,
        );
        const title = j[0]?.title ?? "Job Description";
        outBytes = await renderJdPdfFromText({ title, text: jdText });
        outExt = ".pdf";
        outDisplayName = `${title.replace(/[\r\n"\/\\]/g, "").slice(0, 80)} — JD.pdf`;
      } catch (e: any) {
        console.error("[jd-upload] text→PDF render failed, falling back to original upload:", e?.message ?? e);
        outBytes = Buffer.from(await file.arrayBuffer());
        outExt = ext;
        outDisplayName = file.name;
      }
    } else {
      outBytes = Buffer.from(await file.arrayBuffer());
      outExt = ext;
      outDisplayName = file.name;
    }

    const stamped = `${randomUUID()}-${safeBase}${outExt}`;
    await writeFile(resolve(dir, stamped), outBytes);

    const url = `/uploads/jds/${stamped}`;
    await prisma.$executeRawUnsafe(
      `UPDATE "JobOpening"
          SET "jdFileUrl" = $1, "jdFileName" = $2,
              "jdText"    = COALESCE($3, "jdText"),
              "updatedAt" = NOW()
        WHERE id = $4`,
      url, outDisplayName, jdText, id,
    );

    return NextResponse.json({ ok: true, jdFileUrl: url, jdFileName: outDisplayName });
  } catch (e) {
    return serverError(e, "POST /api/hr/hiring/jobs/[id]/jd");
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Bad id" }, { status: 400 });
    }
    await prisma.$executeRawUnsafe(
      `UPDATE "JobOpening" SET "jdFileUrl" = NULL, "jdFileName" = NULL, "updatedAt" = NOW() WHERE id = $1`,
      id,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "DELETE /api/hr/hiring/jobs/[id]/jd");
  }
}
