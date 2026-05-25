import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth , serverError } from "@/lib/api-auth";
import { isDeveloperEmail } from "@/lib/hr/notification-policy";

export const dynamic = 'force-dynamic';

// Two callers, two needs:
//
//   GET /api/managers            → manager-tier ONLY (default).
//     Used by the Manager Reports sidebar where listing every
//     employee would balloon the menu.
//
//   GET /api/managers?all=true   → every active user (excludes self
//     is the caller's job).
//     Used by the Reporting Manager dropdown on the employee edit
//     form, where HR explicitly wants to assign anyone — not just
//     someone with a manager role — as a person's reporting line.
export async function GET(req: NextRequest) {
    try {
        const { session, errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;
        const viewer = session?.user as any;
        const { searchParams } = new URL(req.url);
        const all = searchParams.get("all") === "true";

        // Developer invisibility. Two layers:
        //
        //   1. Default mode (Manager Reports sidebar) — hide devs only
        //      from non-dev viewers, so dev accounts can still see each
        //      other in their own UI.
        //   2. all=true mode (Reporting Manager picker) — ALWAYS hide
        //      devs, regardless of viewer. Devs aren't anyone's actual
        //      manager; surfacing their names there pollutes HR's
        //      dropdown with accounts that shouldn't be picked.
        const viewerIsDev = isDeveloperEmail(viewer?.email ?? null);
        const devEmails = (process.env.DEVELOPER_EMAILS || "")
            .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
        const hideDev =
            all ? devEmails :
            (!viewerIsDev && devEmails.length > 0 ? devEmails : []);

        // Mirror of src/lib/access.ts:isPickableAsManager — kept here
        // as the server-side gate so a tampered client can't sneak in
        // a non-manager when `all` isn't set. Cast through `any` because
        // Prisma generates enum-typed `OrgLevel` literals and the typed
        // client may lag on the dev box (Windows DLL lock blocks regen).
        const managerWhere: any = {
            OR: [
                { orgLevel: { in: ["hod", "manager"] } },
                { role: { in: [
                    "manager",
                    "production_manager",
                    "researcher_manager",
                    "hr_manager",
                ] } },
            ],
        };

        const users = await prisma.user.findMany({
            where: {
                isActive: true,
                // The default flavour filters to manager-tier roles.
                // When `?all=true` we drop the role/orgLevel gate so
                // every active user is returned — used by the Edit
                // Profile form's Reporting Manager dropdown.
                ...(all ? {} : managerWhere),
                ...(hideDev.length > 0 ? { NOT: { email: { in: hideDev } } } : {}),
            },
            orderBy: { name: "asc" },
            select: {
                id: true,
                name: true,
                orgLevel: true,
                role: true,
            },
        });

        return NextResponse.json(users);
    } catch (error) {
        return serverError(error, "route");
    }
}
