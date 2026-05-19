// Email automation toggles.
//
// Every outbound-mail call goes through one of three places:
//   1. dispatchEmails() in src/lib/notifications.ts      (8 NotificationType emails)
//   2. sendViolationInProgressReminders() in src/lib/hr/violation-reminders.ts
//   3. missed-attendance email job in src/lib/hr/missed-attendance-emails.ts
//
// We gate all three on this single SyncConfig row (`email_toggles`) so a
// developer / admin can flip any of the 10 email kinds on/off from
// the Admin → Emails Automation panel without redeploying.
//
// `email_toggles.value` shape:
//   { [emailKey]: boolean }   — missing key = enabled (default ON).

import prisma from "@/lib/prisma";

/** All controllable email kinds. */
export type EmailKey =
  // NotificationType-driven (notifyUsers → dispatchEmails)
  | "regularization"
  | "wfh"
  | "on_duty"
  | "leave"
  | "comp_off"
  | "feedback"
  | "report"
  | "job_application"
  // Cron-job-driven
  | "violation_reminders"
  | "missed_attendance";

export const EMAIL_TOGGLE_CATALOG: Array<{
  key: EmailKey;
  label: string;
  description: string;
  group: "Requests" | "Reports & Feedback" | "Recruiting" | "Cron jobs";
}> = [
  { key: "regularization",      group: "Requests",            label: "Regularization",        description: "Attendance regularization requests + approval decisions." },
  { key: "wfh",                 group: "Requests",            label: "WFH",                   description: "Work-from-home requests + approval decisions." },
  { key: "on_duty",             group: "Requests",            label: "On-duty",               description: "On-duty / client-meeting requests + approval decisions." },
  { key: "leave",               group: "Requests",            label: "Leave",                 description: "Casual / sick / earned leave requests + approval decisions." },
  { key: "comp_off",            group: "Requests",            label: "Comp-off",              description: "Comp-off credit requests + approval decisions." },
  { key: "feedback",            group: "Reports & Feedback",  label: "Dashboard feedback",    description: "Dashboard feedback submissions to admins." },
  { key: "report",              group: "Reports & Feedback",  label: "Monthly / weekly reports", description: "Manager-submitted weekly / monthly report notifications." },
  { key: "job_application",     group: "Recruiting",          label: "Job applications",      description: "Inbound job-application notifications to HR + CEO." },
  { key: "violation_reminders", group: "Cron jobs",           label: "Violation reminders",   description: "Daily reminder for violations in-progress for 15+ days." },
  { key: "missed_attendance",   group: "Cron jobs",           label: "Missed attendance",     description: "Daily nudge to employees who didn't clock in." },
];

const SYNC_KEY = "email_toggles";

export type EmailToggles = Record<EmailKey, boolean>;

function defaults(): EmailToggles {
  // Default: every email kind is enabled.
  const out = {} as EmailToggles;
  for (const t of EMAIL_TOGGLE_CATALOG) out[t.key] = true;
  return out;
}

/** Read the full toggle map, filling defaults for missing keys. */
export async function getEmailToggles(): Promise<EmailToggles> {
  const out = defaults();
  try {
    const row = await prisma.syncConfig.findUnique({ where: { key: SYNC_KEY } });
    const raw = (row?.value ?? {}) as Partial<Record<EmailKey, boolean>>;
    for (const t of EMAIL_TOGGLE_CATALOG) {
      if (typeof raw[t.key] === "boolean") out[t.key] = raw[t.key]!;
    }
  } catch { /* table missing pre-migrate → defaults */ }
  return out;
}

/** Persist the toggle map (whitelisted against the catalog). */
export async function saveEmailToggles(toggles: Partial<EmailToggles>): Promise<EmailToggles> {
  const current = await getEmailToggles();
  for (const t of EMAIL_TOGGLE_CATALOG) {
    if (typeof toggles[t.key] === "boolean") current[t.key] = toggles[t.key]!;
  }
  await prisma.syncConfig.upsert({
    where:  { key: SYNC_KEY },
    create: { key: SYNC_KEY, value: current as object },
    update: { value: current as object },
  });
  return current;
}

/** True when emails of this kind should actually be sent. Defaults to ON. */
export async function isEmailEnabled(kind: EmailKey): Promise<boolean> {
  const all = await getEmailToggles();
  return all[kind] !== false;
}
