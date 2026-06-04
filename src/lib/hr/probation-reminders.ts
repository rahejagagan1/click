// Sweeps every active employee whose probationEndDate is within the
// next 7 days AND who hasn't already had the reminder sent for THIS
// end-date. For each one, emails HR (special_access + role=hr_manager
// + devs if dev_emails is on) PLUS the employee's reporting manager,
// then stamps probationReminderSentAt = NOW().
//
// Re-arm rule: probationReminderSentAt gets cleared automatically by
// the People PATCH route whenever HR edits probationEndDate, so an
// extension naturally re-arms the reminder for the new end date.
// (See src/app/api/hr/people/[id]/route.ts.)
//
// Idempotent: running the cron multiple times in a 24h window is a
// no-op for already-reminded rows. Raw SQL throughout so this works
// without a fresh prisma generate cycle.

import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email/sender";
import { probationEndingReminderEmail } from "@/lib/email/templates";
import { isDryRun } from "@/lib/email/transport";
import { isEmailEnabled, devEmailRecipientsClause, rolesForUser, isEmailEnabledForRoles } from "@/lib/email/toggles";

// Fire window: probation end within the next N days. The user
// approved a 7-day heads-up; keep this in one place so future tuning
// (e.g. extend to 10 days) stays one-line.
const REMINDER_LEAD_DAYS = 7;

type DueRow = {
  userId: number;
  employeeId: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  joiningDate: Date | null;
  probationEndDate: Date;
  department: string | null;
  businessUnit: string | null;
  managerId: number | null;
  managerName: string | null;
  managerEmail: string | null;
  userName: string | null;
  userEmail: string | null;
};

export async function sendProbationEndingReminders(): Promise<number> {
  if (!(await isEmailEnabled("probation_reminders"))) {
    console.log("[probation-reminders] skipped — disabled in admin toggles");
    return 0;
  }

  // "Within 7 days from now" upper bound. End date must also be in
  // the FUTURE (no point emailing about an already-expired window).
  const upper = new Date(Date.now() + REMINDER_LEAD_DAYS * 24 * 60 * 60 * 1000);

  const due = await prisma.$queryRawUnsafe<DueRow[]>(
    `SELECT u.id AS "userId",
            ep."employeeId",
            ep."firstName", ep."middleName", ep."lastName",
            ep."joiningDate",
            ep."probationEndDate",
            ep."department", ep."businessUnit",
            u."managerId",
            m.name  AS "managerName",
            m.email AS "managerEmail",
            u.name  AS "userName",
            u.email AS "userEmail"
       FROM "EmployeeProfile" ep
       JOIN "User" u ON u.id = ep."userId"
       LEFT JOIN "User" m ON m.id = u."managerId"
      WHERE u."isActive" = true
        AND ep."probationEndDate" IS NOT NULL
        AND ep."probationEndDate" >= NOW()
        AND ep."probationEndDate" <= $1
        AND ep."probationReminderSentAt" IS NULL
      ORDER BY ep."probationEndDate" ASC`,
    upper,
  );
  if (due.length === 0) return 0;

  // HR + admin recipients shared across all rows. Brand-scope the
  // CEO equivalent — each affected employee's brand-CEO gets a copy.
  // Note: this reminder isn't a CEO-direct concern usually, but keep
  // the routing consistent with the violation reminders so HR can
  // tell the whole admin chain saw it.
  const hrRecipients = await prisma.user.findMany({
    where: {
      isActive: true,
      orgLevel: { not: "ceo" },
      OR: [
        { orgLevel: { in: ["special_access"] } },
        { role: "hr_manager" },
        ...(await devEmailRecipientsClause()),
      ],
    },
    select: { id: true, name: true, email: true, orgLevel: true, role: true, employeeProfile: { select: { businessUnit: true } } },
  });

  // Per-role toggle filter — drop recipients whose role override for
  // probation_reminders is OFF.
  const filteredHR = [] as typeof hrRecipients;
  for (const r of hrRecipients) {
    if (!r.email) continue;
    const roles = rolesForUser({ orgLevel: r.orgLevel, role: r.role });
    if (await isEmailEnabledForRoles("probation_reminders", roles)) filteredHR.push(r);
  }

  let processed = 0;
  for (const row of due) {
    const fullName = [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" ").trim()
      || row.userName
      || `User #${row.userId}`;

    const daysRemaining = Math.max(
      0,
      Math.ceil((row.probationEndDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    );

    // Recipients for THIS row: brand-scoped HR + the affected
    // employee's reporting manager (deduped by email so a manager
    // who's also HR doesn't get two copies).
    const empBrand = row.businessUnit || "NB Media";
    const brandedHR = filteredHR.filter((h) => (h.employeeProfile?.businessUnit || "NB Media") === empBrand);
    const recipients = new Map<string, { name: string | null; email: string }>();
    for (const h of brandedHR) {
      if (h.email) recipients.set(h.email.toLowerCase(), { name: h.name, email: h.email });
    }
    if (row.managerEmail) {
      recipients.set(row.managerEmail.toLowerCase(), { name: row.managerName, email: row.managerEmail });
    }
    if (recipients.size === 0) {
      console.warn(`[probation-reminders] no recipients for user #${row.userId} (${fullName}) — skipping`);
      continue;
    }

    let anySent = false;
    for (const r of recipients.values()) {
      try {
        await sendEmail({
          to: r.email,
          content: probationEndingReminderEmail({
            recipientName:    r.name ?? null,
            employeeName:     fullName,
            employeeId:       row.employeeId,
            joiningDate:      row.joiningDate,
            probationEndDate: row.probationEndDate,
            daysRemaining,
            managerName:      row.managerName,
            department:       row.department,
            employeeUserId:   row.userId,
          }),
        });
        anySent = true;
      } catch (e) {
        console.warn(`[probation-reminders] mail failed: ${r.email}`, e);
      }
    }

    // Stamp only if at least one email actually went out — partial
    // sends still count (the cron's purpose is "the system tried";
    // re-sending would spam the recipients who DID get it).
    if (anySent && !isDryRun()) {
      await prisma.$executeRawUnsafe(
        `UPDATE "EmployeeProfile" SET "probationReminderSentAt" = NOW() WHERE "userId" = $1`,
        row.userId,
      );
    }
    if (anySent) processed++;
  }
  return processed;
}
