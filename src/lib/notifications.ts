import prisma from "@/lib/prisma";
import { sendEmail, emailsForUserIds } from "@/lib/email/sender";
import {
  leaveRequestEmail, wfhRequestEmail, onDutyRequestEmail,
  regularizationRequestEmail, compOffRequestEmail, decisionEmail,
  feedbackEmail, reportSubmittedEmail, jobApplicationEmail,
  type EmailContent,
} from "@/lib/email/templates";

export type NotificationType =
  | "regularization"
  | "wfh"
  | "on_duty"
  | "leave"
  | "comp_off"
  | "feedback"
  | "report"
  | "job_application";

/**
 * Map a notification's type + title/body into an EmailContent. Returns
 * null when the notification doesn't have a corresponding email template
 * (or when we can't decode the title format).
 *
 * Title format conventions (from the existing notify*() callers):
 *   "<actor name> requested regularization"
 *   "<actor name> requested WFH"
 *   "<actor name> requested on-duty"
 *   "<actor name> applied for leave"
 *   "<actor name> requested comp-off"
 *   "Your regularization was approved" / "rejected"
 *   etc.
 */
/**
 * Optional structured payload that lets callers feed real values into the
 * outbound email instead of relying on title/body parsing. When omitted,
 * buildEmailFor() falls back to the legacy title-regex behaviour.
 */
export type EmailData = {
  applicantName?: string;
  // Leave-specific
  leaveType?:    string;
  fromDate?:     string | Date;
  toDate?:       string | Date;
  totalDays?:    number | string;
  isHalfDay?:    boolean;
  // Single-day requests
  date?:         string | Date;
  // On-duty
  location?:     string;
  // Comp-off
  workedDate?:   string | Date;
  creditDays?:   number | string;
  // Approval context
  approverName?: string;
  stageLabel?:   string;     // e.g. "Manager approved" / "CEO approved"
  approvalNote?: string;
  /** L1 approver name + note — surfaced on the L2/final email so the
   *  finaliser's row sits alongside the manager's row. */
  l1ApproverName?: string;
  l1ApprovalNote?: string;
  reason?:       string;     // override the body-as-reason fallback
};

function buildEmailFor(
  type: NotificationType,
  title: string,
  body?: string,
  emailData?: EmailData,
): EmailContent | null {
  // ── Anonymous feedback (sent to CEO / HR / admins / devs) ─────────
  // The submitter is never disclosed. Title carries the category, body
  // carries the verbatim message.
  if (type === "feedback") {
    const cat = /category:\s*([^\n]+)/i.exec(body || "")?.[1]?.trim() || "anything_else";
    const msg = (body || "").replace(/^category:[^\n]*\n+/i, "").trim();
    return feedbackEmail({ category: cat, message: msg });
  }

  // ── New job application (sent to hiring stakeholders) ───────────
  // Body has kv lines we parse out — keeps the template clean and the
  // dispatcher robust to ordering / missing fields.
  if (type === "job_application") {
    const kv = (k: string) => new RegExp(`${k}:\\s*([^\\n]+)`, "i").exec(body || "")?.[1]?.trim() || "";
    return jobApplicationEmail({
      name:  kv("name")  || "A candidate",
      email: kv("email") || "",
      phone: kv("phone"),
      role:  kv("role")  || title.replace(/^New job application — /, ""),
      link:  kv("link")  || "/dashboard/hr/hiring",
    });
  }

  // ── Report submitted (weekly / monthly) ──────────────────────────
  // Title carries the manager + period, body carries kv lines we
  // unpack with simple regexes (kept robust to ordering).
  if (type === "report") {
    const kind   = /kind:\s*(weekly|monthly)/i.exec(body || "")?.[1]?.toLowerCase() === "monthly"
                   ? "monthly" : "weekly";
    const period = /period:\s*([^\n]+)/i.exec(body || "")?.[1]?.trim()  || "";
    const manager= /manager:\s*([^\n]+)/i.exec(body || "")?.[1]?.trim() || "A manager";
    const link   = /link:\s*([^\n]+)/i.exec(body || "")?.[1]?.trim()    || "";
    return reportSubmittedEmail({
      kind: kind as "weekly" | "monthly",
      periodLabel: period,
      managerName: manager,
      link,
    });
  }

  // ── Decision emails (sent to the submitter) ────────────────────────
  // Format: "Your <type> was approved" or "Your <type> request was rejected"
  const decisionMatch = /^Your\s+(.+?)\s+was\s+(approved|rejected|partially approved)/i.exec(title);
  if (decisionMatch) {
    return decisionEmail({
      applicantName: "there",                    // we don't have the name here; template handles "Hi there,"
      typeLabel: decisionMatch[1],
      outcome: (decisionMatch[2].toLowerCase().startsWith("rej") ? "rejected" : "approved"),
      note: body,
    });
  }

  // ── Submitter → approver request emails ────────────────────────────
  // Prefer structured emailData when caller passed it. Falls back to
  // parsing "<name> requested ___" / "<name> applied for ___" from the
  // title so legacy callers keep working.
  const submitterMatch = /^(.+?)\s+(?:requested|applied for)/i.exec(title);
  const possessiveMatch = /^(.+?)['']s\s+/i.exec(title);
  const applicantName =
    emailData?.applicantName
    ?? submitterMatch?.[1]
    ?? possessiveMatch?.[1]
    ?? "An employee";

  // Most fields (dates, etc.) live in the notification's body line —
  // we surface the body as the "reason" so approvers see the context
  // when emailData isn't provided. With emailData, the reason is the
  // real applicant-supplied reason, and stage/note become extra rows.
  const reasonText = emailData?.reason ?? body;

  switch (type) {
    case "leave": {
      const dayLabel =
        emailData?.totalDays != null
          ? `${emailData.totalDays} day${Number(emailData.totalDays) === 1 ? "" : "s"}${emailData.isHalfDay ? " (half day)" : ""}`
          : "—";
      return leaveRequestEmail({
        applicantName,
        leaveType: emailData?.leaveType   ?? "Leave",
        fromDate:  emailData?.fromDate    ?? new Date(),
        toDate:    emailData?.toDate      ?? new Date(),
        totalDays: emailData?.totalDays  ?? "—",
        reason:    reasonText,
        approverName:   emailData?.approverName,
        stageLabel:     emailData?.stageLabel,
        approvalNote:   emailData?.approvalNote,
        l1ApproverName: emailData?.l1ApproverName,
        l1ApprovalNote: emailData?.l1ApprovalNote,
        dayLabel,
      });
    }
    case "wfh":             return wfhRequestEmail({
      applicantName,
      date:           emailData?.date     ?? new Date(),
      toDate:         emailData?.toDate,
      reason:         reasonText,
      approverName:   emailData?.approverName,
      stageLabel:     emailData?.stageLabel,
      approvalNote:   emailData?.approvalNote,
      l1ApproverName: emailData?.l1ApproverName,
      l1ApprovalNote: emailData?.l1ApprovalNote,
    });
    case "on_duty":         return onDutyRequestEmail({ applicantName, date: emailData?.date ?? new Date(), location: emailData?.location, reason: reasonText });
    case "regularization":  return regularizationRequestEmail({ applicantName, date: emailData?.date ?? new Date(), reason: reasonText });
    case "comp_off":        return compOffRequestEmail({ applicantName, workedDate: emailData?.workedDate ?? new Date(), creditDays: emailData?.creditDays ?? "—", reason: reasonText });
    default:                return null;
  }
}

/**
 * Internal: resolve emails for `userIds` and dispatch the templated
 * email. Fire-and-forget — silently swallows failures so notifications
 * never block the API.
 */
async function dispatchEmails(
  userIds: number[],
  type: NotificationType,
  title: string,
  body?: string,
  emailData?: EmailData,
): Promise<void> {
  try {
    const content = buildEmailFor(type, title, body, emailData);
    if (!content) return;
    const to = await emailsForUserIds(userIds);
    if (to.length === 0) return;
    // Don't await — emails go out in the background.
    void sendEmail({ to, content });
  } catch (e) {
    console.error("[email] dispatchEmails failed:", e);
  }
}

/**
 * Resolve the set of users who should be notified when `actorId` submits a
 * request that needs approval: their direct manager + every active CEO / HR
 * manager / developer / admin. The actor themselves is excluded so
 * self-approvers don't ping their own inbox.
 */
export async function approverIdsForUser(actorId: number): Promise<number[]> {
  // Developers aren't a DB flag — they're resolved at session time from the
  // DEVELOPER_EMAILS env var. Match those emails here so devs get the same
  // approver notifications as CEOs / HR managers.
  const devEmails = (process.env.DEVELOPER_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const [actor, admins] = await Promise.all([
    prisma.user.findUnique({ where: { id: actorId }, select: { managerId: true } }),
    prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          // CEO + Special Access + HR Manager (role) + Developers.
          // EXCLUDES role=admin alone and orgLevel="hr_manager"-only
          // members (HR-team folks like Vanshika are role=member).
          { orgLevel: { in: ["ceo", "special_access"] } },
          { role: "hr_manager" },
          ...(devEmails.length > 0 ? [{ email: { in: devEmails } }] : []),
        ],
      },
      select: { id: true },
    }),
  ]);
  const ids = new Set<number>(admins.map((u) => u.id));
  if (actor?.managerId) ids.add(actor.managerId);
  ids.delete(actorId);
  return Array.from(ids);
}

/**
 * Low-level: write notifications for an explicit set of recipient ids. Dedupes
 * and excludes the actor themselves. Pass `actorId: null` (or omit it) to
 * create a system / self-confirmation notification that isn't filtered out of
 * its own recipient list. Swallows failures.
 */
export async function notifyUsers(params: {
  actorId?: number | null;
  userIds:  number[];
  type:     NotificationType;
  title:    string;
  body?:    string;
  entityId?: number;
  linkUrl?:  string;
  /** Structured payload — fills in the email's leave type, dates, total
   *  days, approver name, etc. so the template doesn't fall back to
   *  parsing the title/body. */
  emailData?: EmailData;
}): Promise<void> {
  try {
    const actor = params.actorId ?? null;
    const ids = Array.from(new Set(params.userIds))
      .filter((id) => actor == null || id !== actor);
    if (ids.length === 0) return;
    await prisma.notification.createMany({
      data: ids.map((userId) => ({
        userId,
        actorId:  params.actorId,
        type:     params.type,
        title:    params.title,
        body:     params.body,
        entityId: params.entityId,
        linkUrl:  params.linkUrl,
      })),
    });
    // Mirror the in-app notification as an email — fire-and-forget.
    void dispatchEmails(ids, params.type, params.title, params.body, params.emailData);
  } catch (e) {
    console.error("notifyUsers failed:", e);
  }
}

/**
 * Create notification rows for every approver of `actorId`. Safe to call from
 * a POST handler — failures are swallowed and logged so a notification outage
 * never blocks the underlying request from being created.
 */
export async function notifyApprovers(params: {
  actorId: number;
  type: NotificationType;
  title: string;
  body?: string;
  entityId?: number;
  linkUrl?: string;
  /** Additional users to notify (e.g. names the requester picked in "Notify"). */
  extraUserIds?: number[];
}): Promise<void> {
  try {
    const approvers = await approverIdsForUser(params.actorId);
    const all = new Set<number>([...approvers, ...(params.extraUserIds ?? [])]);
    if (all.size === 0) return;
    const recipientIds = Array.from(all);
    await prisma.notification.createMany({
      data: recipientIds.map((userId) => ({
        userId,
        actorId:  params.actorId,
        type:     params.type,
        title:    params.title,
        body:     params.body,
        entityId: params.entityId,
        linkUrl:  params.linkUrl,
      })),
    });
    void dispatchEmails(recipientIds, params.type, params.title, params.body);
  } catch (e) {
    console.error("notifyApprovers failed:", e);
  }
}
