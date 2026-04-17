import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth , serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type Params = { managerId: string; week: string };

/* ── GET — load weekly report ── */
export async function GET(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        const managerId = parseInt(params.managerId);
        const week      = parseInt(params.week);
        const month     = parseInt(req.nextUrl.searchParams.get("month") ?? "");
        const year      = parseInt(req.nextUrl.searchParams.get("year")  ?? "");

        if (isNaN(managerId) || isNaN(week) || isNaN(month) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        const report = await prisma.weeklyReport.findUnique({
            where: { managerId_week_month_year: { managerId, week, month, year } },
        });

        if (!report) return NextResponse.json({ submitted: false, locked: false, data: null });

        // Return named columns; fall back to legacy dataJson for old records
        const data = (report.writerRows || report.editorRows || report.overviewRows || report.researcherRows || (report as any).viewsRows)
            ? {
                writerRows:     report.writerRows,
                editorRows:     report.editorRows,
                researcherRows: report.researcherRows,
                overviewRows:   report.overviewRows,
                viewsRows:      (report as any).viewsRows,
              }
            : report.dataJson; // legacy fallback

        return NextResponse.json({
            submitted: true,
            locked:    report.isLocked,
            data,
            reportId:  report.id,
        });
    } catch (error) {
        return serverError(error, "route");
    }
}

/* ── DELETE — delete an unlocked (draft) weekly report ── */
export async function DELETE(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        const managerId = parseInt(params.managerId);
        const week      = parseInt(params.week);
        const month     = parseInt(req.nextUrl.searchParams.get("month") ?? "");
        const year      = parseInt(req.nextUrl.searchParams.get("year")  ?? "");

        if (isNaN(managerId) || isNaN(week) || isNaN(month) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        const report = await prisma.weeklyReport.findUnique({
            where: { managerId_week_month_year: { managerId, week, month, year } },
        });

        if (!report) {
            return NextResponse.json({ error: "Report not found" }, { status: 404 });
        }
        if (report.isLocked) {
            return NextResponse.json({ error: "Cannot delete a submitted report. Ask an admin to unlock it first." }, { status: 403 });
        }

        await prisma.weeklyReport.delete({
            where: { managerId_week_month_year: { managerId, week, month, year } },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        return serverError(error, "reports/weekly DELETE");
    }
}

/* ── POST — save draft or submit (and lock) the weekly report ── */
export async function POST(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        const managerId = parseInt(params.managerId);
        const week      = parseInt(params.week);
        const body      = await req.json();
        const { month, year, isDraft, writerRows, editorRows, researcherRows, overviewRows, viewsRows } = body;

        if (isNaN(managerId) || isNaN(week) || isNaN(month) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        const shouldLock = !isDraft;

        const existing = await prisma.weeklyReport.findUnique({
            where: { managerId_week_month_year: { managerId, week, month, year } },
        });
        if (existing?.isLocked) {
            return NextResponse.json({ error: "Report is locked. Ask an admin to unlock it first." }, { status: 403 });
        }

        const payload = {
            writerRows:     writerRows     ?? null,  // Section A1
            editorRows:     editorRows     ?? null,  // Section A2
            researcherRows: researcherRows ?? null,  // Section A3 / Andrew Section C
            overviewRows:   overviewRows   ?? null,  // Section B
            viewsRows:      viewsRows      ?? null,  // Andrew Section D
            isLocked:     shouldLock,
            submittedAt:  shouldLock ? new Date() : undefined,
        };

        const report = await prisma.weeklyReport.upsert({
            where:  { managerId_week_month_year: { managerId, week, month, year } },
            create: { managerId, week, month, year, ...payload },
            update: payload,
        });

        return NextResponse.json({ success: true, reportId: report.id, locked: shouldLock, isDraft });
    } catch (error) {
        return serverError(error, "route");
    }
}
