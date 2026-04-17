import { NextResponse } from "next/server";
import { requireAuth, serverError } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Returns the list of manager IDs the current session user has explicit view access to. */
export async function GET() {
    try {
        const { session, errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        const dbId = (session?.user as any)?.dbId;
        if (!dbId) return NextResponse.json({ allowedManagerIds: [] });

        const rows = await prisma.$queryRaw`
            SELECT "managerId" FROM "UserReportAccess"
            WHERE "userId" = ${Number(dbId)}
        ` as { managerId: number }[];

        return NextResponse.json({
            allowedManagerIds: rows.map(r => Number(r.managerId)),
        });
    } catch (error) {
        return serverError(error, "GET /api/user/report-access");
    }
}
