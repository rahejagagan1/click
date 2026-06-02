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
import { isEmailEnabled, devEmailRecipientsClause } from "@/lib/email/toggles";

const REMINDER_INTERVAL_DAYS = 15;

type DueRow = {
    id: number;
    title: string;
    severity: string;
    category: string | null;
    actionTaken: string | null;
    createdAt: Date;
    userId: number | null;
    userName: string | null;
    reporterName: string | null;
};

export async function sendViolationInProgressReminders(): Promise<number> {
    // Admin-controllable kill-switch (Admin → Emails Automation). When
    // disabled, the cron still runs but sends zero emails — no state
    // change, no lastReminderAt stamps, so flipping back ON later picks
    // up exactly where it left off.
    if (!(await isEmailEnabled("violation_reminders"))) {
        console.log("[violation-reminders] skipped — disabled in admin toggles");
        return 0;
    }

    const cutoff = new Date(Date.now() - REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000);

    // Pull every in-progress violation whose last reminder is older
    // than the cutoff (or has never been reminded). The OR handles both
    // cases: brand-new in-progress + already-reminded-but-stale.
    const due = await prisma.$queryRawUnsafe<DueRow[]>(
        `SELECT v.id, v.title, v.severity::text AS severity, v.category, v."actionTaken",
                v."createdAt", v."userId",
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

    // Recipient list — special_access / admin / hr_manager. The CEO is
    // EXCLUDED here (top-level NOT, because the CEO/owner account also
    // carries role="admin"); they're reminded only about violations of
    // their OWN direct reports, added per-violation below.
    const recipients = await prisma.user.findMany({
        where: {
            isActive: true,
            orgLevel: { not: "ceo" },
            OR: [
                { orgLevel: { in: ["hr_manager", "special_access"] } },
                { role: "admin" },
                { role: "hr_manager" },
                ...(await devEmailRecipientsClause()),
            ],
        },
        select: { name: true, email: true },
    });
    const validRecipients = recipients.filter((r) => !!r.email);

    // CEO-per-direct-report lookup: resolve each affected employee's direct
    // manager once; when that manager is the (active) CEO, the CEO is added
    // to that violation's recipients (and only that violation's).
    const affectedIds = [...new Set(due.map((d) => d.userId).filter((id): id is number => id != null))];
    const ceoByEmployee = new Map<number, { name: string | null; email: string }>();
    if (affectedIds.length) {
        const reports = await prisma.user.findMany({
            where:  { id: { in: affectedIds } },
            select: { id: true, manager: { select: { orgLevel: true, isActive: true, name: true, email: true } } },
        });
        for (const r of reports) {
            const m = r.manager;
            if (m && m.isActive && m.orgLevel === "ceo" && m.email) {
                ceoByEmployee.set(r.id, { name: m.name, email: m.email });
            }
        }
    }
    if (validRecipients.length === 0 && ceoByEmployee.size === 0) return 0;

    let processed = 0;
    for (const v of due) {
        const daysOpen = Math.max(
            1,
            Math.floor((Date.now() - new Date(v.createdAt).getTime()) / (24 * 60 * 60 * 1000)),
        );
        // Base recipients (HR / special_access / admin) plus the CEO only
        // when this violation is about one of their own direct reports.
        const ceo = v.userId != null ? ceoByEmployee.get(v.userId) : undefined;
        const violationRecipients = ceo ? [...validRecipients, ceo] : validRecipients;
        // Send one mail per recipient — keeps the salutation personal
        // and avoids exposing the recipient list in the To header.
        for (const r of violationRecipients) {
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
