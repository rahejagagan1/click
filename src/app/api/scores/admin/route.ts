import { serverError } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { serializeBigInt } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Check if user has admin audit access (CEO / special_access / developer / dev mode)
function hasAuditAccess(session: any): boolean {
    const user = session?.user as any;
    const isDev = process.env.NODE_ENV === "development";
    return (
        user?.orgLevel === "ceo" ||
        user?.orgLevel === "special_access" ||
        user?.isDeveloper === true ||
        (isDev && user?.role === "admin")
    );
}

// GET: Fetch all users' scores for admin audit
export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasAuditAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const month = searchParams.get("month");

        const monthFilter: any = {};
        if (month) {
            const [year, mon] = month.split("-").map(Number);
            monthFilter.month = new Date(Date.UTC(year, mon - 1, 1));
        }

        // Get all monthly ratings with user info and edit logs
        const ratings = await prisma.monthlyRating.findMany({
            where: monthFilter,
            orderBy: [{ month: "desc" }, { overallRating: "desc" }],
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        role: true,
                        orgLevel: true,
                        profilePictureUrl: true,
                        teamCapsule: true,
                        manager: { select: { id: true, name: true } },
                    },
                },
                editLogs: {
                    include: {
                        editor: { select: { id: true, name: true } },
                    },
                    orderBy: { editedAt: "desc" },
                    take: 5,
                },
            },
        });

        // Get all users for the hub view
        const allUsers = await prisma.user.findMany({
            where: { isActive: true, NOT: { role: "member", orgLevel: "member" } },
            select: {
                id: true,
                name: true,
                role: true,
                orgLevel: true,
                profilePictureUrl: true,
                teamCapsule: true,
                managerId: true,
                manager: { select: { id: true, name: true } },
            },
            orderBy: { name: "asc" },
        });

        return NextResponse.json(serializeBigInt({ ratings, allUsers }));
    } catch (error) {
        console.error("Scores admin API error:", error);
        return serverError(error, "route");
    }
}

// Recalculate overallRating from sections (mirrors formula engine logic)
function recalcOverallRating(sections: any[]): number | null {
    const valid = sections.filter((s: any) => s.stars !== null && s.stars !== undefined);
    if (valid.length === 0) return null;
    const totalWeight = valid.reduce((sum: number, s: any) => sum + (s.weight || 0), 0);
    if (totalWeight === 0) return null;
    const raw = valid.reduce((sum: number, s: any) => sum + s.stars * (s.weight / totalWeight), 0);
    return Math.round(raw * 100) / 100;
}

// Map section keys to convenience DB columns
const SECTION_TO_COLUMN: Record<string, string> = {
    writerQuality: "writerQualityStars",
    editorQuality: "writerQualityStars",
    scriptQuality: "scriptQualityStars",
    videoQuality: "scriptQualityStars",
    ownership: "ownershipStars",
    monthlyTargets: "monthlyTargetsStars",
    youtubeViews: "ytViewsStars",
    youtube_views: "ytViewsStars",
};

// PATCH: Edit a specific score value (admin override)
export async function PATCH(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasAuditAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const body = await request.json();
        const { monthlyRatingId, fieldName, sectionKey, newValue, reason } = body;

        if (!monthlyRatingId || !fieldName || newValue === undefined) {
            return NextResponse.json(
                { error: "Missing required fields: monthlyRatingId, fieldName, newValue" },
                { status: 400 }
            );
        }

        const editorUser = session!.user as any;
        if (editorUser?.dbId == null || Number.isNaN(Number(editorUser.dbId))) {
            return NextResponse.json(
                { error: "Your login is not linked to a dashboard user record, so edits cannot be saved. Try signing out and back in." },
                { status: 400 }
            );
        }
        const editorDbId = Number(editorUser.dbId);

        // Get current rating
        const current = await prisma.monthlyRating.findUnique({
            where: { id: monthlyRatingId },
        });
        if (!current) {
            return NextResponse.json({ error: "Monthly rating not found" }, { status: 404 });
        }

        const updateData: any = { isManualOverride: true };

        if ((fieldName === "section_stars" || fieldName === "section_value") && sectionKey) {
            // ── Edit a specific pillar's stars or rawValue within parametersJson ──
            const numVal = parseFloat(newValue);
            if (isNaN(numVal)) {
                return NextResponse.json({ error: "Value must be a number" }, { status: 400 });
            }
            if (fieldName === "section_stars" && (numVal < 0 || numVal > 5)) {
                return NextResponse.json({ error: "Stars must be between 0 and 5" }, { status: 400 });
            }

            const sections = Array.isArray(current.parametersJson)
                ? JSON.parse(JSON.stringify(current.parametersJson))
                : [];
            const section = sections.find((s: any) => s.key === sectionKey);
            if (!section) {
                return NextResponse.json({ error: `Section '${sectionKey}' not found` }, { status: 400 });
            }

            const isStarsEdit = fieldName === "section_stars";
            const oldVal = isStarsEdit ? section.stars : section.rawValue;

            if (isStarsEdit) {
                section.stars = numVal;
            } else {
                section.rawValue = numVal;
            }
            section.isOverridden = true;
            section.details = `Manual override: ${isStarsEdit ? `${numVal}★` : `value=${numVal}`} (was ${oldVal ?? "null"})`;

            // Recalculate overall rating from stars
            const newOverall = recalcOverallRating(sections);

            updateData.parametersJson = sections;
            updateData.overallRating = newOverall;

            // Update convenience column if mapped (only for stars edits)
            if (isStarsEdit) {
                const convCol = SECTION_TO_COLUMN[sectionKey];
                if (convCol) updateData[convCol] = numVal;
            }

            // Audit log
            await prisma.scoreEditLog.create({
                data: {
                    monthlyRatingId,
                    fieldName: `${fieldName}:${sectionKey}`,
                    oldValue: String(oldVal ?? "null"),
                    newValue: String(numVal),
                    editedBy: editorDbId,
                    reason: reason || "Admin inline edit",
                },
            });
        } else if (fieldName === "overallRating") {
            // ── Direct override of final score ──
            const numVal = parseFloat(newValue);
            const oldValue = current.overallRating != null ? Number(current.overallRating) : null;
            updateData.overallRating = numVal;

            await prisma.scoreEditLog.create({
                data: {
                    monthlyRatingId,
                    fieldName: "overallRating",
                    oldValue: String(oldValue ?? "null"),
                    newValue: String(numVal),
                    editedBy: editorDbId,
                    reason: reason || "Admin inline edit",
                },
            });
        } else {
            return NextResponse.json({ error: `Field '${fieldName}' is not editable via inline edit` }, { status: 400 });
        }

        const updated = await prisma.monthlyRating.update({
            where: { id: monthlyRatingId },
            data: updateData,
            include: {
                user: {
                    select: {
                        id: true, name: true, role: true, orgLevel: true,
                        profilePictureUrl: true, teamCapsule: true,
                        manager: { select: { id: true, name: true } },
                    },
                },
                editLogs: {
                    include: { editor: { select: { id: true, name: true } } },
                    orderBy: { editedAt: "desc" },
                    take: 5,
                },
            },
        });

        return NextResponse.json(serializeBigInt(updated));
    } catch (error) {
        console.error("Scores admin PATCH error:", error);
        return serverError(error, "route");
    }
}

// POST: Create a new MonthlyRating entry for a missing user
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasAuditAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const body = await request.json();
        const { userId, month, roleType } = body;

        console.log("[scores/admin POST] body:", JSON.stringify({ userId, month, roleType }));

        if (!userId || !month || !roleType) {
            return NextResponse.json({ error: "Missing required fields: userId, month, roleType" }, { status: 400 });
        }

        if (typeof month !== "string" || !month.includes("-")) {
            return NextResponse.json({ error: `Invalid month format: ${month}` }, { status: 400 });
        }

        const [year, mon] = month.split("-").map(Number);
        const monthDate = new Date(Date.UTC(year, mon - 1, 1));

        // Check if entry already exists
        const existing = await prisma.monthlyRating.findUnique({
            where: { userId_month_roleType: { userId: parseInt(userId), month: monthDate, roleType } },
        });
        if (existing) {
            return NextResponse.json({ error: "Rating entry already exists for this user/month/role" }, { status: 409 });
        }

        // Load the active template to get section structure
        const template = await prisma.formulaTemplate.findFirst({
            where: { roleType, isActive: true },
            orderBy: { version: "desc" },
        });

        // Build empty parametersJson from template sections
        const sections = template?.sections;
        const emptySections = Array.isArray(sections)
            ? (sections as any[]).map((s: any) => ({
                key: s.key,
                label: s.label,
                weight: s.weight,
                source: s.source,
                rawValue: null,
                stars: null,
                details: "Manually added — pending data",
                blocksScore: s.blocks_final_score ?? false,
                isOverridden: false,
            }))
            : [];

        const created = await prisma.monthlyRating.create({
            data: {
                userId: parseInt(userId),
                month: monthDate,
                roleType,
                casesCompleted: 0,
                overallRating: null,
                isManualOverride: true,
                manualRatingsPending: true,
                parametersJson: emptySections,
                formulaTemplateId: template?.id ?? null,
                formulaVersion: template?.version ?? null,
            },
            include: {
                user: {
                    select: {
                        id: true, name: true, role: true, orgLevel: true,
                        profilePictureUrl: true, teamCapsule: true,
                        manager: { select: { id: true, name: true } },
                    },
                },
                editLogs: true,
            },
        });

        return NextResponse.json(serializeBigInt(created));
    } catch (error: any) {
        console.error("Scores admin POST error:", error);
        const msg = error instanceof Error ? error.message : String(error);
        const code = error?.code || "";
        // Return actual error details to admins (this route is admin-only)
        if (code === "P2002") {
            return NextResponse.json(
                { error: "Rating entry already exists for this user/month/role (constraint)" },
                { status: 409 }
            );
        }
        if (code === "P2003") {
            return NextResponse.json(
                { error: `Foreign key constraint failed: ${error.meta?.field_name || "unknown field"}` },
                { status: 400 }
            );
        }
        return NextResponse.json(
            { error: `Failed to create entry: ${code ? `[${code}] ` : ""}${msg}` },
            { status: 500 }
        );
    }
}
