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
import { notifyUsers } from "@/lib/notifications";

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

        const created = await prisma.userFeedback.create({
            data: {
                userId,
                category,
                message,
            },
        });

        // Notify CEO / HR / admins / developers — feedback stays anonymous
        // so we deliberately pass `actorId: null` (no submitter avatar in
        // the bell, no "from <name>" header on the email). The body is
        // prefixed with `category:` so the email template can pluck it
        // out without an extra column.
        try {
            const devEmails = (process.env.DEVELOPER_EMAILS || "")
                .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
            const recipients = await prisma.user.findMany({
                where: {
                    isActive: true,
                    OR: [
                        { orgLevel: { in: ["ceo", "hr_manager", "special_access"] } },
                        { role: "admin" },
                        ...(devEmails.length > 0 ? [{ email: { in: devEmails } }] : []),
                    ],
                },
                select: { id: true },
            });
            const recipientIds = recipients.map((u) => u.id);
            if (recipientIds.length > 0) {
                const prettyCategory = category
                    .split("_")
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(" ");
                await notifyUsers({
                    actorId:  null,
                    userIds:  recipientIds,
                    type:     "feedback",
                    entityId: created.id,
                    title:    `New anonymous feedback — ${prettyCategory}`,
                    body:     `category: ${category}\n${message.slice(0, 600)}`,
                    linkUrl:  "/dashboard/feedback_inbox",
                });
            }
        } catch (e) {
            // Notification dispatch is best-effort — never block the
            // feedback save if we can't fan out.
            console.warn("[feedback] notify failed:", e);
        }

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("[feedback] POST error:", error);
        return serverError(error, "route");
    }
}
