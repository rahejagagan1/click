import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth , serverError } from "@/lib/api-auth";

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        // Anyone who could plausibly be picked as a Reporting / Inline
        // Manager. The previous filter was too narrow (missed CEO,
        // special_access, leads, sub-leads, and anyone whose orgLevel
        // hadn't been bumped above "member" but who already has direct
        // reports). HR explicitly picks managers, so the dropdown
        // should err on the side of "show enough".
        const managers = await prisma.user.findMany({
            where: {
                isActive: true,
                OR: [
                    { orgLevel: { in: ["ceo", "special_access", "hod", "manager", "hr_manager", "lead", "sub_lead"] } },
                    { role: { in: ["admin", "production_manager", "researcher_manager", "hr_manager", "lead", "sub_lead", "manager"] } },
                    { teamMembers: { some: {} } },   // already managing somebody
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
