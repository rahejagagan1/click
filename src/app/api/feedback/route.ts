import { serverError } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { canViewFeedbackInbox } from "@/lib/feedback-inbox-access";
import { serializeBigInt } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ALLOWED = new Set([
    "people_team_dynamics",
    "work_culture_environment",
    "ideas_improvements",
    "processes_policies",
    "compensation_support",
    "unfiltered_unsaid",
    "anything_else",
]);
const DEFAULT_CATEGORY = "anything_else";
const MAX_LEN = 8000;

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

        const body = await request.json().catch(() => ({}));
        const rawCat = typeof body.category === "string" ? body.category.trim().toLowerCase() : DEFAULT_CATEGORY;
        const category = ALLOWED.has(rawCat) ? rawCat : DEFAULT_CATEGORY;
        const message = typeof body.message === "string" ? body.message.trim() : "";

        if (!message) {
            return NextResponse.json({ error: "Message is required" }, { status: 400 });
        }
        if (message.length > MAX_LEN) {
            return NextResponse.json({ error: `Message must be at most ${MAX_LEN} characters` }, { status: 400 });
        }

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
