import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sendEmail } from "@/lib/email/sender";
import {
  violationCreatedEmail,
  violationStatusChangedEmail,
} from "@/lib/email/templates";

export const dynamic = "force-dynamic";
// Need the Node runtime for fs (Edge can't write files).
export const runtime  = "nodejs";

// Action-Taken attachment limits — mirrors the jobs/apply pattern.
// 10 MB ceiling, doc/image whitelist (HR mostly uploads PDFs of warning
// letters, screenshots of chats, etc.). Larger ceiling than resumes
// because a multi-page PDF with screenshots can run > 5 MB.
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTS = new Set([
  ".pdf", ".doc", ".docx", ".rtf", ".odt",
  ".txt", ".md", ".png", ".jpg", ".jpeg", ".webp",
]);

// Mirrors src/lib/access.ts:isHRAdmin so the API gate matches the UI's
// canViewViolationLog logic. Previously missed role=admin and
// orgLevel=hr_manager, locking out HR managers + admins.
function hasViolationAccess(session: any): boolean {
    const user = session?.user as any;
    return (
        user?.orgLevel === "ceo" ||
        user?.orgLevel === "special_access" ||
        user?.orgLevel === "hr_manager" ||
        user?.role === "hr_manager" ||
        user?.role === "admin" ||
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

// POST: Create a new violation.
//
// Now accepts EITHER application/json (legacy callers) or
// multipart/form-data (the violations form, which can attach a file).
// The form-data path also pulls an optional PDF/doc out of the
// `actionTakenFile` field, writes it to /public/uploads/violations/,
// and stores the URL + original filename on the row.
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!hasViolationAccess(session)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const user = session?.user as any;
        const ctype = request.headers.get("content-type") ?? "";

        // Branch on content-type so the JSON callers (curl, integration
        // tests, edits) keep working — only the form upload path touches fs.
        let body: any = {};
        let actionTakenFileUrl:  string | null = null;
        let actionTakenFileName: string | null = null;

        if (ctype.includes("multipart/form-data")) {
            const form = await request.formData();
            const get = (k: string) => {
                const v = form.get(k);
                return typeof v === "string" ? v : null;
            };
            body = {
                userId:               Number(get("userId")) || 0,
                severity:             get("severity"),
                status:               get("status"),
                category:             get("category"),
                actionTaken:          get("actionTaken"),
                notes:                get("notes"),
                violationDate:        get("violationDate"),
                responsiblePersonId:  get("responsiblePersonId") ? Number(get("responsiblePersonId")) : null,
            };

            const file = form.get("actionTakenFile");
            if (file instanceof File && file.size > 0) {
                if (file.size > MAX_FILE_BYTES) {
                    return NextResponse.json({ error: "File must be 10 MB or smaller" }, { status: 400 });
                }
                const ext = extname(file.name).toLowerCase();
                if (!ALLOWED_EXTS.has(ext)) {
                    return NextResponse.json({ error: "File must be a PDF, Word, RTF, ODT, TXT, or image" }, { status: 400 });
                }
                const safeBase = file.name
                    .replace(/\.[^.]+$/, "")
                    .replace(/[^A-Za-z0-9._-]+/g, "_")
                    .slice(0, 60) || "action";
                const stamped = `${randomUUID()}-${safeBase}${ext}`;
                const dir     = resolve(process.cwd(), "public", "uploads", "violations");
                await mkdir(dir, { recursive: true });
                const buf     = Buffer.from(await file.arrayBuffer());
                await writeFile(resolve(dir, stamped), buf);
                actionTakenFileUrl  = `/uploads/violations/${stamped}`;
                actionTakenFileName = file.name;
            }
        } else {
            body = await request.json();
        }

        const title = body.title || (body.category
            ? body.category.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) + " Violation"
            : "Violation Report");

        // `data: any` so TypeScript doesn't fight the new attachment
        // columns until the next clean `prisma generate` runs (the
        // typed client may lag; same workaround used in the PATCH
        // handler for lastReminderAt).
        const data: any = {
            userId: body.userId,
            reportedBy: user.dbId,
            title,
            description: body.description || null,
            severity: body.severity || "medium",
            status: body.status || "open",
            category: body.category || null,
            actionTaken: body.actionTaken || null,
            actionTakenFileUrl,
            actionTakenFileName,
            notes: body.notes || null,
            violationDate: body.violationDate ? new Date(body.violationDate) : null,
            responsiblePersonId: body.responsiblePersonId || null,
        };

        const violation = await prisma.violation.create({
            data,
            include: {
                user: { select: { id: true, name: true, email: true, role: true, profilePictureUrl: true, teamCapsule: true } },
                reporter: { select: { id: true, name: true, role: true, profilePictureUrl: true } },
                responsiblePerson: { select: { id: true, name: true, role: true, profilePictureUrl: true } },
            },
        });

        // Notify the affected employee. Fire-and-forget so a transient
        // SMTP failure doesn't block the create from returning.
        if (violation.user?.email) {
            void sendEmail({
                to: violation.user.email,
                content: violationCreatedEmail({
                    userName:      violation.user.name || "there",
                    title:         violation.title,
                    description:   violation.description,
                    severity:      violation.severity,
                    status:        violation.status,
                    category:      violation.category,
                    actionTaken:   violation.actionTaken,
                    notes:         violation.notes,
                    reporterName:  violation.reporter?.name ?? null,
                    violationDate: violation.violationDate,
                }),
            });
        }

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

        // Snapshot the row first so we can detect a status change AFTER
        // the update and know what to email about.
        const before = await prisma.violation.findUnique({ where: { id }, select: { status: true } });

        const data: any = {};
        if (status) data.status = status;
        if (actionTaken !== undefined) data.actionTaken = actionTaken;
        if (notes !== undefined) data.notes = notes;
        if (severity) data.severity = severity;
        if (responsiblePersonId !== undefined) data.responsiblePersonId = responsiblePersonId || null;
        if (status === "closed") data.resolvedAt = new Date();
        // (lastReminderAt reset is handled via raw SQL after the typed
        //  update below — the typed client may not know about the new
        //  column on a stale `prisma generate` cache.)

        const violation = await prisma.violation.update({
            where: { id },
            data,
            include: {
                user: { select: { id: true, name: true, email: true, role: true, profilePictureUrl: true, teamCapsule: true } },
                reporter: { select: { id: true, name: true, role: true, profilePictureUrl: true } },
                responsiblePerson: { select: { id: true, name: true, role: true, profilePictureUrl: true } },
            },
        });

        // Email the affected employee if the status actually changed.
        // Same fire-and-forget pattern as the create path.
        if (status && before?.status && status !== before.status && violation.user?.email) {
            const session2 = session;
            const changedByName = (session2?.user as any)?.name || null;
            void sendEmail({
                to: violation.user.email,
                content: violationStatusChangedEmail({
                    userName:      violation.user.name || "there",
                    title:         violation.title,
                    oldStatus:     before.status,
                    newStatus:     status,
                    actionTaken:   violation.actionTaken,
                    notes:         violation.notes,
                    changedByName,
                }),
            });
            // Reset the reminder clock so the cron starts the new
            // "still in progress" countdown from this status change,
            // not from when the violation was first logged. Raw SQL
            // bypasses any typed-client lag on the new column.
            try {
                await prisma.$executeRawUnsafe(
                    `UPDATE "Violation" SET "lastReminderAt" = NULL WHERE id = $1`,
                    id,
                );
            } catch (e) {
                console.warn("[violations PATCH] lastReminderAt reset failed:", e);
            }
        }

        return NextResponse.json(violation);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// DELETE: admin tier (CEO / dev / special_access / role=admin). HR
// Manager intentionally NOT included — destructive log delete should
// stay above HR's normal write access.
export async function DELETE(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        const user = session?.user as any;
        const canDelete =
            user?.orgLevel === "ceo" ||
            user?.orgLevel === "special_access" ||
            user?.role === "admin" ||
            user?.isDeveloper === true;
        if (!canDelete) {
            return NextResponse.json({ error: "Only admins can delete violations" }, { status: 403 });
        }

        const { id } = await request.json();
        await prisma.violation.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
