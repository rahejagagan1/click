import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth , serverError } from "@/lib/api-auth";

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        // True report-OWNERS only — used by the "Manager Reports"
        // sidebar and the Reporting/Inline-Manager dropdowns.
        //
        // Excluded on purpose:
        //   • orgLevel "ceo" / "special_access" — they VIEW reports
        //     but don't submit any, so their names must not appear in
        //     the picker.
        //   • role "admin" — same reason.
        //   • orgLevel "hr_manager" — the org-tree dropdown's "HR"
        //     option maps every HR employee (including Members) to this
        //     orgLevel, so it would pollute the list with non-managers.
        //     The real HR Manager (Tanvi) is matched via role=hr_manager
        //     below instead.
        // Mirrors src/lib/access.ts:isPickableAsManager.
        const managers = await prisma.user.findMany({
            where: {
                isActive: true,
                OR: [
                    { orgLevel: { in: ["hod", "manager"] } },
                    { role: { in: [
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
