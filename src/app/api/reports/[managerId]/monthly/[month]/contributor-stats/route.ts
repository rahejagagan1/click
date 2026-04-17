import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type Params = { managerId: string; month: string };

export async function GET(req: NextRequest, { params }: { params: Params }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        const managerId = parseInt(params.managerId);
        const monthIndex = parseInt(params.month); // 0-based
        const year = parseInt(req.nextUrl.searchParams.get("year") ?? "");

        if (isNaN(managerId) || isNaN(monthIndex) || isNaN(year)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }

        // MonthlyRating.month is a calendar month (DATE). Use a half-open UTC range so we
        // match rows whether they were written with Date.UTC or local midnight (legacy sync).
        const monthStartUtc = new Date(Date.UTC(year, monthIndex, 1));
        const monthEndUtc   = new Date(Date.UTC(year, monthIndex + 1, 1));

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

        const memberIds = manager.teamMembers.map((m) => m.id);

        if (memberIds.length === 0) {
            return NextResponse.json({ editorStats: {}, writerStats: {} });
        }

        // Fetch MonthlyRating records for these users in the given month
        const ratings = await prisma.monthlyRating.findMany({
            where: {
                userId:   { in: memberIds },
                month:    { gte: monthStartUtc, lt: monthEndUtc },
                roleType: { in: ["editor", "writer"] },
            },
            select: {
                userId:         true,
                roleType:       true,
                casesCompleted: true,
            },
        });

        // Build lookup maps: userId → casesCompleted
        const editorStats: Record<number, number> = {};
        const writerStats: Record<number, number> = {};

        for (const r of ratings) {
            if (r.roleType === "editor") editorStats[r.userId] = r.casesCompleted;
            if (r.roleType === "writer") writerStats[r.userId] = r.casesCompleted;
        }

        return NextResponse.json({ editorStats, writerStats });
    } catch (error) {
        return serverError(error, "contributor-stats");
    }
}
