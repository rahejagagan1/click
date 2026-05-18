import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth , serverError } from "@/lib/api-auth";
import { getManagerReportFormat, isManagerReportEligible } from "@/lib/reports/manager-report-format";
import { resolveReportTeamWithSource } from "@/lib/reports/team-snapshot";

export const dynamic = 'force-dynamic';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ managerId: string }> }
) {
    try {
        const { session, errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;


        const { managerId: managerIdRaw } = await params;
        const managerId = parseInt(managerIdRaw);
        if (isNaN(managerId)) {
            return NextResponse.json({ error: "Invalid manager ID" }, { status: 400 });
        }

        // Access check: admins/CEOs can view any report; others only their own or
        // reports they've been granted access to via UserReportAccess
        const requestingUser = session!.user as any;
        const isFullAccess =
            requestingUser.orgLevel === "ceo" ||
            requestingUser.orgLevel === "special_access" ||
            requestingUser.isDeveloper === true;

        if (!isFullAccess) {
            const isSelf = requestingUser.dbId === managerId;
            if (!isSelf) {
                // Check UserReportAccess grant
                const grant = await prisma.$queryRaw`
                    SELECT 1 FROM "UserReportAccess"
                    WHERE "userId" = ${requestingUser.dbId} AND "managerId" = ${managerId}
                    LIMIT 1
                ` as any[];
                if (!grant.length) {
                    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
                }
            }
        }

        // Get manager info (raw so reportAccess works before prisma client is regenerated)
        const rows = await prisma.$queryRaw`
            SELECT id, name, email, role, "orgLevel", "profilePictureUrl", "reportAccess"
            FROM "User" WHERE id = ${managerId} LIMIT 1
        ` as any[];
        const row = rows[0] ?? null;

        if (!row) {
            return NextResponse.json({ error: "Manager not found" }, { status: 404 });
        }

        const manager = {
            ...row,
            reportFormat: getManagerReportFormat(row),
            reportEligible: isManagerReportEligible(row),
        };

        // Period-aware team lookup. When the caller passes ?month=&year=
        // (monthly view) or ?week=&month=&year= (weekly view), prefer the
        // frozen teamSnapshot on the matching locked report so historical
        // reports keep showing who was on the team that period. Without
        // those params, fall back to the current live team (used by the
        // sidebar / manager-list views that are NOT scoped to a period).
        const monthParam = request.nextUrl.searchParams.get("month");
        const yearParam  = request.nextUrl.searchParams.get("year");
        const weekParam  = request.nextUrl.searchParams.get("week");
        const monthNum = monthParam !== null ? parseInt(monthParam) : NaN;
        const yearNum  = yearParam  !== null ? parseInt(yearParam)  : NaN;
        const weekNum  = weekParam  !== null ? parseInt(weekParam)  : NaN;

        let team;
        let teamSource: "snapshot" | "live" = "live";
        if (!isNaN(weekNum) && !isNaN(monthNum) && !isNaN(yearNum)) {
            const r = await resolveReportTeamWithSource(managerId, { kind: "weekly", week: weekNum, month: monthNum, year: yearNum });
            team = r.team;
            teamSource = r.source;
        } else if (!isNaN(monthNum) && !isNaN(yearNum)) {
            const r = await resolveReportTeamWithSource(managerId, { kind: "monthly", month: monthNum, year: yearNum });
            team = r.team;
            teamSource = r.source;
        } else {
            // No period passed — live team query (sidebar / manager list).
            // Returns the same shape + `email` (kept for back-compat).
            const rows = await prisma.user.findMany({
                where: { managerId: managerId, isActive: true },
                select: {
                    id: true, name: true, email: true,
                    role: true, orgLevel: true, profilePictureUrl: true,
                },
                orderBy: { name: "asc" },
            });
            team = rows;
            teamSource = "live";
        }

        return NextResponse.json({ manager, teamMembers: team, teamSource });
    } catch (error) {
        return serverError(error, "route");
    }
}
