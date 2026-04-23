import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { getMonthlyReportWindow } from "@/lib/reports/monthly-window";

export const dynamic = "force-dynamic";

type Params = Promise<{ managerId: string; month: string }>;
// Reporting window: 4th of month M through end of day 3 of month M+1. See
// src/lib/reports/monthly-window.ts for the canonical definition.

export async function GET(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;


        const { managerId: managerIdRaw, month: monthRaw } = await params;
        const managerId = parseInt(managerIdRaw);
        const monthIndex = parseInt(monthRaw); // 0-based
        const year = parseInt(req.nextUrl.searchParams.get("year") ?? "");

        if (isNaN(managerId) || isNaN(monthIndex) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        const { windowStart, windowEnd } = getMonthlyReportWindow(year, monthIndex);

        // Get all team members (editors + writers) under this manager
        const manager = await prisma.user.findUnique({
            where: { id: managerId },
            include: {
                teamMembers: {
                    where: {
                        role: { in: ["editor", "writer"] },
                        isActive: true,
                    },
                    select: { id: true, name: true, role: true },
                },
            },
        });

        if (!manager) {
            return NextResponse.json({ error: "Manager not found" }, { status: 404 });
        }

        const editorIds = manager.teamMembers.filter((m) => m.role === "editor").map((m) => m.id);
        const writerIds = manager.teamMembers.filter((m) => m.role === "writer").map((m) => m.id);

        if (editorIds.length === 0 && writerIds.length === 0) {
            return NextResponse.json({
                editorStats: {}, writerStats: {},
                editorCases: {}, writerCases: {},
            });
        }

        // Find the Editing/Scripting subtasks finished in this month (with grace)
        const [editingSubtasks, scriptingSubtasks] = await Promise.all([
            editorIds.length
                ? prisma.subtask.findMany({
                    where: {
                        name: { contains: "Editing", mode: "insensitive" },
                        status: { in: ["done", "complete", "closed"] },
                        dateDone: { gte: windowStart, lte: windowEnd },
                    },
                    select: { caseId: true },
                })
                : Promise.resolve([] as { caseId: number }[]),
            writerIds.length
                ? prisma.subtask.findMany({
                    where: {
                        name: { contains: "Scripting", mode: "insensitive" },
                        status: { in: ["done", "complete", "closed"] },
                        dateDone: { gte: windowStart, lte: windowEnd },
                    },
                    select: { caseId: true },
                })
                : Promise.resolve([] as { caseId: number }[]),
        ]);

        const editorCaseIds = [...new Set(editingSubtasks.map((s) => s.caseId))];
        const writerCaseIds = [...new Set(scriptingSubtasks.map((s) => s.caseId))];

        const [editorCaseRows, writerCaseRows] = await Promise.all([
            editorCaseIds.length
                ? prisma.case.findMany({
                    where: { id: { in: editorCaseIds }, editorUserId: { in: editorIds } },
                    select: { id: true, name: true, editorUserId: true },
                    orderBy: { name: "asc" },
                })
                : Promise.resolve([] as { id: number; name: string; editorUserId: number | null }[]),
            writerCaseIds.length
                ? prisma.case.findMany({
                    where: { id: { in: writerCaseIds }, writerUserId: { in: writerIds } },
                    select: { id: true, name: true, writerUserId: true },
                    orderBy: { name: "asc" },
                })
                : Promise.resolve([] as { id: number; name: string; writerUserId: number | null }[]),
        ]);

        // Group case names per editor / writer
        const editorCases: Record<number, { id: number; name: string }[]> = {};
        const writerCases: Record<number, { id: number; name: string }[]> = {};

        for (const c of editorCaseRows) {
            if (c.editorUserId == null) continue;
            (editorCases[c.editorUserId] ??= []).push({ id: c.id, name: c.name });
        }
        for (const c of writerCaseRows) {
            if (c.writerUserId == null) continue;
            (writerCases[c.writerUserId] ??= []).push({ id: c.id, name: c.name });
        }

        // Build count maps from the case lists so count and names always agree.
        const editorStats: Record<number, number> = {};
        const writerStats: Record<number, number> = {};
        for (const [uid, list] of Object.entries(editorCases)) editorStats[Number(uid)] = list.length;
        for (const [uid, list] of Object.entries(writerCases)) writerStats[Number(uid)] = list.length;

        return NextResponse.json({ editorStats, writerStats, editorCases, writerCases });
    } catch (error) {
        return serverError(error, "contributor-stats");
    }
}
