import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth , serverError } from "@/lib/api-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { inviteUserToClickup } from "@/lib/clickup/invite";

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
        const {
            name, email, role, orgLevel, clickupUserId, teamCapsule, managerId,
            inviteToClickup,            // boolean: if true, invite via ClickUp API first
            profile,                    // optional EmployeeProfile payload
            shiftId,                    // optional UserShift assignment
            leaveBalances,              // optional: [{ leaveTypeId, totalDays }] for current year
        } = body;

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

        // ── ClickUp invite (best-effort) ─────────────────────────────────
        // If requested, invite the user to the ClickUp workspace by email
        // and use the real id they hand back. If the caller also supplied
        // an explicit clickupUserId, we prefer ClickUp's response since it's
        // authoritative. Failures here abort the whole create — otherwise
        // we'd leave a local row with no ClickUp backing.
        let resolvedClickupId: bigint;
        let clickupInviteNote: string | undefined;
        if (inviteToClickup) {
            try {
                const invited = await inviteUserToClickup(email, {
                    admin: role === "admin" || orgLevel === "ceo",
                });
                resolvedClickupId = invited.clickupUserId;
                clickupInviteNote = `Invited to ClickUp as ${invited.username} (${invited.email})`;
            } catch (e: any) {
                return NextResponse.json(
                    { error: `ClickUp invite failed: ${e?.message || "unknown"}` },
                    { status: 502 }
                );
            }
        } else {
            resolvedClickupId = clickupUserId ? BigInt(clickupUserId) : BigInt(Date.now());
        }

        // ── Local create, wrapped so profile + shift + balances ride along ─
        const user = await prisma.$transaction(async (tx) => {
            const created = await tx.user.create({
                data: {
                    name,
                    email,
                    role: role || "member",
                    orgLevel: orgLevel || "member",
                    clickupUserId: resolvedClickupId,
                    teamCapsule: resolvedCapsule,
                    managerId: managerId || null,
                },
            });

            if (profile && typeof profile === "object") {
                const employeeId = profile.employeeId || `NB-${new Date().getFullYear()}-${String(created.id).padStart(4, "0")}`;
                await tx.employeeProfile.create({
                    data: {
                        userId:           created.id,
                        employeeId,
                        designation:      profile.designation      ?? null,
                        department:       profile.department       ?? null,
                        employmentType:   profile.employmentType   ?? "fulltime",
                        workLocation:     profile.workLocation     ?? "office",
                        joiningDate:      profile.joiningDate      ? new Date(profile.joiningDate) : null,
                        phone:            profile.phone            ?? null,
                        dateOfBirth:      profile.dateOfBirth      ? new Date(profile.dateOfBirth) : null,
                        gender:           profile.gender           ?? null,
                        bloodGroup:       profile.bloodGroup       ?? null,
                        emergencyContact: profile.emergencyContact ?? null,
                        emergencyPhone:   profile.emergencyPhone   ?? null,
                        address:          profile.address          ?? null,
                        city:             profile.city             ?? null,
                        state:            profile.state            ?? null,
                        noticePeriodDays: Number.isFinite(profile.noticePeriodDays) ? profile.noticePeriodDays : 30,
                    },
                });
            }

            if (shiftId) {
                await tx.userShift.create({
                    data: { userId: created.id, shiftId: Number(shiftId) },
                });
            }

            if (Array.isArray(leaveBalances) && leaveBalances.length > 0) {
                const year = new Date().getFullYear();
                for (const lb of leaveBalances) {
                    if (!lb?.leaveTypeId) continue;
                    await tx.leaveBalance.create({
                        data: {
                            userId:      created.id,
                            leaveTypeId: Number(lb.leaveTypeId),
                            year,
                            totalDays:   lb.totalDays ?? 0,
                        },
                    });
                }
            }

            return created;
        });

        return NextResponse.json({ ...serializeBigInt(user), clickupInviteNote });
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
