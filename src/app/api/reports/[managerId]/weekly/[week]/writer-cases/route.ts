import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { calcBusinessDaysTat, formatTatDays } from "@/lib/utils";
import { getWeeklyReportPeriod } from "@/lib/reports/weekly-period";
import { isWriterFirstDraftMilestone } from "@/lib/clickup/subtask-milestones";
import { resolveReportTeam } from "@/lib/reports/team-snapshot";

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

        // Writers under this manager — prefer the locked report's team
        // snapshot so writers who later moved managers still appear
        // under the week when they actually did the work.
        const manager = await prisma.user.findUnique({ where: { id: managerId }, select: { id: true } });
        if (!manager) {
            return NextResponse.json({ error: "Manager not found" }, { status: 404 });
        }
        const team = await resolveReportTeam(managerId, { kind: "weekly", week, month, year });
        const writers = team.filter((m) => m.role === "writer");
        const writerIds = writers.map((m) => m.id);
        if (writerIds.length === 0) {
            return NextResponse.json({ writerCases: [] });
        }
        const writerIdSet = new Set(writerIds);
        const writerNameById = new Map(writers.map((w) => [w.id, w.name]));

        // Pull every case that has a milestone subtask completed in the
        // week and is connected to a team writer through one of three
        // routes (most-truthful first): the subtask's assignee join
        // table, the subtask's legacy single assignee, or the case's
        // primary writerUserId. We then dedupe per (case × writer) in
        // code so every assigned writer gets their own row.
        const cases = await prisma.case.findMany({
            where: {
                subtasks: { some: { dateDone: { gte: weekStart, lte: weekEnd } } },
                OR: [
                    { subtasks: { some: { dateDone: { gte: weekStart, lte: weekEnd }, assignees: { some: { userId: { in: writerIds } } } } } },
                    { subtasks: { some: { dateDone: { gte: weekStart, lte: weekEnd }, assigneeUserId: { in: writerIds } } } },
                    { writerUserId: { in: writerIds } },
                ],
            },
            include: {
                writer: { select: { id: true, name: true } },
                subtasks: {
                    orderBy: [
                        { orderIndex: "asc" },
                        { dateCreated: "asc" },
                    ],
                    include: {
                        assignees: { select: { userId: true, user: { select: { name: true } } } },
                    },
                },
            },
            orderBy: { dateCreated: "asc" },
        });

        const writerCases: any[] = [];

        for (const c of cases) {
            const firstDraftSub = c.subtasks.find((s) => isWriterFirstDraftMilestone(s.name)) ?? null;
            const revisionSub   = c.subtasks.find((s) => isRevisionSubtask(s.name))   ?? null;

            const fdInWeek = !!firstDraftSub?.dateDone &&
                firstDraftSub.dateDone >= weekStart && firstDraftSub.dateDone <= weekEnd;
            const revInWeek = !!revisionSub?.dateDone &&
                revisionSub.dateDone >= weekStart && revisionSub.dateDone <= weekEnd;
            if (!fdInWeek && !revInWeek) continue;

            // Per-milestone assignee resolution (in team only).
            // Priority: SubtaskAssignee → Subtask.assigneeUserId → Case.writerUserId.
            const fdAssignees = new Set<number>();
            if (fdInWeek && firstDraftSub) {
                for (const a of firstDraftSub.assignees) {
                    if (writerIdSet.has(a.userId)) {
                        fdAssignees.add(a.userId);
                        if (a.user?.name) writerNameById.set(a.userId, a.user.name);
                    }
                }
                if (fdAssignees.size === 0 && firstDraftSub.assigneeUserId && writerIdSet.has(firstDraftSub.assigneeUserId)) {
                    fdAssignees.add(firstDraftSub.assigneeUserId);
                }
                if (fdAssignees.size === 0 && c.writerUserId && writerIdSet.has(c.writerUserId)) {
                    fdAssignees.add(c.writerUserId);
                }
            }
            const revAssignees = new Set<number>();
            if (revInWeek && revisionSub) {
                for (const a of revisionSub.assignees) {
                    if (writerIdSet.has(a.userId)) {
                        revAssignees.add(a.userId);
                        if (a.user?.name) writerNameById.set(a.userId, a.user.name);
                    }
                }
                if (revAssignees.size === 0 && revisionSub.assigneeUserId && writerIdSet.has(revisionSub.assigneeUserId)) {
                    revAssignees.add(revisionSub.assigneeUserId);
                }
                if (revAssignees.size === 0 && c.writerUserId && writerIdSet.has(c.writerUserId)) {
                    revAssignees.add(c.writerUserId);
                }
            }

            const credited = new Set<number>([...fdAssignees, ...revAssignees]);
            if (credited.size === 0) continue;

            let tatFirstDraftCase = "N/A";
            if (fdInWeek && firstDraftSub) {
                const t = resolveSubtaskTat(firstDraftSub) ||
                    (firstDraftSub.dateDone && c.caseStartDate
                        ? formatTatDays(calcBusinessDaysTat(c.caseStartDate, firstDraftSub.dateDone))
                        : "");
                tatFirstDraftCase = t || "N/A";
            }
            let tatRevisionCase = "N/A";
            if (revInWeek && revisionSub) {
                const t = resolveSubtaskTat(revisionSub) ||
                    (revisionSub.dateDone && firstDraftSub?.dateDone
                        ? formatTatDays(calcBusinessDaysTat(firstDraftSub.dateDone, revisionSub.dateDone))
                        : "");
                tatRevisionCase = t || "N/A";
            }

            const isHero = !!(
                c.caseType?.toLowerCase().includes("hero") ||
                c.name?.toLowerCase().includes("hero")
            );
            const qualityScore =
                c.writerQualityScore !== null && c.writerQualityScore !== undefined
                    ? String(c.writerQualityScore)
                    : "N/A";

            for (const wid of credited) {
                const onFd  = fdAssignees.has(wid);
                const onRev = revAssignees.has(wid);
                const subtaskName =
                    (onFd  && firstDraftSub?.name) ||
                    (onRev && revisionSub?.name)   || "";

                writerCases.push({
                    writerId:     wid,
                    writerName:   writerNameById.get(wid) ?? (c.writer?.id === wid ? c.writer?.name : "") ?? "",
                    caseName:     c.name,
                    caseStatus:   c.status ?? "",
                    heroCase:     isHero ? "yes" : "no",
                    subtaskName,
                    tatFirstDraft: onFd  ? tatFirstDraftCase : "N/A",
                    tatRevision:   onRev ? tatRevisionCase   : "N/A",
                    qualityScore,
                });
            }
        }

        return NextResponse.json({ writerCases });
    } catch (error) {
        return serverError(error, "writer-cases");
    }
}
