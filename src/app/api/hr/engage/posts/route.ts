import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, isLeadershipOrHR, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const INCLUDE = {
  author: { select: { id: true, name: true, profilePictureUrl: true, role: true } },
  praiseTo: { select: { id: true, name: true, profilePictureUrl: true } },
  reactions: { include: { user: { select: { id: true, name: true } } } },
  comments: {
    orderBy: { createdAt: "asc" as const },
    include: { author: { select: { id: true, name: true, profilePictureUrl: true } } },
  },
};

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope") || "org";
  const cursor = searchParams.get("cursor") ? parseInt(searchParams.get("cursor")!) : undefined;

  try {
    const posts = await prisma.engagePost.findMany({
      where: scope !== "org" ? { scope } : {},
      orderBy: { createdAt: "desc" },
      take: 20,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: INCLUDE,
    });
    return NextResponse.json(posts);
  } catch (e) { return serverError(e, "GET /api/hr/engage/posts"); }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const user = session!.user as any;

  // Engage post creation is leadership/HR-tier only — CEO,
  // developers, and the HR team (orgLevel=hr_manager). Mirrors the
  // `canCompose` gate on the composer card; the server check makes
  // it a real ACL rather than a UI suggestion. Excludes
  // special_access and role=admin per the same policy used for
  // employee documents.
  if (!isLeadershipOrHR(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { content, type, praiseToId, scope, department, mediaUrl } = body;
    // Require EITHER a non-empty caption OR an attached image —
    // image-only posts (work anniversaries, posters) are valid.
    const safeContent = typeof content === "string" ? content.trim() : "";
    const safeMediaUrl = typeof mediaUrl === "string" ? mediaUrl.trim() : "";
    if (!safeContent && !safeMediaUrl) {
      return NextResponse.json({ error: "content or image required" }, { status: 400 });
    }
    // Only accept data: URIs for images or http(s) URLs — anything
    // else (javascript:, file:, etc.) is rejected. Hard-cap data URI
    // size at ~3 MB encoded so a single row can't bloat the table.
    if (safeMediaUrl) {
      const isHttp = /^https?:\/\//i.test(safeMediaUrl);
      // SVG intentionally excluded — it can carry inline JS / XSS.
      // Same rule as the safe-MIME allowlist in /api/hr/documents.
      const isDataImage = /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(safeMediaUrl);
      if (!isHttp && !isDataImage) {
        return NextResponse.json({ error: "Invalid image URL" }, { status: 400 });
      }
      if (safeMediaUrl.length > 3 * 1024 * 1024) {
        return NextResponse.json({ error: "Image too large" }, { status: 413 });
      }
    }

    const post = await prisma.engagePost.create({
      data: {
        authorId: user.dbId,
        type: type || "post",
        content: safeContent,
        praiseToId: praiseToId ? parseInt(praiseToId) : null,
        scope: scope || "org",
        department: department || null,
        mediaUrl: safeMediaUrl || null,
      },
      include: INCLUDE,
    });
    return NextResponse.json(post, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/engage/posts"); }
}
