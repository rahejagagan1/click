// Publish-state transitions for a JobOpening.
//
// POST   /api/hr/hiring/jobs/[id]/publish    body: { action: "publish" | "unpublish" | "hold" | "close" }
//
// Centralises the side-effects of each status change:
//   • publish    → status='published', isOpen=true, publishedAt set, publicSlug generated if missing
//   • unpublish  → status='draft',     isOpen=false (back to working state — careers page hides it)
//   • hold       → status='on_hold',   isOpen=false (paused — careers page hides, kanban stays)
//   • close      → status='closed',    isOpen=false (final — role filled / cancelled)
//
// HR can still flip status from the regular PATCH endpoint, but routing
// through this endpoint guarantees the related fields stay consistent
// (publishedAt / publicSlug never drift out of sync with status).

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { buildJobSlug } from "@/lib/hr/job-slug";

export const dynamic = "force-dynamic";

type Action = "publish" | "unpublish" | "hold" | "close";

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

    const body = await req.json().catch(() => ({}));
    const action = body?.action as Action;
    if (!["publish", "unpublish", "hold", "close"].includes(action)) {
      return NextResponse.json({ error: "action must be publish | unpublish | hold | close" }, { status: 400 });
    }

    // Snapshot the job — we need the title to generate a slug on first
    // publish, and the existing publicSlug / publishedAt so we don't
    // overwrite a stable URL just because HR un-published then re-
    // published.
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, title, status, "publicSlug", "publishedAt"
         FROM "JobOpening" WHERE id = $1`,
      id,
    );
    const job = rows[0];
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (action === "publish") {
      // Generate the slug only on first publish; later un-publish →
      // re-publish keeps the original URL alive so any shared links
      // (LinkedIn, WhatsApp, the careers page) keep working.
      let slug: string | null = job.publicSlug ?? null;
      if (!slug) {
        slug = buildJobSlug(job.title, job.id);
      }
      // publishedAt is sticky too — the "Live since" label on the
      // careers page should reflect the very first publish.
      const firstPublishedAt: Date = job.publishedAt ?? new Date();
      await prisma.$executeRawUnsafe(
        `UPDATE "JobOpening"
            SET "status" = 'published',
                "isOpen" = true,
                "publicSlug"  = COALESCE("publicSlug", $1),
                "publishedAt" = COALESCE("publishedAt", $2),
                "updatedAt" = NOW()
          WHERE id = $3`,
        slug, firstPublishedAt, id,
      );
      return NextResponse.json({ ok: true, status: "published", publicSlug: slug });
    }

    if (action === "unpublish") {
      await prisma.$executeRawUnsafe(
        `UPDATE "JobOpening" SET "status" = 'draft', "isOpen" = false, "updatedAt" = NOW() WHERE id = $1`,
        id,
      );
      return NextResponse.json({ ok: true, status: "draft" });
    }
    if (action === "hold") {
      await prisma.$executeRawUnsafe(
        `UPDATE "JobOpening" SET "status" = 'on_hold', "isOpen" = false, "updatedAt" = NOW() WHERE id = $1`,
        id,
      );
      return NextResponse.json({ ok: true, status: "on_hold" });
    }
    // close
    await prisma.$executeRawUnsafe(
      `UPDATE "JobOpening" SET "status" = 'closed', "isOpen" = false, "updatedAt" = NOW() WHERE id = $1`,
      id,
    );
    return NextResponse.json({ ok: true, status: "closed" });
  } catch (e) {
    return serverError(e, "POST /api/hr/hiring/jobs/[id]/publish");
  }
}
