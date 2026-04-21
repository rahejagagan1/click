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

        // Get all monthly ratings with user info and edit logs.
        // Hide ratings belonging to deactivated users (people who left the
        // company) — their rows stop syncing so they render as "missing values"
        // in the audit panel. Active users are unaffected.
        const ratings = await prisma.monthlyRating.findMany({
            where: {
                ...monthFilter,
                user: { isActive: true },
            },
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

// Bracket lookup — mirrors formula-engine.ts::applyBrackets
function applyBrackets(value: number, brackets: Array<{ min: number; max: number; stars: number }>): number {
    for (const b of brackets) if (value >= b.min && value <= b.max) return b.stars;
    if (brackets.length === 0) return 1;
    const sorted = [...brackets].sort((a, b) => a.min - b.min);
    if (value < sorted[0].min) return sorted[0].stars;
    let best = sorted[0];
    for (const b of sorted) if (b.min <= value) best = b;
    return best.stars;
}

// Matrix lookup — mirrors formula-engine.ts::applyMatrix
function applyMatrix(
    casesCompleted: number,
    qualityStars: number,
    matrix: Record<string, Record<string, number>>
): number | null {
    if (casesCompleted <= 1) return 0;
    const roundedQuality = Math.min(5, Math.max(1, Math.round(qualityStars)));
    const caseKeys = Object.keys(matrix).map(Number).sort((a, b) => a - b);
    let matchKey: string | null = null;
    for (const ck of caseKeys) if (casesCompleted >= ck) matchKey = String(ck);
    if (!matchKey && caseKeys.length > 0) matchKey = String(caseKeys[caseKeys.length - 1]);
    if (!matchKey) return null;
    const qualityMap = matrix[matchKey];
    if (!qualityMap) return null;
    return qualityMap[String(roundedQuality)] ?? null;
}

/**
 * Given a section's formula config and the new rawValue, derive the new stars.
 * Handles bracket_lookup and matrix_lookup (the two types that have a numeric input
 * the user can edit). Other types keep their existing stars.
 *
 * Returns `undefined` when the section type isn't self-recomputable — caller
 * should leave the stars as-is in that case.
 */
function recomputeSectionStarsFromRawValue(
    sectionConfig: any,
    newRawValue: number,
    liveSections: any[]
): number | null | undefined {
    if (!sectionConfig) return undefined;

    if (sectionConfig.type === "bracket_lookup") {
        const brackets = sectionConfig.brackets;
        if (!Array.isArray(brackets)) return undefined;
        return applyBrackets(newRawValue, brackets);
    }

    if (sectionConfig.type === "matrix_lookup") {
        const matrix = sectionConfig.matrix;
        const ySectionKey = sectionConfig.variable_y_section;
        if (!matrix || !ySectionKey) return undefined;
        const sibling = liveSections.find((s: any) => s.key === ySectionKey);
        const yStars = sibling?.stars;
        if (yStars == null) return null;
        return applyMatrix(newRawValue, Number(yStars), matrix);
    }

    return undefined; // leave stars untouched for other types
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
                // When rawValue changes, try to recompute this section's stars
                // from the formula template so the final rating auto-adjusts.
                section.rawValue = numVal;

                const template = await prisma.formulaTemplate.findFirst({
                    where: { roleType: current.roleType, isActive: true },
                    orderBy: { version: "desc" },
                });
                const templateSections = Array.isArray(template?.sections) ? (template!.sections as any[]) : [];
                const sectionConfig = templateSections.find((s: any) => s?.key === sectionKey);

                const newStars = recomputeSectionStarsFromRawValue(sectionConfig, numVal, sections);
                if (newStars !== undefined) {
                    const oldStars = section.stars;
                    section.stars = newStars;
                    section.details =
                        `Manual override: value=${numVal} → ${newStars ?? "null"}★ (was value=${oldVal ?? "null"}, stars=${oldStars ?? "null"})`;

                    // Any matrix_lookup section that uses this one as its y-axis must
                    // also recompute — editing a quality value should bubble into the
                    // cases-matrix star that depends on it.
                    for (const dep of sections) {
                        const depConfig = templateSections.find((t: any) => t?.key === dep.key);
                        if (depConfig?.type === "matrix_lookup" && depConfig.variable_y_section === sectionKey) {
                            if (dep.rawValue != null) {
                                const depNewStars = recomputeSectionStarsFromRawValue(depConfig, Number(dep.rawValue), sections);
                                if (depNewStars !== undefined) {
                                    dep.stars = depNewStars;
                                    dep.details =
                                        `Auto-recomputed from ${sectionKey} change: ${dep.rawValue} cases × ${newStars}★ → ${depNewStars ?? "null"}★`;
                                }
                            }
                        }
                    }
                }
            }
            section.isOverridden = true;
            if (isStarsEdit) {
                section.details = `Manual override: ${numVal}★ (was ${oldVal ?? "null"})`;
            }

            // Recalculate overall rating from (possibly updated) stars
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
