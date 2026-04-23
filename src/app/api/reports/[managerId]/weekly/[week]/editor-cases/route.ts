import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { calcBusinessDaysTat, formatTatDays } from "@/lib/utils";
import { getWeeklyReportPeriod } from "@/lib/reports/weekly-period";

export const dynamic = "force-dynamic";

type Params = Promise<{ managerId: string; week: string }>;
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

/** Match subtask names for the first editing pass */
function isEditingSubtask(name: string): boolean {
    const n = name.toLowerCase();
    return (
        n === "editing" ||
        n === "video editing" ||
        (n.includes("edit") && !n.includes("revision") && !n.includes("script") && !n.includes("re-edit"))
    );
}

/** Match subtask names for editing revision */
function isEditingRevisionSubtask(name: string): boolean {
    const n = name.toLowerCase();
    return (
        (n.includes("edit") && n.includes("revision")) ||
        n.includes("re-edit") ||
        n === "editing revision" ||
        n.includes("video revision")
    );
}

export async function GET(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;


        const { managerId: managerIdRaw, week: weekRaw } = await params;
        const managerId = parseInt(managerIdRaw);
        const week      = parseInt(weekRaw);
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

        // Editors under this manager
        const manager = await prisma.user.findUnique({
            where: { id: managerId },
            include: {
                teamMembers: {
                    where: { role: "editor", isActive: true },
                    select: { id: true, name: true },
                },
            },
        });

        if (!manager) {
            return NextResponse.json({ error: "Manager not found" }, { status: 404 });
        }

        const editorIds = manager.teamMembers.map((e) => e.id);
        if (editorIds.length === 0) {
            return NextResponse.json({ editorCases: [] });
        }

        // Cases where the editor's subtask (editing or editing revision) was done this week
        const cases = await prisma.case.findMany({
            where: {
                editorUserId: { in: editorIds },
                subtasks: {
                    some: { dateDone: { gte: weekStart, lte: weekEnd } },
                },
            },
            include: {
                editor: { select: { id: true, name: true } },
                subtasks: {
                    orderBy: [
                        { orderIndex: "asc" },
                        { dateCreated: "asc" },
                    ],
                },
            },
            orderBy: { dateCreated: "asc" },
        });

        // Keep only cases where the Editing OR Editing Revision subtask was completed this week
        const filteredCases = cases.filter((c) => {
            const editingSub  = c.subtasks.find(s => isEditingSubtask(s.name));
            const revisionSub = c.subtasks.find(s => isEditingRevisionSubtask(s.name));
            const editInWeek  = editingSub?.dateDone != null &&
                editingSub.dateDone >= weekStart && editingSub.dateDone <= weekEnd;
            const revInWeek   = revisionSub?.dateDone != null &&
                revisionSub.dateDone >= weekStart && revisionSub.dateDone <= weekEnd;
            return editInWeek || revInWeek;
        });

        const editorCases = filteredCases.map((c) => {
            const editingSub  = c.subtasks.find(s => isEditingSubtask(s.name))  ?? null;
            const revisionSub = c.subtasks.find(s => isEditingRevisionSubtask(s.name)) ?? null;

            // Only include TAT for the subtask completed IN THIS WEEK
            const editInWeek = !!editingSub?.dateDone &&
                editingSub.dateDone >= weekStart && editingSub.dateDone <= weekEnd;
            const revInWeek  = !!revisionSub?.dateDone &&
                revisionSub.dateDone >= weekStart && revisionSub.dateDone <= weekEnd;

            let tatEditing = "N/A";
            if (editInWeek && editingSub) {
                tatEditing = resolveSubtaskTat(editingSub) || "N/A";
            }

            let tatRevision = "N/A";
            if (revInWeek && revisionSub) {
                const t = resolveSubtaskTat(revisionSub) ||
                    (revisionSub.dateDone && editingSub?.dateDone
                        ? formatTatDays(calcBusinessDaysTat(editingSub.dateDone, revisionSub.dateDone))
                        : "");
                tatRevision = t || "N/A";
            }

            const isHero = !!(
                c.caseType?.toLowerCase().includes("hero") ||
                c.name?.toLowerCase().includes("hero")
            );

            return {
                editorId:   c.editor?.id   ?? null,
                editorName: c.editor?.name ?? "",
                caseName:   c.name,
                caseStatus: c.status ?? "",
                heroCase:   isHero ? "yes" : "no",
                tatEditing,
                tatRevision,
                qualityScore:
                    (c as any).editorQualityScore !== null && (c as any).editorQualityScore !== undefined
                        ? String((c as any).editorQualityScore)
                        : "N/A",
            };
        });

        return NextResponse.json({ editorCases });
    } catch (error) {
        return serverError(error, "editor-cases");
    }
}
