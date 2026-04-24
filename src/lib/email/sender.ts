// High-level email sender. Always fire-and-forget — never throws, never
// blocks the API response. In dev / when SMTP isn't configured, logs to
// the console instead of sending so local testing doesn't spam real
// inboxes.
import { getMailer, emailSenderName, isDryRun } from "./transport";
import type { EmailContent } from "./templates";
import prisma from "@/lib/prisma";

export async function sendEmail(args: {
  to: string | string[];
  content: EmailContent;
}): Promise<void> {
  const recipients = Array.isArray(args.to) ? args.to : [args.to];
  const valid = recipients.filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if (valid.length === 0) return;

  const transport = getMailer();
  if (isDryRun() || !transport) {
    console.log(`[email][dry-run] → ${valid.join(", ")}`);
    console.log(`              subject: ${args.content.subject}`);
    return;
  }

  try {
    const info = await transport.sendMail({
      from:    emailSenderName(),
      to:      valid.join(", "),
      subject: args.content.subject,
      text:    args.content.text,
      html:    args.content.html,
    });
    console.log(`[email] sent to ${valid.length} (${info.messageId})`);
  } catch (e) {
    console.error("[email] send failed:", e);
  }
}

/**
 * Resolve email addresses for a list of user ids — drops anyone without
 * an email or who's been deactivated. Single round-trip to the DB.
 */
export async function emailsForUserIds(userIds: number[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await prisma.user.findMany({
    where: { id: { in: userIds }, isActive: true },
    select: { email: true },
  });
  return rows.map((r) => r.email).filter(Boolean);
}

/**
 * All active users — for org-wide blasts (announcements). Returns just
 * the email addresses.
 */
export async function emailsForAllActiveUsers(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { isActive: true },
    select: { email: true },
  });
  return rows.map((r) => r.email).filter(Boolean);
}
