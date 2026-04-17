import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { calcBusinessDaysTat, formatTatDays } from "@/lib/utils";
import { getWeeklyReportPeriod } from "@/lib/reports/weekly-period";
import { isWriterFirstDraftMilestone } from "@/lib/clickup/subtask-milestones";

export const dynamic = "force-dynamic";

type Params = { managerId: string; week: string };

/** Use DB-stored TAT if present, otherwise calculate on the fly. */
function resolveSubtaskTat(sub: { tat?: any; startDate: Date | null; dateDone: Date | null }): string {
    if (sub.tat !== null && sub.tat !== undefined) {
        const n = Number(sub.tat);
        if (!isNaN(n)) return formatTatDays(n);
    }
    if (sub.startDate && sub.dateDone) {
        const days = calcBusinessDaysTat(sub.startDate, sub.dateDone);
        return formatTatDays(days);
    }
    return "";
}

/** Match subtask names for any Script Revision step (R1, R2 …) */
function isRevisionSubtask(name: string): boolean {
    const n = name.toLowerCase();
    return (
        (n.includes("script") && n.includes("revision")) ||
        n.startsWith("revision")
    );
}

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

        const period = getWeeklyReportPeriod(year, month, week);
        if (!period) {
            return NextResponse.json({ error: "Invalid week for this month" }, { status: 400 });
        }
        const { weekStart, weekEnd } = period;

        // Writers under this manager
        const manager = await prisma.user.findUnique({
            where: { id: managerId },
            include: {
                teamMembers: {
                    where: { role: "writer", isActive: true },
                    select: { id: true, name: true },
                },
            },
        });

        if (!manager) {
            return NextResponse.json({ error: "Manager not found" }, { status: 404 });
        }

        const writerIds = manager.teamMembers.map((w) => w.id);
        if (writerIds.length === 0) {
            return NextResponse.json({ writerCases: [] });
        }

        // Fetch cases whose writers match AND have at least one subtask done in the week.
        // We then filter in code to only keep cases where the SPECIFIC subtasks
        // (Scripting - First Draft  OR  Script Revision R1/R2/…) have dateDone in the week.
        const cases = await prisma.case.findMany({
            where: {
                writerUserId: { in: writerIds },
                subtasks: {
                    some: { dateDone: { gte: weekStart, lte: weekEnd } },
                },
            },
            include: {
                writer: { select: { id: true, name: true } },
                subtasks: {
                    orderBy: [
                        { orderIndex: "asc" },
                        { dateCreated: "asc" },
                    ],
                },
            },
            orderBy: { dateCreated: "asc" },
        });

        // Keep only cases where the First Draft OR Revision subtask was completed this week
        const filteredCases = cases.filter((c) => {
            const firstDraftSub = c.subtasks.find(s => isWriterFirstDraftMilestone(s.name));
            const revisionSub   = c.subtasks.find(s => isRevisionSubtask(s.name));
            const fdInWeek  = firstDraftSub?.dateDone != null &&
                firstDraftSub.dateDone >= weekStart && firstDraftSub.dateDone <= weekEnd;
            const revInWeek = revisionSub?.dateDone != null &&
                revisionSub.dateDone >= weekStart && revisionSub.dateDone <= weekEnd;
            return fdInWeek || revInWeek;
        });

        const writerCases = filteredCases.map((c) => {
            const firstDraftSub = c.subtasks.find(s => isWriterFirstDraftMilestone(s.name)) ?? null;
            const revisionSub   = c.subtasks.find(s => isRevisionSubtask(s.name))   ?? null;

            // Only include TAT for the subtask completed IN THIS WEEK
            const fdInWeek  = !!firstDraftSub?.dateDone &&
                firstDraftSub.dateDone >= weekStart && firstDraftSub.dateDone <= weekEnd;
            const revInWeek = !!revisionSub?.dateDone &&
                revisionSub.dateDone >= weekStart && revisionSub.dateDone <= weekEnd;

            let tatFirstDraft = "N/A";
            if (fdInWeek && firstDraftSub) {
                const t = resolveSubtaskTat(firstDraftSub) ||
                    (firstDraftSub.dateDone && c.caseStartDate
                        ? formatTatDays(calcBusinessDaysTat(c.caseStartDate, firstDraftSub.dateDone))
                        : "");
                tatFirstDraft = t || "N/A";
            }

            let tatRevision = "N/A";
            if (revInWeek && revisionSub) {
                const t = resolveSubtaskTat(revisionSub) ||
                    (revisionSub.dateDone && firstDraftSub?.dateDone
                        ? formatTatDays(calcBusinessDaysTat(firstDraftSub.dateDone, revisionSub.dateDone))
                        : "");
                tatRevision = t || "N/A";
            }

            const isHero = !!(
                c.caseType?.toLowerCase().includes("hero") ||
                c.name?.toLowerCase().includes("hero")
            );

            return {
                writerId:     c.writer?.id ?? null,
                writerName:   c.writer?.name ?? "",
                caseName:     c.name,
                caseStatus:   c.status ?? "",
                heroCase:     isHero ? "yes" : "no",
                tatFirstDraft,
                tatRevision,
                qualityScore:
                    c.writerQualityScore !== null && c.writerQualityScore !== undefined
                        ? String(c.writerQualityScore)
                        : "N/A",
            };
        });

        return NextResponse.json({ writerCases });
    } catch (error) {
        return serverError(error, "writer-cases");
    }
}
