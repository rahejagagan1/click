// GET  /api/hr/letter-templates       — list all (HR-team / dev / CEO)
// POST /api/hr/letter-templates/seed  — idempotent re-seed (HR-team / dev / CEO)
//
// The Templates page reads this to render the catalog; the editor
// page pulls individual templates via [key]/route.ts below.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, isLeadershipOrHR, serverError } from "@/lib/api-auth";
import { LETTER_TEMPLATE_SEEDS } from "@/lib/hr/letter-template-seeds";
import { sanitizeLetterHtml } from "@/lib/hr/letter-render";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isLeadershipOrHR(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    // Raw SQL — the Prisma client may be stale on VPS until the
    // first build picks up the LetterTemplate model. We return the
    // same shape the typed client would.
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, key, title, category, "businessUnit", "customFields", "isActive", "updatedAt"
         FROM "LetterTemplate"
        WHERE "isActive" = true
        ORDER BY category ASC, title ASC, "businessUnit" NULLS FIRST`,
    );
    return NextResponse.json(rows);
  } catch (e) {
    return serverError(e, "GET /api/hr/letter-templates");
  }
}

// Idempotent seed — inserts the canonical 4 templates if they're
// missing. Existing rows are left alone so HR's edits aren't
// clobbered on subsequent calls. Useful to bootstrap a fresh DB and
// to backfill new template keys when we ship them.
export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isLeadershipOrHR(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    // Seed installs the default 4 templates as NB Media — they're
    // authored against the NB Media letterhead + signature. YT Labs
    // variants are uploaded separately by HR once the source DOCX
    // files are ready (the picker falls back to the NULL-tagged or
    // brand-matched row at generate time).
    let inserted = 0;
    let skipped  = 0;
    for (const t of LETTER_TEMPLATE_SEEDS) {
      const existing = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM "LetterTemplate" WHERE key = $1 AND "businessUnit" = 'NB Media' LIMIT 1`,
        t.key,
      );
      if (existing[0]) { skipped++; continue; }
      await prisma.$executeRawUnsafe(
        `INSERT INTO "LetterTemplate"
           (key, title, category, "businessUnit", "bodyHtml", "customFields", "isActive", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'NB Media', $4, $5::jsonb, true, NOW(), NOW())`,
        t.key, t.title, t.category, sanitizeLetterHtml(t.bodyHtml), JSON.stringify(t.customFields),
      );
      inserted++;
    }
    return NextResponse.json({ ok: true, inserted, skipped });
  } catch (e) {
    return serverError(e, "POST /api/hr/letter-templates");
  }
}
