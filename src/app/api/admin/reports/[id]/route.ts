import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/* PATCH — toggle lock/unlock */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        const id = parseInt(params.id);
        if (isNaN(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

        const { isLocked, isMonthly } = await req.json();

        if (isMonthly) {
            const report = await prisma.monthlyReport.update({
                where: { id },
                data:  { isLocked },
            });
            return NextResponse.json({ success: true, id: report.id, isLocked: report.isLocked });
        } else {
            const report = await prisma.weeklyReport.update({
                where: { id },
                data:  { isLocked },
            });
            return NextResponse.json({ success: true, id: report.id, isLocked: report.isLocked });
        }
    } catch (error) {
        return serverError(error, "admin/reports/[id] PATCH");
    }
}
