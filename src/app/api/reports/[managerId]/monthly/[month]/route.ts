import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth , serverError } from "@/lib/api-auth";
import { getQualifiedCasesForRole } from "@/lib/ratings/data-resolver";
import { getManagerReportFormat } from "@/lib/reports/manager-report-format";
import { getMonthlyReportWindow } from "@/lib/reports/monthly-window";
import {
    normalizeTeamCapsuleInput,
    findCapsulesMatchingTeamCapsule,
} from "@/lib/capsule-matching";

export const dynamic = "force-dynamic";

type Params = { managerId: string; month: string };

// Production Volume auto-fill: for production managers, Total Video Completed is
// the count of cases with a Video QA1 subtask done in the reporting window
// (day 4 of month M → end of day 3 of month M+1; see monthly-window.ts), and
// Hero Content Completed is the subset whose Case.caseType matches "hero"
// (case-insensitive). CEO/developer can override — when overridden, we keep
// their value and don't recompute over it.
async function computeProductionActuals(managerId: number, month: number, year: number) {
    const monthStart = new Date(Date.UTC(year, month, 1));
    const monthEnd   = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59));
    const cases = await getQualifiedCasesForRole(monthStart, monthEnd, "production_manager", managerId);
    const totalVideo = cases.length;
    const heroContent = cases.filter((c) => (c.caseType || "").toLowerCase().includes("hero")).length;
    return { totalVideo, heroContent };
}

// Videos Published auto-fill: count Case rows in the manager's production lists
// whose YoutubeStats.publishedAt falls in the reporting window (same day 4 → day
// 3 next month window used everywhere else). Resolves teamCapsule → list IDs
// using the same logic as content-performance/route.ts.
async function computeVideosPublished(managerId: number, month: number, year: number): Promise<number> {
    const manager = await prisma.user.findUnique({
        where: { id: managerId },
        select: { teamCapsule: true },
    });
    const tc = normalizeTeamCapsuleInput(manager?.teamCapsule ?? "");
    if (!tc) return 0;

    let listIds: number[] = [];
    const listsByExactName = await prisma.productionList.findMany({
        where: { name: { equals: tc, mode: "insensitive" } },
        select: { id: true },
    });
    if (listsByExactName.length > 0) {
        listIds = listsByExactName.map((l) => l.id);
    } else {
        const capsules = await findCapsulesMatchingTeamCapsule(tc);
        if (capsules.length > 0) {
            const lists = await prisma.productionList.findMany({
                where: { capsuleId: { in: capsules.map((c) => c.id) } },
                select: { id: true },
            });
            listIds = lists.map((l) => l.id);
        }
    }
    if (listIds.length === 0) return 0;

    const { windowStart, windowEnd } = getMonthlyReportWindow(year, month);
    return prisma.case.count({
        where: {
            productionListId: { in: listIds },
            youtubeStats: {
                is: { publishedAt: { gte: windowStart, lte: windowEnd } },
            },
        },
    });
}

/* ── GET — load monthly report ── */
export async function GET(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        const managerId = parseInt(params.managerId);
        const month     = parseInt(params.month);
        const year      = parseInt(req.nextUrl.searchParams.get("year") ?? "");

        if (isNaN(managerId) || isNaN(month) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        const report = await prisma.monthlyReport.findUnique({
            where: { managerId_month_year: { managerId, month, year } },
        });

        // Auto-compute Production Volume actuals for production managers. These
        // are returned regardless of whether a draft exists yet so the UI can
        // populate them on a blank form. If the saved report has override flags
        // set, we surface the saved values instead.
        const manager = await prisma.user.findUnique({
            where: { id: managerId },
            select: { role: true, orgLevel: true, name: true },
        });
        const isProduction = manager ? getManagerReportFormat(manager) === "production" : false;
        const auto = isProduction
            ? await computeProductionActuals(managerId, month, year)
            : { totalVideo: 0, heroContent: 0 };
        const autoVideosPublished = isProduction
            ? await computeVideosPublished(managerId, month, year)
            : 0;

        if (!report) {
            return NextResponse.json({
                submitted: false,
                locked: false,
                data: isProduction ? {
                    totalVideoActual:  String(auto.totalVideo),
                    heroContentActual: String(auto.heroContent),
                    videosPublishedActual: String(autoVideosPublished),
                    totalVideoActualOverridden: false,
                    heroContentActualOverridden: false,
                    videosPublishedActualOverridden: false,
                } : null,
            });
        }

        const totalVideoActual = (report as any).totalVideoActualOverridden
            ? report.totalVideoActual
            : (isProduction ? String(auto.totalVideo) : report.totalVideoActual);
        const heroContentActual = (report as any).heroContentActualOverridden
            ? report.heroContentActual
            : (isProduction ? String(auto.heroContent) : report.heroContentActual);
        const videosPublishedActual = (report as any).videosPublishedActualOverridden
            ? (report as any).videosPublishedActual
            : (isProduction ? String(autoVideosPublished) : (report as any).videosPublishedActual);

        return NextResponse.json({
            submitted: true,
            locked:    report.isLocked,
            reportId:  report.id,
            data: {
                // Section 1
                executiveSummary:    report.executiveSummary,
                // Section 2
                totalVideoTarget:    report.totalVideoTarget,
                totalVideoActual,
                totalVideoVariance:  report.totalVideoVariance,
                heroContentTarget:   report.heroContentTarget,
                heroContentActual,
                heroContentVariance: report.heroContentVariance,
                videosPublishedTarget:   (report as any).videosPublishedTarget   ?? null,
                videosPublishedActual,
                videosPublishedVariance: (report as any).videosPublishedVariance ?? null,
                totalVideoActualOverridden:      (report as any).totalVideoActualOverridden      ?? false,
                heroContentActualOverridden:     (report as any).heroContentActualOverridden     ?? false,
                videosPublishedActualOverridden: (report as any).videosPublishedActualOverridden ?? false,
                editorNotes:         report.editorNotes,
                writerNotes:         report.writerNotes,
                // Section 3
                shortfallSummary:    report.shortfallSummary,
                // Section 4
                teamRecognition:     report.teamRecognition,
                // Section 5
                keyLearning1:        report.keyLearning1,
                keyLearning2:        report.keyLearning2,
                keyLearning3:        report.keyLearning3,
                // Section 5B
                risksAttention:      report.risksAttention,
                // Section 6
                behavioralConcerns:  report.behavioralConcerns,
                // Section 7
                remark:              report.remark,
                // Nishant Bhatia researcher monthly format
                nishantResearcherRows: report.nishantResearcherRows,
                nishantOverview:       report.nishantOverview,
                // Andrew James monthly sections
                andrewA1Rows: (report as any).andrewA1Rows,
                andrewA2Rows: (report as any).andrewA2Rows,
                andrewBRows:  (report as any).andrewBRows,
                andrewSBRows: (report as any).andrewCRows,  // thumbnails → andrewCRows in DB
                andrewSCRows: (report as any).andrewDRows,  // capsule views → andrewDRows in DB
                // HR Manager (Tanvi Dogra) monthly report — dedicated column
                hrMonthlyData: (report as any).hrMonthlyData,
            },
        });
    } catch (error) {
        return serverError(error, "route");
    }
}

/* ── DELETE — delete an unlocked (draft) monthly report ── */
export async function DELETE(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        const managerId = parseInt(params.managerId);
        const month     = parseInt(params.month);
        const year      = parseInt(req.nextUrl.searchParams.get("year") ?? "");

        if (isNaN(managerId) || isNaN(month) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        const report = await prisma.monthlyReport.findUnique({
            where: { managerId_month_year: { managerId, month, year } },
        });

        if (!report) {
            return NextResponse.json({ error: "Report not found" }, { status: 404 });
        }
        if (report.isLocked) {
            return NextResponse.json({ error: "Cannot delete a submitted report. Ask an admin to unlock it first." }, { status: 403 });
        }

        await prisma.monthlyReport.delete({
            where: { managerId_month_year: { managerId, month, year } },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        return serverError(error, "reports/monthly DELETE");
    }
}

/* ── POST — save draft or submit (lock) the monthly report ── */
export async function POST(req: NextRequest, { params }: { params: Params }) {
    try {
        const { session, errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        const managerId = parseInt(params.managerId);
        const month     = parseInt(params.month);
        const body      = await req.json();
        const { year, isDraft, ...fields } = body;

        if (isNaN(managerId) || isNaN(month) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        const shouldLock = !isDraft;

        const existing = await prisma.monthlyReport.findUnique({
            where: { managerId_month_year: { managerId, month, year } },
        });
        if (existing?.isLocked) {
            return NextResponse.json({ error: "Report is locked. Ask an admin to unlock it first." }, { status: 403 });
        }

        // Only CEO / developer / special_access can override auto-computed actuals.
        // For everyone else, auto-recompute on every save so the DB always reflects
        // the latest qualified-case count.
        const sessionUser = (session as any)?.user;
        const canOverride =
            sessionUser?.orgLevel === "ceo" ||
            sessionUser?.orgLevel === "special_access" ||
            sessionUser?.isDeveloper === true;

        const manager = await prisma.user.findUnique({
            where: { id: managerId },
            select: { role: true, orgLevel: true, name: true },
        });
        const isProduction = manager ? getManagerReportFormat(manager) === "production" : false;
        const auto = isProduction
            ? await computeProductionActuals(managerId, month, year)
            : { totalVideo: 0, heroContent: 0 };
        const autoVideosPublished = isProduction
            ? await computeVideosPublished(managerId, month, year)
            : 0;

        const prevTotalOverridden  = (existing as any)?.totalVideoActualOverridden      ?? false;
        const prevHeroOverridden   = (existing as any)?.heroContentActualOverridden     ?? false;
        const prevVideosOverridden = (existing as any)?.videosPublishedActualOverridden ?? false;

        // Decide the next override state + value for each actual. Non-privileged
        // callers can never flip a flag on, and their submitted actual is ignored
        // whenever auto-compute is in effect.
        let totalVideoActualOverridden = prevTotalOverridden;
        let totalVideoActual: string | null = fields.totalVideoActual ?? null;
        if (isProduction) {
            if (canOverride && typeof fields.totalVideoActualOverridden === "boolean") {
                totalVideoActualOverridden = fields.totalVideoActualOverridden;
            }
            if (!totalVideoActualOverridden) {
                totalVideoActual = String(auto.totalVideo);
            } else if (!canOverride) {
                // Non-privileged save on an already-overridden row: keep the existing value.
                totalVideoActual = existing?.totalVideoActual ?? String(auto.totalVideo);
            }
        }

        let heroContentActualOverridden = prevHeroOverridden;
        let heroContentActual: string | null = fields.heroContentActual ?? null;
        if (isProduction) {
            if (canOverride && typeof fields.heroContentActualOverridden === "boolean") {
                heroContentActualOverridden = fields.heroContentActualOverridden;
            }
            if (!heroContentActualOverridden) {
                heroContentActual = String(auto.heroContent);
            } else if (!canOverride) {
                heroContentActual = existing?.heroContentActual ?? String(auto.heroContent);
            }
        }

        let videosPublishedActualOverridden = prevVideosOverridden;
        let videosPublishedActual: string | null = fields.videosPublishedActual ?? null;
        if (isProduction) {
            if (canOverride && typeof fields.videosPublishedActualOverridden === "boolean") {
                videosPublishedActualOverridden = fields.videosPublishedActualOverridden;
            }
            if (!videosPublishedActualOverridden) {
                videosPublishedActual = String(autoVideosPublished);
            } else if (!canOverride) {
                videosPublishedActual = (existing as any)?.videosPublishedActual ?? String(autoVideosPublished);
            }
        }

        const payload = {
            // Section 1: Executive Summary
            executiveSummary:    fields.executiveSummary    ?? null,
            // Section 2: Production Output
            totalVideoTarget:    fields.totalVideoTarget    ?? null,
            totalVideoActual,
            totalVideoVariance:  fields.totalVideoVariance  ?? null,
            heroContentTarget:   fields.heroContentTarget   ?? null,
            heroContentActual,
            heroContentVariance: fields.heroContentVariance ?? null,
            videosPublishedTarget:   fields.videosPublishedTarget   ?? null,
            videosPublishedActual,
            videosPublishedVariance: fields.videosPublishedVariance ?? null,
            totalVideoActualOverridden,
            heroContentActualOverridden,
            videosPublishedActualOverridden,
            editorNotes:         fields.editorNotes         ?? null,
            writerNotes:         fields.writerNotes         ?? null,
            // Section 3: Shortfall Analysis
            shortfallSummary:    fields.shortfallSummary    ?? null,
            // Section 4: Team Recognition
            teamRecognition:     fields.teamRecognition     ?? null,
            // Section 5: Key Learnings
            keyLearning1:        fields.keyLearning1        ?? null,
            keyLearning2:        fields.keyLearning2        ?? null,
            keyLearning3:        fields.keyLearning3        ?? null,
            // Section 5B: Risks
            risksAttention:      fields.risksAttention      ?? null,
            // Section 6: Behavioral Concerns
            behavioralConcerns:  fields.behavioralConcerns  ?? null,
            // Section 7: Remark
            remark:              fields.remark              ?? null,
            // Nishant Bhatia researcher monthly format
            nishantResearcherRows: fields.nishantResearcherRows ?? null,
            nishantOverview:       fields.nishantOverview       ?? null,
            // Andrew James monthly sections
            andrewA1Rows: fields.andrewA1Rows ?? null,
            andrewA2Rows: fields.andrewA2Rows ?? null,
            andrewBRows:  fields.andrewBRows  ?? null,
            andrewCRows:  fields.andrewSBRows ?? null,  // thumbnails
            andrewDRows:  fields.andrewSCRows ?? null,  // capsule views
            // HR Manager (Tanvi Dogra) — dedicated column
            hrMonthlyData: fields.hrMonthlyData ?? null,
            isLocked:            shouldLock,
            submittedAt:         shouldLock ? new Date() : undefined,
        };

        const report = await prisma.monthlyReport.upsert({
            where:  { managerId_month_year: { managerId, month, year } },
            create: { managerId, month, year, ...payload },
            update: payload,
        });

        return NextResponse.json({ success: true, reportId: report.id, locked: shouldLock, isDraft });
    } catch (error) {
        return serverError(error, "route");
    }
}
