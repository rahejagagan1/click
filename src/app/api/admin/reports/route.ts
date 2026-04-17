import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
];

export async function GET(_req: NextRequest) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        // Fetch weekly reports and monthly reports separately
        const [weeklyReports, monthlyReports] = await Promise.all([
            prisma.weeklyReport.findMany({
                orderBy: [{ year: "desc" }, { month: "desc" }, { week: "desc" }],
                include: { manager: { select: { id: true, name: true, email: true } } },
            }),
            prisma.monthlyReport.findMany({
                orderBy: [{ year: "desc" }, { month: "desc" }],
                include: { manager: { select: { id: true, name: true, email: true } } },
            }),
        ]);

        const formattedWeekly = weeklyReports.map(r => ({
            id:          r.id,
            managerId:   r.managerId,
            managerName: r.manager.name,
            week:        r.week,
            month:       r.month,
            year:        r.year,
            isMonthly:   false,
            period:      `${MONTH_NAMES[r.month]} ${r.year} — Week ${r.week}`,
            viewUrl:     `/dashboard/reports/${r.managerId}/weekly/${r.week}?month=${r.month}`,
            isLocked:    r.isLocked,
            submittedAt: r.submittedAt,
        }));

        const formattedMonthly = monthlyReports.map(r => ({
            id:          r.id,
            managerId:   r.managerId,
            managerName: r.manager.name,
            week:        0,
            month:       r.month,
            year:        r.year,
            isMonthly:   true,
            period:      `${MONTH_NAMES[r.month]} ${r.year} — Monthly Report`,
            viewUrl:     `/dashboard/reports/${r.managerId}/monthly/${r.month}`,
            isLocked:    r.isLocked,
            submittedAt: r.submittedAt,
        }));

        // Merge and sort by date descending
        const all = [...formattedWeekly, ...formattedMonthly].sort((a, b) =>
            b.year - a.year || b.month - a.month || b.week - a.week
        );

        return NextResponse.json(all);
    } catch (error) {
        return serverError(error, "admin/reports GET");
    }
}
