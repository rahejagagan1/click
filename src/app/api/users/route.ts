import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth , serverError } from "@/lib/api-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = 'force-dynamic';
import { serializeBigInt } from "@/lib/utils";
import { resolveTeamCapsuleForSave } from "@/lib/capsule-matching";

function canManageUsers(session: any): boolean {
    const user = session?.user as any;
    return user?.orgLevel === "ceo" || user?.isDeveloper === true;
}

export async function GET(request: Request) {
    try {
        const { errorResponse } = await requireAuth();
        if (errorResponse) return errorResponse;

        const { searchParams } = new URL(request.url);
        const includeAll = searchParams.get("all") === "true";

        const where: any = { isActive: true };
        if (!includeAll) {
            where.NOT = { role: "member", orgLevel: "member" };
        }

        const users = await prisma.user.findMany({
            where,
            orderBy: [{ role: "asc" }, { name: "asc" }],
            select: {
                id: true,
                clickupUserId: true,
                name: true,
                email: true,
                role: true,
                orgLevel: true,
                managerId: true,
                teamCapsule: true,
                monthlyDeliveryTargetCases: true,
                isActive: true,
                profilePictureUrl: true,
            },
        });

        return NextResponse.json(serializeBigInt(users));
    } catch (error) {
        return serverError(error, "route");
    }
}

// POST: Add new user (CEO / Developer only)
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!canManageUsers(session)) {
            return NextResponse.json({ error: "Only CEO and developers can add users" }, { status: 403 });
        }

        const body = await request.json();
        const { name, email, role, orgLevel, clickupUserId, teamCapsule, managerId } = body;

        if (!name || !email) {
            return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
        }

        let resolvedCapsule: string | null = null;
        if (teamCapsule !== undefined && teamCapsule !== null && String(teamCapsule).trim() !== "") {
            const resolved = await resolveTeamCapsuleForSave(teamCapsule);
            if (!resolved.ok) {
                return NextResponse.json({ error: resolved.error }, { status: 400 });
            }
            resolvedCapsule = resolved.value;
        }

        const user = await prisma.user.create({
            data: {
                name,
                email,
                role: role || "member",
                orgLevel: orgLevel || "member",
                clickupUserId: clickupUserId ? BigInt(clickupUserId) : BigInt(Date.now()),
                teamCapsule: resolvedCapsule,
                managerId: managerId || null,
            },
        });

        return NextResponse.json(serializeBigInt(user));
    } catch (error: any) {
        if (error.code === "P2002") {
            return NextResponse.json({ error: "User with this email or ClickUp ID already exists" }, { status: 409 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// DELETE: Remove user (CEO / Developer only)
export async function DELETE(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!canManageUsers(session)) {
            return NextResponse.json({ error: "Only CEO and developers can delete users" }, { status: 403 });
        }

        const { id } = await request.json();
        await prisma.user.delete({
            where: { id },
        });

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
