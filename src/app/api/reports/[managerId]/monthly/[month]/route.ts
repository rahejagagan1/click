import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth , serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type Params = { managerId: string; month: string };

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

        if (!report) return NextResponse.json({ submitted: false, locked: false, data: null });

        return NextResponse.json({
            submitted: true,
            locked:    report.isLocked,
            reportId:  report.id,
            data: {
                // Section 1
                executiveSummary:    report.executiveSummary,
                // Section 2
                totalVideoTarget:    report.totalVideoTarget,
                totalVideoActual:    report.totalVideoActual,
                totalVideoVariance:  report.totalVideoVariance,
                heroContentTarget:   report.heroContentTarget,
                heroContentActual:   report.heroContentActual,
                heroContentVariance: report.heroContentVariance,
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
        const { errorResponse } = await requireAuth();
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

        const payload = {
            // Section 1: Executive Summary
            executiveSummary:    fields.executiveSummary    ?? null,
            // Section 2: Production Output
            totalVideoTarget:    fields.totalVideoTarget    ?? null,
            totalVideoActual:    fields.totalVideoActual    ?? null,
            totalVideoVariance:  fields.totalVideoVariance  ?? null,
            heroContentTarget:   fields.heroContentTarget   ?? null,
            heroContentActual:   fields.heroContentActual   ?? null,
            heroContentVariance: fields.heroContentVariance ?? null,
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
