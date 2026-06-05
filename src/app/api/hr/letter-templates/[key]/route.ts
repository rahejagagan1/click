// GET   /api/hr/letter-templates/:key — fetch one template
// PATCH /api/hr/letter-templates/:key — update body / customFields

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, isLeadershipOrHR, resolveUserId, serverError } from "@/lib/api-auth";
import { sanitizeLetterHtml } from "@/lib/hr/letter-render";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isLeadershipOrHR(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { key } = await params;
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, key, title, category, "bodyHtml", "customFields", "isActive", "updatedAt"
         FROM "LetterTemplate" WHERE key = $1 LIMIT 1`,
      key,
    );
    if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch (e) {
    return serverError(e, "GET /api/hr/letter-templates/[key]");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isLeadershipOrHR(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { key } = await params;
    const body = await req.json().catch(() => ({}));
    const sets: string[] = [];
    const args: any[] = [];
    let i = 1;
    if (typeof body.bodyHtml === "string") {
      if (body.bodyHtml.length > 200_000) {
        return NextResponse.json({ error: "Body too large (200 KB max)" }, { status: 413 });
      }
      // Strip <script> / iframe / on... handlers / javascript: URLs
      // server-side so a compromised HR account can't persist an
      // XSS payload in the template body.
      const clean = sanitizeLetterHtml(body.bodyHtml);
      sets.push(`"bodyHtml" = $${i++}`); args.push(clean);
    }
    if (typeof body.title === "string" && body.title.trim()) {
      sets.push(`"title" = $${i++}`); args.push(body.title.trim());
    }
    if (Array.isArray(body.customFields)) {
      sets.push(`"customFields" = $${i++}::jsonb`); args.push(JSON.stringify(body.customFields));
    }
    if (body.isActive !== undefined) {
      sets.push(`"isActive" = $${i++}`); args.push(!!body.isActive);
    }
    if (sets.length === 0) return NextResponse.json({ ok: true });
    const editorId = await resolveUserId(session);
    if (editorId) { sets.push(`"updatedById" = $${i++}`); args.push(editorId); }
    sets.push(`"updatedAt" = NOW()`);
    args.push(key);
    await prisma.$executeRawUnsafe(
      `UPDATE "LetterTemplate" SET ${sets.join(", ")} WHERE key = $${i}`,
      ...args,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e, "PATCH /api/hr/letter-templates/[key]");
  }
}
