import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth , serverError } from "@/lib/api-auth";

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        const managers = await prisma.user.findMany({
            where: {
                isActive: true,
                OR: [
                    { orgLevel: { in: ["hod", "manager", "hr_manager"] } },
                    { role: { in: ["production_manager", "researcher_manager", "hr_manager"] } },
                    { AND: [{ role: "qa" }, { orgLevel: { in: ["manager", "hod"] } }] },
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
