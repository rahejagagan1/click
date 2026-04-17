import { serverError } from "@/lib/api-auth";
import { type NextRequest } from "next/server";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getVisibleUserIds } from "@/lib/access-control";
import { serializeBigInt } from "@/lib/utils";

export const dynamic = "force-dynamic";

// GET: All visible users grouped by role for the score hub
export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const sessionUser = session.user as any;

        // Dev mode or CEO/special_access: show all users
        let visibleIds: number[] | null = null;
        if (sessionUser.dbId && sessionUser.orgLevel) {
            visibleIds = await getVisibleUserIds(
                sessionUser.dbId,
                sessionUser.orgLevel
            );
        }

        const where: any = { isActive: true, NOT: { role: "member", orgLevel: "member" } };
        if (visibleIds !== null) {
            where.id = { in: visibleIds };
        }

        const users = await prisma.user.findMany({
            where,
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
            orderBy: [{ orgLevel: "asc" }, { name: "asc" }],
        });

        // Get all available months for the month picker
        const userIds = users.map((u) => u.id);
        const distinctMonths = await prisma.monthlyRating.findMany({
            where: { userId: { in: userIds } },
            select: { month: true },
            distinct: ["month"],
            orderBy: { month: "desc" },
        });
        const availableMonths = distinctMonths.map((m) => {
            const d = new Date(m.month);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        });

        // Parse optional month filter from query params
        const monthParam = request.nextUrl.searchParams.get("month"); // e.g. "2026-02"
        const ratingWhere: any = { userId: { in: userIds } };
        if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
            const [year, mon] = monthParam.split("-").map(Number);
            const start = new Date(year, mon - 1, 1);
            const end = new Date(year, mon, 1);
            ratingWhere.month = { gte: start, lt: end };
        }

        // Get ratings (filtered by month if provided, otherwise latest)
        const latestRatings = await prisma.monthlyRating.findMany({
            where: ratingWhere,
            orderBy: { month: "desc" },
            ...(monthParam ? {} : { distinct: ["userId", "roleType"] as const }),
            select: {
                userId: true,
                roleType: true,
                overallRating: true,
                month: true,
                rankInRole: true,
            },
        });

        // Group users by role
        const roleGroups: Record<string, any[]> = {};
        for (const user of users) {
            const role = user.role;
            if (!roleGroups[role]) roleGroups[role] = [];
            const userRatings = latestRatings.filter((r) => r.userId === user.id);
            roleGroups[role].push({ ...user, latestRatings: userRatings });
        }

        return NextResponse.json(
            serializeBigInt({
                roleGroups,
                availableMonths,
                currentUser: {
                    dbId: sessionUser.dbId,
                    orgLevel: sessionUser.orgLevel,
                    isDeveloper: sessionUser.isDeveloper || false,
                },
            })
        );
    } catch (error) {
        console.error("Scores hub API error:", error);
        return serverError(error, "route");
    }
}
