// KPI document management — upload, list, and delete the per-department
// KPI files. Admin-only: only `isFullHRAdmin` (HR Manager + admin tier)
// can write. One document per department; re-uploading replaces the
// existing file in place.
//
// Files land in /public/uploads/kpis/<random>-<safe-name> so they're
// served via Next's static asset handler.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024;       // 10 MB
const ALLOWED_EXTS   = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx"]);

type DocRow = {
  id: number;
  department: string;
  fileName: string;
  fileUrl: string;
  uploadedAt: Date;
  uploadedBy: number | null;
};

function isAdmin(u: any): boolean {
  return (
    u?.orgLevel === "ceo" ||
    u?.isDeveloper === true ||
    u?.orgLevel === "special_access" ||
    u?.role === "admin" ||
    u?.role === "hr_manager"
  );
}

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const docs = await prisma.$queryRawUnsafe<DocRow[]>(
      `SELECT id, department, "fileName", "fileUrl", "uploadedAt", "uploadedBy"
         FROM "KpiDocument"
        ORDER BY department ASC`,
    );
    return NextResponse.json({ docs });
  } catch (e) {
    return serverError(e, "GET /api/kpis/documents");
  }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const form = await req.formData();
    const department = (form.get("department") as string | null)?.trim();
    const file       = form.get("file");

    if (!department) {
      return NextResponse.json({ error: "Department is required" }, { status: 400 });
    }
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Please attach a file" }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File must be 10 MB or smaller" }, { status: 400 });
    }
    const ext = extname(file.name).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      return NextResponse.json({ error: "File must be a PDF, Word, or Excel document" }, { status: 400 });
    }

    const safeBase = file.name
      .replace(/\.[^.]+$/, "")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .slice(0, 60) || "kpi";
    const stamped  = `${randomUUID()}-${safeBase}${ext}`;
    const dir      = resolve(process.cwd(), "public", "uploads", "kpis");
    await mkdir(dir, { recursive: true });
    const buf      = Buffer.from(await file.arrayBuffer());
    await writeFile(resolve(dir, stamped), buf);
    const fileUrl  = `/uploads/kpis/${stamped}`;

    const uploadedBy = await resolveUserId(session);
    // Upsert on department — re-upload replaces the existing pointer
    // so each department keeps only ONE active doc.
    const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
      `INSERT INTO "KpiDocument" ("department","fileName","fileUrl","uploadedAt","uploadedBy")
       VALUES ($1,$2,$3,NOW(),$4)
       ON CONFLICT ("department")
       DO UPDATE SET
         "fileName"   = EXCLUDED."fileName",
         "fileUrl"    = EXCLUDED."fileUrl",
         "uploadedAt" = NOW(),
         "uploadedBy" = EXCLUDED."uploadedBy"
       RETURNING id`,
      department, file.name, fileUrl, uploadedBy,
    );

    return NextResponse.json({ ok: true, id: rows[0]?.id, fileUrl });
  } catch (e) {
    return serverError(e, "POST /api/kpis/documents");
  }
}

export async function DELETE(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const idRaw = searchParams.get("id");
    const id = idRaw && /^\d+$/.test(idRaw) ? parseInt(idRaw, 10) : NaN;
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Bad id" }, { status: 400 });
    }
    await prisma.$executeRawUnsafe(`DELETE FROM "KpiDocument" WHERE id = $1`, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "DELETE /api/kpis/documents");
  }
}
