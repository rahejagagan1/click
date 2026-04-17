import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

function hasViolationAccess(session: any): boolean {
    const user = session?.user as any;
    return (
        user?.orgLevel === "ceo" ||
        user?.orgLevel === "special_access" ||
        user?.role === "hr_manager" ||
        user?.isDeveloper === true
    );
}

// GET: Fetch violations with summary
export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasViolationAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const status = searchParams.get("status");
        const severity = searchParams.get("severity");
        const category = searchParams.get("category");

        const where: any = {};
        if (status) where.status = status;
        if (severity) where.severity = severity;
        if (category) where.category = category;

        const [violations, summary] = await Promise.all([
            prisma.violation.findMany({
                where,
                include: {
                    user: { select: { id: true, name: true, role: true, profilePictureUrl: true, teamCapsule: true } },
                    reporter: { select: { id: true, name: true, role: true, profilePictureUrl: true } },
                    responsiblePerson: { select: { id: true, name: true, role: true, profilePictureUrl: true } },
                },
                orderBy: { createdAt: "desc" },
            }),
            // Summary counts
            Promise.all([
                prisma.violation.count(),
                prisma.violation.count({ where: { status: "open" } }),
                prisma.violation.count({ where: { status: "in_progress" } }),
                prisma.violation.count({ where: { status: "closed" } }),
                prisma.violation.count({ where: { severity: { in: ["high", "critical"] } } }),
            ]),
        ]);

        return NextResponse.json({
            violations,
            summary: {
                total: summary[0],
                open: summary[1],
                inProgress: summary[2],
                closed: summary[3],
                highCritical: summary[4],
            },
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// POST: Create a new violation
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasViolationAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const user = session?.user as any;
        const body = await request.json();

        const title = body.title || (body.category
            ? body.category.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) + " Violation"
            : "Violation Report");

        const violation = await prisma.violation.create({
            data: {
                userId: body.userId,
                reportedBy: user.dbId,
                title,
                description: body.description || null,
                severity: body.severity || "medium",
                status: body.status || "open",
                category: body.category || null,
                actionTaken: body.actionTaken || null,
                notes: body.notes || null,
                violationDate: body.violationDate ? new Date(body.violationDate) : null,
                responsiblePersonId: body.responsiblePersonId || null,
            },
            include: {
                user: { select: { id: true, name: true, role: true, profilePictureUrl: true, teamCapsule: true } },
                reporter: { select: { id: true, name: true, role: true, profilePictureUrl: true } },
                responsiblePerson: { select: { id: true, name: true, role: true, profilePictureUrl: true } },
            },
        });

        return NextResponse.json(violation);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// PATCH: Update violation status/action
export async function PATCH(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasViolationAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const body = await request.json();
        const { id, status, actionTaken, severity, notes, responsiblePersonId } = body;

        const data: any = {};
        if (status) data.status = status;
        if (actionTaken !== undefined) data.actionTaken = actionTaken;
        if (notes !== undefined) data.notes = notes;
        if (severity) data.severity = severity;
        if (responsiblePersonId !== undefined) data.responsiblePersonId = responsiblePersonId || null;
        if (status === "closed") data.resolvedAt = new Date();

        const violation = await prisma.violation.update({
            where: { id },
            data,
            include: {
                user: { select: { id: true, name: true, role: true, profilePictureUrl: true, teamCapsule: true } },
                reporter: { select: { id: true, name: true, role: true, profilePictureUrl: true } },
                responsiblePerson: { select: { id: true, name: true, role: true, profilePictureUrl: true } },
            },
        });

        return NextResponse.json(violation);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// DELETE: Only CEO and Developer can delete
export async function DELETE(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        const user = session?.user as any;
        const canDelete = user?.orgLevel === "ceo" || user?.isDeveloper === true;
        if (!canDelete) {
            return NextResponse.json({ error: "Only CEO and developers can delete violations" }, { status: 403 });
        }

        const { id } = await request.json();
        await prisma.violation.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
