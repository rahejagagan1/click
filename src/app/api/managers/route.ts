import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth , serverError } from "@/lib/api-auth";

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        // True managers only — used by the "Manager Reports" sidebar
        // and the Reporting/Inline-Manager dropdowns. Past tweaks
        // widened this to include anyone with team members under them
        // (because bulk imports left writers/editors with stale
        // managerId references) and to leads/sub_leads, which polluted
        // the list with regular employees. Lock back down to the
        // explicit manager-tier roles + manager-flavoured orgLevels.
        const managers = await prisma.user.findMany({
            where: {
                isActive: true,
                OR: [
                    { orgLevel: { in: ["ceo", "special_access", "hod", "manager", "hr_manager"] } },
                    { role: { in: [
                        "admin",
                        "manager",
                        "production_manager",
                        "researcher_manager",
                        "hr_manager",
                    ] } },
                ],
            },
            orderBy: { name: "asc" },
            select: {
                id: true,
                name: true,
                orgLevel: true,
                role: true,
            },
        });

        return NextResponse.json(managers);
    } catch (error) {
        return serverError(error, "route");
    }
}
