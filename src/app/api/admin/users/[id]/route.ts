import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolveTeamCapsuleForSave } from "@/lib/capsule-matching";
import { requireAdmin, serverError } from "@/lib/api-auth";

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { errorResponse } = await requireAdmin();
    if (errorResponse) return errorResponse;


        const { id: idRaw } = await params;
    try {
        const id = parseInt(idRaw);
        if (isNaN(id)) {
            return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
        }

        const body = await request.json();
        const updateData: any = {};

        if (body.role !== undefined) updateData.role = body.role;
        if (body.orgLevel !== undefined) updateData.orgLevel = body.orgLevel;
        if (body.managerId !== undefined) {
            updateData.managerId = body.managerId === null ? null : parseInt(body.managerId);
        }
        if (body.monthlyDeliveryTargetCases !== undefined) {
            const v = body.monthlyDeliveryTargetCases;
            updateData.monthlyDeliveryTargetCases =
                v === null || v === "" ? null : Math.max(0, parseInt(String(v), 10) || 0);
        }
        if (body.teamCapsule !== undefined) {
            const resolved = await resolveTeamCapsuleForSave(body.teamCapsule);
            if (!resolved.ok) {
                return NextResponse.json({ error: resolved.error }, { status: 400 });
            }
            updateData.teamCapsule = resolved.value;
        }

        const user = await prisma.user.update({
            where: { id },
            data: updateData,
            select: {
                id: true,
                name: true,
                role: true,
                orgLevel: true,
                managerId: true,
                manager: { select: { id: true, name: true } },
            },
        });

        return NextResponse.json(user);
    } catch (error) {
        return serverError(error, "admin/users/[id] PATCH");
    }
}
