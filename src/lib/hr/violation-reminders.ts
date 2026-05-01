// Sweeps every "in progress" violation. For each one, if 15+ days have
// passed since the violation was created OR the last reminder fired,
// send a fresh reminder to HR / CEO / admins / special_access /
// developers and stamp lastReminderAt = now.
//
// Idempotent — running the cron multiple times within the same 15-day
// window is a no-op for already-reminded rows.
//
// Uses raw SQL for the lastReminderAt-aware queries so the runner is
// independent of `prisma generate` cache state on dev machines.

import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email/sender";
import { violationInProgressReminderEmail } from "@/lib/email/templates";
import { isDryRun } from "@/lib/email/transport";

const REMINDER_INTERVAL_DAYS = 15;

type DueRow = {
    id: number;
    title: string;
    severity: string;
    category: string | null;
    actionTaken: string | null;
    createdAt: Date;
    userName: string | null;
    reporterName: string | null;
};

export async function sendViolationInProgressReminders(): Promise<number> {
    const cutoff = new Date(Date.now() - REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000);

    // Pull every in-progress violation whose last reminder is older
    // than the cutoff (or has never been reminded). The OR handles both
    // cases: brand-new in-progress + already-reminded-but-stale.
    const due = await prisma.$queryRawUnsafe<DueRow[]>(
        `SELECT v.id, v.title, v.severity::text AS severity, v.category, v."actionTaken",
                v."createdAt",
                u.name AS "userName",
                r.name AS "reporterName"
           FROM "Violation" v
           LEFT JOIN "User" u ON u.id = v."userId"
           LEFT JOIN "User" r ON r.id = v."reportedBy"
          WHERE v.status = 'in_progress'
            AND (
              (v."lastReminderAt" IS NULL AND v."createdAt" <= $1)
              OR v."lastReminderAt" <= $1
            )
          ORDER BY v."createdAt" ASC`,
        cutoff,
    );
    if (due.length === 0) return 0;

    // Recipient list — same set we use for feedback inbox / job
    // applications: CEO / dev / special_access / admin / hr_manager.
    const devEmails = (process.env.DEVELOPER_EMAILS || "")
        .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    const recipients = await prisma.user.findMany({
        where: {
            isActive: true,
            OR: [
                { orgLevel: { in: ["ceo", "hr_manager", "special_access"] } },
                { role: "admin" },
                { role: "hr_manager" },
                ...(devEmails.length > 0 ? [{ email: { in: devEmails } }] : []),
            ],
        },
        select: { name: true, email: true },
    });
    const validRecipients = recipients.filter((r) => !!r.email);
    if (validRecipients.length === 0) return 0;

    let processed = 0;
    for (const v of due) {
        const daysOpen = Math.max(
            1,
            Math.floor((Date.now() - new Date(v.createdAt).getTime()) / (24 * 60 * 60 * 1000)),
        );
        // Send one mail per recipient — keeps the salutation personal
        // and avoids exposing the recipient list in the To header.
        for (const r of validRecipients) {
            try {
                await sendEmail({
                    to: r.email!,
                    content: violationInProgressReminderEmail({
                        recipientName:    r.name ?? null,
                        affectedUserName: v.userName || "an employee",
                        title:            v.title,
                        daysOpen,
                        severity:         v.severity,
                        category:         v.category,
                        reporterName:     v.reporterName,
                        actionTaken:      v.actionTaken,
                    }),
                });
            } catch (e) {
                console.warn("[violation-reminder] mail failed:", r.email, e);
            }
        }

        // Skip the lastReminderAt stamp in dry-run so dev testing
        // doesn't lock the row out of further reminder cycles.
        if (!isDryRun()) {
            await prisma.$executeRawUnsafe(
                `UPDATE "Violation" SET "lastReminderAt" = NOW() WHERE id = $1`,
                v.id,
            );
        }
        processed++;
    }
    return processed;
}
