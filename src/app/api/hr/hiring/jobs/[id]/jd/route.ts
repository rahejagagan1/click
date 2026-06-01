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
    const stamped = `${randomUUID()}-${safeBase}${ext}`;
    const dir = resolve(process.cwd(), "public", "uploads", "jds");
    await mkdir(dir, { recursive: true });
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(resolve(dir, stamped), buf);

    const url = `/uploads/jds/${stamped}`;
    await prisma.$executeRawUnsafe(
      `UPDATE "JobOpening" SET "jdFileUrl" = $1, "jdFileName" = $2, "updatedAt" = NOW() WHERE id = $3`,
      url, file.name, id,
    );

    return NextResponse.json({ ok: true, jdFileUrl: url, jdFileName: file.name });
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
