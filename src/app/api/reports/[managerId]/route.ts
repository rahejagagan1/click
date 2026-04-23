import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth , serverError } from "@/lib/api-auth";
import { getManagerReportFormat, isManagerReportEligible } from "@/lib/reports/manager-report-format";

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

        // Get team members under this manager
        const teamMembers = await prisma.user.findMany({
            where: { managerId: managerId, isActive: true },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                orgLevel: true,
                profilePictureUrl: true,
            },
            orderBy: { name: "asc" },
        });

        return NextResponse.json({ manager, teamMembers });
    } catch (error) {
        return serverError(error, "route");
    }
}
