import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth , serverError } from "@/lib/api-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sendEmail } from "@/lib/email/sender";
import { welcomeLoginEmail } from "@/lib/email/templates";

export const dynamic = 'force-dynamic';
import { serializeBigInt } from "@/lib/utils";
import { resolveTeamCapsuleForSave } from "@/lib/capsule-matching";

// CEO + developer only — used for destructive actions (DELETE).
// Onboarding employees is gated separately by `canCreateUsers` so HR
// managers / admins / special_access can also onboard.
function canManageUsers(session: any): boolean {
    const user = session?.user as any;
    return user?.orgLevel === "ceo" || user?.isDeveloper === true;
}

// HR-admin tier — mirrors src/lib/access.ts:isHRAdmin so the onboarding
// form (POST /api/users) works for everyone the UI shows the wizard to:
// CEO / developer / special_access / role=admin / orgLevel=hr_manager.
function canCreateUsers(session: any): boolean {
    const user = session?.user as any;
    return (
        user?.orgLevel === "ceo" ||
        user?.isDeveloper === true ||
        user?.orgLevel === "special_access" ||
        user?.role === "admin" ||
        user?.orgLevel === "hr_manager"
    );
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

// POST: Add new user — HR admin tier (CEO / dev / admin / special_access / hr_manager)
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!canCreateUsers(session)) {
            return NextResponse.json({ error: "Only HR managers and admins can add users" }, { status: 403 });
        }

        const body = await request.json();
        const {
            name, email, role, orgLevel, clickupUserId, teamCapsule, managerId,
            inviteToLogin,              // boolean: if true, email a welcome / sign-in link
            enableOnboarding,           // boolean: if true, gate first login behind /onboarding
            profile,                    // optional EmployeeProfile payload
            shiftId,                    // optional UserShift assignment
            leaveBalances,              // optional: [{ leaveTypeId, totalDays }] for current year
            compensation,               // optional SalaryStructure payload (regular | intern)
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

        // ── ClickUp linking (manual flow) ────────────────────────────────
        // Programmatic ClickUp invites require the Enterprise plan, which
        // we're not on. HR invites people through ClickUp's UI; the nightly
        // sync backfills the real ClickUp user-id when the email matches.
        // Until then we use the caller-supplied id, or a synthetic Date.now()
        // placeholder so the column (which is unique-but-nullable in schema)
        // doesn't collide between simultaneous creates.
        const resolvedClickupId: bigint = clickupUserId
            ? BigInt(clickupUserId)
            : BigInt(Date.now());

        // ── Local upsert, wrapped so profile + shift + balances ride along ─
        // We deliberately upsert (not create-only) on email so HR can finish
        // onboarding for someone who already signed in via Google OAuth and
        // therefore already has a thin User row. The HR-supplied data wins
        // wherever it's present, but we don't clobber an existing
        // clickupUserId (the sync may have already linked them).
        const { user, isUpdate } = await prisma.$transaction(async (tx) => {
            const existing = await tx.user.findUnique({
                where: { email },
                select: { id: true, clickupUserId: true },
            });

            const created = existing
                ? await tx.user.update({
                    where: { id: existing.id },
                    data: {
                        name,
                        role: role || undefined,
                        orgLevel: orgLevel || undefined,
                        teamCapsule: resolvedCapsule,
                        managerId: managerId || null,
                        // Only set the synthetic id when nothing real is stored.
                        ...(existing.clickupUserId ? {} : { clickupUserId: resolvedClickupId }),
                    },
                })
                : await tx.user.create({
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

            // Mark new hire for first-login wizard if HR opted in. Done via
            // raw SQL so it works before `prisma generate` has picked up the
            // new column on hot-reloaded dev clients.
            if (enableOnboarding) {
                await tx.$executeRawUnsafe(
                    `UPDATE "User" SET "onboardingPending" = true WHERE id = $1`,
                    created.id,
                );
            }

            if (profile && typeof profile === "object") {
                // Derive firstName / lastName from `name` if the caller didn't
                // supply them — schema requires both.
                const nameParts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
                const firstName = profile.firstName || nameParts[0] || "Unknown";
                const lastName  = profile.lastName  || nameParts.slice(1).join(" ") || "Unknown";
                // Default nationality. numberSeriesId is best-effort: the
                // EmployeeNumberSeries table is the source of truth, but for
                // ad-hoc creates we fall back to the lowest active series id.
                const fallbackSeries = await tx.employeeNumberSeries.findFirst({
                    where: { isActive: true },
                    orderBy: { id: "asc" },
                    select: { id: true },
                });
                const numberSeriesId = profile.numberSeriesId ?? fallbackSeries?.id;
                if (!numberSeriesId) {
                    throw new Error("No active EmployeeNumberSeries — create one before adding employees.");
                }
                // Auto-allocate the employee ID from the chosen series when the
                // caller didn't supply one. The atomic increment-and-return
                // pattern serialises concurrent creates so two new hires can
                // never collide on the same ID.
                // Re-onboard guard: don't burn a series number if the user
                // already has an EmployeeProfile.
                const existingProfile = await tx.employeeProfile.findUnique({
                    where: { userId: created.id },
                    select: { employeeId: true },
                });
                let employeeId: string;
                if (profile.employeeId) {
                    employeeId = String(profile.employeeId).trim();
                } else if (existingProfile?.employeeId) {
                    employeeId = existingProfile.employeeId;
                } else {
                    const bumped = await tx.employeeNumberSeries.update({
                        where: { id: numberSeriesId },
                        data:  { nextNumber: { increment: 1 } },
                        select: { prefix: true, nextNumber: true, isActive: true },
                    });
                    if (!bumped.isActive) {
                        throw new Error("Selected number series is inactive");
                    }
                    const claimed = bumped.nextNumber - 1;
                    employeeId = `${bumped.prefix}${claimed}`;
                }
                const profileData = {
                    employeeId,
                    firstName,
                    lastName,
                    nationality:      profile.nationality      ?? "Indian",
                    numberSeriesId,
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
                };
                await tx.employeeProfile.upsert({
                    where:  { userId: created.id },
                    create: { userId: created.id, ...profileData },
                    update: profileData,
                });
            }

            if (shiftId) {
                await tx.userShift.upsert({
                    where:  { userId: created.id },
                    create: { userId: created.id, shiftId: Number(shiftId) },
                    update: { shiftId: Number(shiftId) },
                });
            }

            if (Array.isArray(leaveBalances) && leaveBalances.length > 0) {
                const now = new Date();
                const year = now.getFullYear();
                // Stamp the joining month so the next monthly accrual job
                // credits +1 Sick Leave at the start of next month — and
                // doesn't retroactively credit months they weren't here for.
                const currentYm = `${year}-${String(now.getMonth() + 1).padStart(2, "0")}`;
                for (const lb of leaveBalances) {
                    if (!lb?.leaveTypeId) continue;
                    await tx.leaveBalance.upsert({
                        where: {
                            userId_leaveTypeId_year: {
                                userId:      created.id,
                                leaveTypeId: Number(lb.leaveTypeId),
                                year,
                            },
                        },
                        create: {
                            userId:      created.id,
                            leaveTypeId: Number(lb.leaveTypeId),
                            year,
                            totalDays:   lb.totalDays ?? 0,
                        },
                        update: { totalDays: lb.totalDays ?? 0 },
                    });
                }
                // Patch lastAccrualMonth via raw SQL — stale typed clients
                // won't know about this column yet.
                await tx.$executeRawUnsafe(
                    `UPDATE "LeaveBalance" SET "lastAccrualMonth" = $1
                       WHERE "userId" = $2 AND year = $3 AND "lastAccrualMonth" IS NULL`,
                    currentYm, created.id, year,
                );
            }

            // ── Salary structure ─────────────────────────────────────────
            // Form sends one of two shapes:
            //   intern  → { salaryType:"intern",  monthlyBasic, effectiveFrom }
            //   regular → { salaryType:"regular", annualCtc, payGroup, ... }
            // We compute breakup components here so they match what the
            // wizard previewed on screen.
            if (compensation && typeof compensation === "object") {
                const effectiveFrom = compensation.effectiveFrom
                    ? new Date(compensation.effectiveFrom)
                    : new Date();
                const isIntern = compensation.salaryType === "intern";
                const monthly  = isIntern
                    ? Number(compensation.monthlyBasic) || 0
                    : (Number(compensation.annualCtc) || 0) / 12;
                const ctc      = isIntern ? monthly * 12 : (Number(compensation.annualCtc) || 0);
                // Interns get a flat stipend → only `basic` is meaningful.
                const basic    = isIntern ? monthly : Math.round(monthly * 0.5);
                const hra      = isIntern ? 0 : Math.round(monthly * 0.2);
                const pfElig   = !isIntern && !!compensation.pfEligible;
                const pfEmp    = pfElig ? Math.min(Math.round(basic * 0.12), 1800) : 0;
                const da       = isIntern ? 0 : Math.round(monthly * 0.10);
                const conv     = isIntern ? 0 : Math.round(monthly * 0.075);
                const med      = isIntern ? 0 : 1250;
                const consumed = basic + hra + da + conv + med + pfEmp;
                const special  = isIntern ? 0 : Math.max(0, Math.round(monthly) - consumed);
                // Typed fields first (those the generated Prisma client knows
                // about). The 6 new columns we just added live in the DB but
                // not in the cached client until `prisma generate` reruns —
                // we patch them via raw SQL right after, so the dev server
                // doesn't need a restart.
                const typedData = {
                    ctc,
                    basic,
                    hra,
                    specialAllowance: special,
                    pfEmployee:    pfEmp,
                    pfEmployer:    pfEmp,
                    esiEmployee:   0,
                    esiEmployer:   0,
                    tds:           0,
                    professionalTax: 0,
                    effectiveFrom,
                };
                await tx.salaryStructure.upsert({
                    where:  { userId: created.id },
                    create: { userId: created.id, ...typedData },
                    update: typedData,
                });
                await tx.$executeRawUnsafe(
                    `UPDATE "SalaryStructure"
                       SET "salaryType"=$1, "payGroup"=$2, "bonusIncluded"=$3,
                           "taxRegime"=$4, "structureType"=$5, "pfEligible"=$6
                     WHERE "userId"=$7`,
                    isIntern ? "intern" : "regular",
                    compensation.payGroup ?? null,
                    !!compensation.bonusIncluded,
                    compensation.taxRegime ?? null,
                    compensation.structureType ?? null,
                    pfElig,
                    created.id,
                );
            }

            return { user: created, isUpdate: !!existing };
        });

        // Persist businessUnit via raw SQL — keeps things working even
        // if the typed Prisma client hasn't been regenerated after the
        // schema change. Same pattern other new columns use here.
        if (profile && typeof profile.businessUnit === "string") {
            try {
                await prisma.$executeRawUnsafe(
                    `UPDATE "EmployeeProfile" SET "businessUnit" = $1 WHERE "userId" = $2`,
                    profile.businessUnit || null,
                    user.id,
                );
            } catch (e) {
                console.warn("[users POST] businessUnit update failed:", e);
            }
        }

        // Welcome / sign-in email — fire-and-forget so a transient SMTP
        // failure doesn't roll back the create.
        if (inviteToLogin && email) {
            void sendEmail({
                to: email,
                content: welcomeLoginEmail({
                    name: name || email,
                    email,
                    needsOnboarding: !!enableOnboarding,
                }),
            });
        }

        return NextResponse.json({ ...serializeBigInt(user), isUpdate });
    } catch (error: any) {
        // Email uniqueness is now handled by the upsert path; P2002 here is
        // most likely a clickupUserId collision (synthetic placeholder
        // matched another row's value). Fall back to a clearer message.
        if (error.code === "P2002") {
            return NextResponse.json(
                { error: "Couldn't link this account — a unique field is already taken (likely ClickUp ID)." },
                { status: 409 },
            );
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
