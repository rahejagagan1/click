import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth , serverError } from "@/lib/api-auth";
import { getManagerReportFormat, isManagerReportEligible } from "@/lib/reports/manager-report-format";

export const dynamic = 'force-dynamic';

export async function GET(
    request: NextRequest,
    { params }: { params: { managerId: string } }
) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        const managerId = parseInt(params.managerId);
        if (isNaN(managerId)) {
            return NextResponse.json({ error: "Invalid manager ID" }, { status: 400 });
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
