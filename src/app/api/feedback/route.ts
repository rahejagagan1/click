import { serverError } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { canViewFeedbackInbox } from "@/lib/feedback-inbox-access";
import { parseBody } from "@/lib/validate";
import { serializeBigInt } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ALLOWED_CATEGORIES = [
    "people_team_dynamics",
    "work_culture_environment",
    "ideas_improvements",
    "processes_policies",
    "compensation_support",
    "unfiltered_unsaid",
    "anything_else",
] as const;
const DEFAULT_CATEGORY: (typeof ALLOWED_CATEGORIES)[number] = "anything_else";
const MAX_LEN = 8000;

const FeedbackBody = z.object({
    category: z.string().trim().toLowerCase().optional(),
    message: z.string().trim().min(1, "Message is required").max(MAX_LEN, `Message must be at most ${MAX_LEN} characters`),
});

/** GET — CEO, Developer, HR: list feedback (no submitter PII — anonymous inbox) */
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!canViewFeedbackInbox(session?.user as any)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const rows = await prisma.userFeedback.findMany({
            orderBy: { createdAt: "desc" },
            take: 500,
            select: {
                id: true,
                category: true,
                message: true,
                createdAt: true,
            },
        });

        return NextResponse.json(serializeBigInt(rows));
    } catch (error) {
        console.error("[feedback] GET error:", error);
        return serverError(error, "route");
    }
}

/** POST — any logged-in user can submit dashboard feedback */
async function resolveSessionUserId(session: Session | null): Promise<number | null> {
    const email = session?.user?.email;
    const raw = (session?.user as { dbId?: number | string } | undefined)?.dbId;
    const id = raw === undefined || raw === null ? NaN : Number(raw);
    if (Number.isFinite(id)) return id;
    if (!email) return null;
    const row = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    return row?.id ?? null;
}

export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        const userId = await resolveSessionUserId(session);
        if (userId == null) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const parsed = await parseBody(request, FeedbackBody);
        if (!parsed.ok) return parsed.error;
        const { message } = parsed.data;
        const rawCat = parsed.data.category ?? DEFAULT_CATEGORY;
        const category = (ALLOWED_CATEGORIES as readonly string[]).includes(rawCat) ? rawCat : DEFAULT_CATEGORY;

        await prisma.userFeedback.create({
            data: {
                userId,
                category,
                message,
            },
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("[feedback] POST error:", error);
        return serverError(error, "route");
    }
}
