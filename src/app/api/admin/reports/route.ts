import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";

// Mirrors src/lib/access.ts:canSeeReports — full admin tier + manager
// tier (CMs / HoDs / HR Manager) can read the org-wide report list
// because that's who the dashboard panel is for. Without this any
// authenticated user could enumerate every manager's reports.
function canSeeReports(u: any): boolean {
    return (
        u?.orgLevel === "ceo" ||
        u?.isDeveloper === true ||
        u?.orgLevel === "special_access" ||
        u?.role === "admin" ||
        u?.orgLevel === "hr_manager" ||
        u?.orgLevel === "manager" ||
        u?.orgLevel === "hod"
    );
}

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
];

export async function GET(_req: NextRequest) {
    try {
        const { session, errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;
        if (!canSeeReports(session!.user)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

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
