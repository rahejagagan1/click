import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

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

  try {
    const body = await req.json();
    const { content, type, praiseToId, scope, department, mediaUrl } = body;
    if (!content?.trim()) return NextResponse.json({ error: "content required" }, { status: 400 });

    const post = await prisma.engagePost.create({
      data: {
        authorId: user.dbId,
        type: type || "post",
        content: content.trim(),
        praiseToId: praiseToId ? parseInt(praiseToId) : null,
        scope: scope || "org",
        department: department || null,
        mediaUrl: mediaUrl || null,
      },
      include: INCLUDE,
    });
    return NextResponse.json(post, { status: 201 });
  } catch (e) { return serverError(e, "POST /api/hr/engage/posts"); }
}
