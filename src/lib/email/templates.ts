// Email templates for HR notifications. Every template returns
// { subject, html, text } so the sender doesn't care which type it is.
//
// Plain-text alternatives are mandatory — many corporate mail clients
// (and some Gmail filters) downrank emails that lack a text fallback.

import { appUrl } from "./transport";

export type EmailContent = { subject: string; html: string; text: string };

// ── Shared chrome ──────────────────────────────────────────────────────
// Logo is delivered as an inline CID attachment (cid:logo) by sender.ts —
// works reliably in dev (no public APP_URL fetch needed) and in prod.
const SHELL = (title: string, body: string) => `
<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#0f6ecd;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse">
        <tr>
          <td style="vertical-align:middle">
            <p style="margin:0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.85">NB Media HR</p>
            <h1 style="margin:4px 0 0;font-size:18px;font-weight:600;color:#ffffff;line-height:1.3">${title}</h1>
          </td>
          <td style="vertical-align:middle;text-align:right;width:52px">
            <img src="cid:logo" alt="NB" width="40" height="40"
                 style="display:inline-block;border-radius:8px;background:#ffffff;padding:4px;object-fit:contain" />
          </td>
        </tr>
      </table>
    </div>
    <div style="background:#ffffff;padding:22px;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 8px 8px">
      ${body}
    </div>
    <p style="margin:18px 0 0;font-size:11px;color:#94a3b8;text-align:center">
      You're receiving this because of your role on the NB Media dashboard.
    </p>
  </div>
</body></html>`;

const detailRow = (label: string, value: string) => `
  <tr>
    <td style="padding:6px 12px 6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;width:140px;vertical-align:top">${label}</td>
    <td style="padding:6px 0;font-size:14px;color:#1f2937;vertical-align:top">${value}</td>
  </tr>`;

const ctaButton = (label: string, href: string) => `
  <a href="${href}" style="display:inline-block;background:#0f6ecd;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;margin-top:14px">${label}</a>`;

const escape = (s: string) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]
  );

const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", weekday: "short",
  });

// ── Helper: build subject + html + text from a request payload ─────────
type RequestArgs = {
  applicantName: string;
  details: Array<[string, string]>;  // ordered key→value pairs
  reason?: string;
  inboxPath?: string;                // defaults to /dashboard/hr/inbox
};

function requestEmail(opts: { typeLabel: string; verb: "submitted" | "approved" | "rejected" } & RequestArgs): EmailContent {
  const verbWord = opts.verb === "submitted" ? "submitted" : opts.verb === "approved" ? "was approved" : "was rejected";
  const link = `${appUrl()}${opts.inboxPath ?? "/dashboard/hr/inbox"}`;

  const subject = `${opts.applicantName} ${verbWord} a ${opts.typeLabel} request`;

  const detailsTable = opts.details
    .map(([k, v]) => detailRow(escape(k), escape(v)))
    .join("");

  const body = `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
      <strong>${escape(opts.applicantName)}</strong> ${verbWord} a
      ${escape(opts.typeLabel)} request.
    </p>
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${detailsTable}</table>
    ${opts.reason ? `
      <div style="margin-top:14px;padding:12px;background:#f8fafc;border-left:3px solid #0f6ecd;border-radius:4px">
        <p style="margin:0 0 4px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">Reason</p>
        <p style="margin:0;font-size:14px;color:#1f2937;line-height:1.55;white-space:pre-wrap">${escape(opts.reason)}</p>
      </div>
    ` : ""}
    ${ctaButton(opts.verb === "submitted" ? "Open in inbox" : "View in dashboard", link)}
  `;

  const textLines = [
    `${opts.applicantName} ${verbWord} a ${opts.typeLabel} request.`,
    "",
    ...opts.details.map(([k, v]) => `${k}: ${v}`),
    ...(opts.reason ? ["", `Reason: ${opts.reason}`] : []),
    "",
    `Open: ${link}`,
  ];

  return { subject, html: SHELL(subject, body), text: textLines.join("\n") };
}

// ── Public template builders ───────────────────────────────────────────

export function leaveRequestEmail(args: {
  applicantName: string;
  leaveType: string;
  fromDate: string | Date;
  toDate: string | Date;
  totalDays: number | string;
  reason?: string;
}): EmailContent {
  return requestEmail({
    typeLabel: "leave",
    verb: "submitted",
    applicantName: args.applicantName,
    details: [
      ["Leave Type", args.leaveType],
      ["From",       fmtDate(args.fromDate)],
      ["To",         fmtDate(args.toDate)],
      ["Total Days", `${args.totalDays} day${Number(args.totalDays) === 1 ? "" : "s"}`],
    ],
    reason: args.reason,
  });
}

export function wfhRequestEmail(args: {
  applicantName: string;
  date: string | Date;
  reason?: string;
}): EmailContent {
  return requestEmail({
    typeLabel: "WFH",
    verb: "submitted",
    applicantName: args.applicantName,
    details: [["Date", fmtDate(args.date)]],
    reason: args.reason,
  });
}

export function onDutyRequestEmail(args: {
  applicantName: string;
  date: string | Date;
  location?: string;
  reason?: string;
}): EmailContent {
  return requestEmail({
    typeLabel: "On-Duty",
    verb: "submitted",
    applicantName: args.applicantName,
    details: [
      ["Date", fmtDate(args.date)],
      ...(args.location ? [["Location", args.location] as [string, string]] : []),
    ],
    reason: args.reason,
  });
}

export function regularizationRequestEmail(args: {
  applicantName: string;
  date: string | Date;
  reason?: string;
}): EmailContent {
  return requestEmail({
    typeLabel: "attendance regularization",
    verb: "submitted",
    applicantName: args.applicantName,
    details: [["Date", fmtDate(args.date)]],
    reason: args.reason,
  });
}

export function compOffRequestEmail(args: {
  applicantName: string;
  workedDate: string | Date;
  creditDays: number | string;
  reason?: string;
}): EmailContent {
  return requestEmail({
    typeLabel: "comp-off credit",
    verb: "submitted",
    applicantName: args.applicantName,
    details: [
      ["Worked Date", fmtDate(args.workedDate)],
      ["Credit",      `${args.creditDays} day${Number(args.creditDays) === 1 ? "" : "s"}`],
    ],
    reason: args.reason,
  });
}

export function decisionEmail(args: {
  applicantName: string;
  typeLabel: string;
  outcome: "approved" | "rejected";
  approverName?: string;
  note?: string;
}): EmailContent {
  const subject = `Your ${args.typeLabel} request was ${args.outcome}`;
  const link = `${appUrl()}/dashboard/hr/inbox`;
  const accent = args.outcome === "approved" ? "#10b981" : "#ef4444";
  const body = `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
      Hi ${escape(args.applicantName)}, your <strong>${escape(args.typeLabel)}</strong> request
      <span style="color:${accent};font-weight:600">${args.outcome}</span>${args.approverName ? ` by ${escape(args.approverName)}` : ""}.
    </p>
    ${args.note ? `
      <div style="margin-top:14px;padding:12px;background:#f8fafc;border-left:3px solid ${accent};border-radius:4px">
        <p style="margin:0 0 4px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">Note</p>
        <p style="margin:0;font-size:14px;color:#1f2937;line-height:1.55;white-space:pre-wrap">${escape(args.note)}</p>
      </div>
    ` : ""}
    ${ctaButton("View details", link)}
  `;
  const text = [
    `Hi ${args.applicantName},`,
    `Your ${args.typeLabel} request was ${args.outcome}${args.approverName ? ` by ${args.approverName}` : ""}.`,
    ...(args.note ? ["", `Note: ${args.note}`] : []),
    "",
    `Open: ${link}`,
  ].join("\n");
  return { subject, html: SHELL(subject, body), text };
}

export function attendanceReminderEmail(args: {
  userName: string;
  kind: "clock-in" | "clock-out";
}): EmailContent {
  const isIn  = args.kind === "clock-in";
  const action = isIn ? "clock in" : "clock out";
  const subject = isIn
    ? "Reminder: please clock in for today"
    : "Reminder: please clock out before you leave";
  const link = `${appUrl()}/dashboard/hr/attendance`;
  const accent = isIn ? "#f59e0b" : "#0f6ecd";
  const body = `
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6">
      Hi ${escape(args.userName)},
    </p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6">
      Friendly reminder — you haven't <strong style="color:${accent}">${action}ed</strong> on the dashboard yet today.
    </p>
    ${isIn ? `
      <div style="margin:14px 0;padding:12px;background:#fff7ed;border-left:3px solid #f59e0b;border-radius:4px">
        <p style="margin:0;font-size:13px;color:#7c2d12;line-height:1.55">
          If you're on <strong>leave</strong>, working from home, or out for a meeting,
          please file the matching request from the dashboard so your attendance
          record stays accurate. Otherwise please clock in now — past 10:00 AM IST
          counts as a half day.
        </p>
      </div>
    ` : `
      <div style="margin:14px 0;padding:12px;background:#eff6ff;border-left:3px solid #0f6ecd;border-radius:4px">
        <p style="margin:0;font-size:13px;color:#1e3a8a;line-height:1.55">
          Without a clock-out the day is logged as <strong>missed clock-out</strong>
          and your hours don't count toward effective time. Take a moment to
          clock out — or file a regularization if you've already left.
        </p>
      </div>
    `}
    ${ctaButton(isIn ? "Clock in now" : "Clock out now", link)}
  `;
  const text = [
    `Hi ${args.userName},`,
    ``,
    `Reminder: you haven't ${action}ed on the NB Media dashboard yet today.`,
    ``,
    isIn
      ? `If you're on leave, WFH, or out for a meeting, please file the matching request from the dashboard. Otherwise please clock in now — past 10:00 AM IST counts as a half day.`
      : `Without a clock-out the day is logged as missed-clock-out and your hours don't count toward effective time. Please clock out, or file a regularization if you've already left.`,
    ``,
    `Open: ${link}`,
  ].join("\n");
  return { subject, html: SHELL(subject, body), text };
}

export function reportSubmittedEmail(args: {
  kind: "weekly" | "monthly";
  periodLabel: string;
  managerName: string;
  link: string;
}): EmailContent {
  const subject = `${args.managerName} submitted ${args.kind} report — ${args.periodLabel}`;
  const html = SHELL(subject, `
    <p style="margin:0 0 8px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">
      ${args.kind === "weekly" ? "Weekly" : "Monthly"} Report
    </p>
    <p style="margin:0;font-size:14px;color:#1f2937;line-height:1.6">
      <strong>${escape(args.managerName)}</strong> just locked their ${args.kind} report for <strong>${escape(args.periodLabel)}</strong>.
    </p>
    <p style="margin:12px 0 0;font-size:13px;color:#475569;line-height:1.55">
      Open it from the dashboard to review the writer / editor / researcher metrics, key learnings, and risks.
    </p>
    ${ctaButton("Open report", args.link)}
  `);
  const text = [
    subject,
    "",
    `${args.managerName} just locked their ${args.kind} report for ${args.periodLabel}.`,
    "",
    `Open: ${args.link}`,
  ].join("\n");
  return { subject, html, text };
}

export function feedbackEmail(args: {
  category: string;
  message: string;
}): EmailContent {
  const prettyCategory = args.category
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const subject = `New anonymous feedback — ${prettyCategory}`;
  const link = `${appUrl()}/dashboard/feedback_inbox`;
  const html = SHELL(subject, `
    <p style="margin:0 0 8px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">
      ${escape(prettyCategory)} · Anonymous
    </p>
    <div style="font-size:14px;color:#1f2937;line-height:1.65;white-space:pre-wrap">${escape(args.message)}</div>
    <p style="margin:16px 0 0;font-size:11.5px;color:#64748b">
      The submitter is anonymous — feedback is not attributed to a user account.
    </p>
    ${ctaButton("Open inbox", link)}
  `);
  const text = [
    `${subject}`,
    "",
    args.message,
    "",
    `(Anonymous — submitter not disclosed.)`,
    "",
    `Open: ${link}`,
  ].join("\n");
  return { subject, html, text };
}

// ── Offboarding ─────────────────────────────────────────────────────────
// Two flavours from the same data:
//   employeeFarewellEmail: warm goodbye sent to the leaver themselves.
//   exitNotificationEmail: heads-up sent to CEO / HR / manager / admins.
export function employeeFarewellEmail(args: {
  name: string;
  lastWorkingDay: string | Date;
}): EmailContent {
  const subject = `Wishing you the best — your last day at NB Media`;
  const html = SHELL("Wishing you the best", `
    <p style="margin:0 0 12px;font-size:14.5px;color:#1f2937">Hi ${escape(args.name)},</p>
    <p style="margin:0 0 12px;font-size:13.5px;color:#1f2937;line-height:1.6">
      Thanks for everything you've contributed at NB Media. Your last working
      day on record is <strong>${fmtDate(args.lastWorkingDay)}</strong>.
    </p>
    <p style="margin:0 0 12px;font-size:13.5px;color:#1f2937;line-height:1.6">
      HR will be in touch shortly to coordinate handover, asset return, and
      final settlement. If anything's unclear, just reply to this email.
    </p>
    <p style="margin:18px 0 0;font-size:13.5px;color:#1f2937">— The NB Media team</p>
  `);
  const text = [
    `Hi ${args.name},`,
    "",
    `Thanks for everything you've contributed at NB Media. Your last working day on record is ${fmtDate(args.lastWorkingDay)}.`,
    "",
    `HR will be in touch shortly to coordinate handover, asset return, and final settlement.`,
    "",
    `— The NB Media team`,
  ].join("\n");
  return { subject, html, text };
}

export function exitNotificationEmail(args: {
  name: string;
  email: string;
  exitType: string;
  lastWorkingDay: string | Date;
  reason?: string | null;
}): EmailContent {
  const subject = `Exit recorded — ${args.name}`;
  const link = `${appUrl()}/dashboard/hr/offboard`;
  const html = SHELL(subject, `
    <p style="margin:0 0 12px;font-size:14.5px;color:#1f2937">
      An employee exit has been recorded.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%">
      ${detailRow("Name",            escape(args.name))}
      ${detailRow("Email",           escape(args.email))}
      ${detailRow("Type",            escape(args.exitType.replace(/_/g, " ")))}
      ${detailRow("Last Working Day", fmtDate(args.lastWorkingDay))}
      ${args.reason ? detailRow("Reason", escape(args.reason)) : ""}
    </table>
    ${ctaButton("Open Offboarding", link)}
  `);
  const text = [
    `Exit recorded for ${args.name} (${args.email})`,
    "",
    `Type: ${args.exitType.replace(/_/g, " ")}`,
    `Last working day: ${fmtDate(args.lastWorkingDay)}`,
    args.reason ? `Reason: ${args.reason}` : "",
    "",
    `Open: ${link}`,
  ].filter(Boolean).join("\n");
  return { subject, html, text };
}

export function jobApplicationEmail(args: {
  name: string;
  email: string;
  phone: string;
  role: string;
  link: string;
}): EmailContent {
  const subject = `New application — ${args.role}`;
  const fullLink = args.link.startsWith("http") ? args.link : `${appUrl()}${args.link}`;
  const html = SHELL(subject, `
    <p style="margin:0 0 12px;font-size:14.5px;color:#1f2937">
      A new candidate just applied through the careers form.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%">
      ${detailRow("Role",  escape(args.role))}
      ${detailRow("Name",  escape(args.name))}
      ${detailRow("Email", escape(args.email))}
      ${args.phone ? detailRow("Phone", escape(args.phone)) : ""}
    </table>
    ${ctaButton("Open Hiring inbox", fullLink)}
  `);
  const text = [
    `New application for ${args.role}`,
    "",
    `Name:  ${args.name}`,
    `Email: ${args.email}`,
    args.phone ? `Phone: ${args.phone}` : "",
    "",
    `Open: ${fullLink}`,
  ].filter(Boolean).join("\n");
  return { subject, html, text };
}

export function welcomeLoginEmail(args: {
  name: string;
  email: string;
  needsOnboarding: boolean;
}): EmailContent {
  const subject = `Welcome to NB Media — your dashboard is ready`;
  const link = `${appUrl()}/login`;
  const onboardingNote = args.needsOnboarding
    ? `<p style="margin:0 0 12px;font-size:13.5px;color:#1f2937;line-height:1.6">
         When you sign in for the first time we'll walk you through a short
         onboarding step — confirming your contact details so HR has everything on file.
       </p>`
    : "";
  const html = SHELL("Welcome to NB Media", `
    <p style="margin:0 0 12px;font-size:14.5px;color:#1f2937">Hi ${escape(args.name)},</p>
    <p style="margin:0 0 12px;font-size:13.5px;color:#1f2937;line-height:1.6">
      Your account on the NB Media dashboard has been set up. You can sign in
      using your Google account at <strong>${escape(args.email)}</strong> — no
      password needed.
    </p>
    ${onboardingNote}
    ${ctaButton("Sign in to the dashboard", link)}
    <p style="margin:18px 0 0;font-size:11.5px;color:#64748b">
      If your Google account uses a different address, ask HR to update your
      record before signing in.
    </p>
  `);
  const text = [
    `Hi ${args.name},`,
    "",
    `Your NB Media dashboard account is ready. Sign in with your Google account at ${args.email}.`,
    args.needsOnboarding
      ? "On first sign-in we'll walk you through a short onboarding step."
      : "",
    "",
    `Sign in: ${link}`,
  ].filter(Boolean).join("\n");
  return { subject, html, text };
}

export function announcementEmail(args: {
  title: string;
  body: string;
  authorName: string;
}): EmailContent {
  const subject = `Announcement: ${args.title}`;
  const link = `${appUrl()}/dashboard/hr/announcements`;
  const html = SHELL(args.title, `
    <p style="margin:0 0 8px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">
      From ${escape(args.authorName)}
    </p>
    <div style="font-size:14px;color:#1f2937;line-height:1.65;white-space:pre-wrap">${escape(args.body)}</div>
    ${ctaButton("Open in dashboard", link)}
  `);
  const text = [
    `Announcement from ${args.authorName}`,
    "",
    args.title,
    "",
    args.body,
    "",
    `Open: ${link}`,
  ].join("\n");
  return { subject, html, text };
}

// ── Violations ────────────────────────────────────────────────────────
// Sent to the affected employee when a violation is first logged. The
// note + actionTaken + status are surfaced so the user knows exactly
// what happened and what (if anything) is being done about it.
const SEVERITY_LABEL: Record<string, string> = {
  low: "Low", medium: "Medium", high: "High", critical: "Critical",
};
const STATUS_LABEL: Record<string, string> = {
  open: "Open", in_progress: "In progress", closed: "Closed",
};
const STATUS_COLOR: Record<string, string> = {
  open: "#ef4444", in_progress: "#0284c7", closed: "#10b981",
};

export function violationCreatedEmail(args: {
  userName: string;
  title: string;
  description?: string | null;
  severity: string;
  status: string;
  category?: string | null;
  actionTaken?: string | null;
  notes?: string | null;
  reporterName?: string | null;
  violationDate?: string | Date | null;
}): EmailContent {
  const subject = `A violation has been logged on your record`;
  const link = `${appUrl()}/dashboard/violations`;
  const sev   = SEVERITY_LABEL[args.severity] ?? args.severity;
  const stat  = STATUS_LABEL[args.status] ?? args.status;
  const statColor = STATUS_COLOR[args.status] ?? "#64748b";
  const dateLabel = args.violationDate ? fmtDate(args.violationDate) : null;

  const rows: Array<[string, string]> = [];
  rows.push(["Title",    args.title]);
  if (args.category)      rows.push(["Category", args.category]);
  rows.push(["Severity",  sev]);
  rows.push(["Status",    `<span style="color:${statColor};font-weight:600">${stat}</span>`]);
  if (dateLabel)          rows.push(["Date",     dateLabel]);
  if (args.reporterName)  rows.push(["Reported by", args.reporterName]);

  const detailsTable = rows.map(([k, v]) => `
    <tr>
      <td style="padding:6px 12px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;width:120px;vertical-align:top">${escape(k)}</td>
      <td style="padding:6px 12px;font-size:13.5px;color:#1f2937">${v}</td>
    </tr>`).join("");

  const body = `
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6">
      Hi ${escape(args.userName)}, a policy / conduct violation has been recorded against your name.
      Full details are below.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:14px 0;background:#f8fafc;border-radius:6px;overflow:hidden">
      ${detailsTable}
    </table>
    ${args.description ? `
      <div style="margin-top:14px;padding:12px;background:#fff;border:1px solid #e5e7eb;border-radius:6px">
        <p style="margin:0 0 4px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">Description</p>
        <p style="margin:0;font-size:13.5px;color:#1f2937;line-height:1.55;white-space:pre-wrap">${escape(args.description)}</p>
      </div>
    ` : ""}
    ${args.actionTaken ? `
      <div style="margin-top:10px;padding:12px;background:#fff;border:1px solid #e5e7eb;border-radius:6px">
        <p style="margin:0 0 4px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">Action taken</p>
        <p style="margin:0;font-size:13.5px;color:#1f2937;line-height:1.55;white-space:pre-wrap">${escape(args.actionTaken)}</p>
      </div>
    ` : ""}
    ${args.notes ? `
      <div style="margin-top:10px;padding:12px;background:#fff;border:1px solid #e5e7eb;border-radius:6px">
        <p style="margin:0 0 4px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">Notes</p>
        <p style="margin:0;font-size:13.5px;color:#1f2937;line-height:1.55;white-space:pre-wrap">${escape(args.notes)}</p>
      </div>
    ` : ""}
    <p style="margin:18px 0 0;font-size:12.5px;color:#64748b;line-height:1.55">
      If you'd like to discuss this, reach out to HR or your manager directly.
    </p>
    ${ctaButton("View on dashboard", link)}
  `;
  const text = [
    `Hi ${args.userName},`,
    `A violation has been recorded against your name.`,
    ``,
    `Title: ${args.title}`,
    args.category ? `Category: ${args.category}` : null,
    `Severity: ${sev}`,
    `Status: ${stat}`,
    dateLabel ? `Date: ${dateLabel}` : null,
    args.reporterName ? `Reported by: ${args.reporterName}` : null,
    args.description ? `\nDescription:\n${args.description}` : null,
    args.actionTaken ? `\nAction taken:\n${args.actionTaken}` : null,
    args.notes ? `\nNotes:\n${args.notes}` : null,
    ``,
    `Open: ${link}`,
  ].filter(Boolean).join("\n");
  return { subject, html: SHELL(subject, body), text };
}

// Sent to the affected employee whenever the status (or action / notes)
// changes — open → in_progress → closed, etc.
export function violationStatusChangedEmail(args: {
  userName: string;
  title: string;
  oldStatus: string;
  newStatus: string;
  actionTaken?: string | null;
  notes?: string | null;
  changedByName?: string | null;
}): EmailContent {
  const newStat   = STATUS_LABEL[args.newStatus] ?? args.newStatus;
  const newColor  = STATUS_COLOR[args.newStatus] ?? "#64748b";
  const oldStat   = STATUS_LABEL[args.oldStatus] ?? args.oldStatus;

  const subject = `Update on your violation: ${newStat}`;
  const link = `${appUrl()}/dashboard/violations`;
  const body = `
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6">
      Hi ${escape(args.userName)}, the status of the violation
      <strong>${escape(args.title)}</strong> has been updated.
    </p>
    <div style="margin:14px 0;padding:14px;background:#f8fafc;border-radius:6px;display:inline-block;width:100%;box-sizing:border-box">
      <span style="font-size:12px;color:#64748b">${escape(oldStat)}</span>
      <span style="font-size:12px;color:#94a3b8;margin:0 8px">→</span>
      <span style="font-size:13.5px;color:${newColor};font-weight:600">${escape(newStat)}</span>
      ${args.changedByName ? `<span style="font-size:11.5px;color:#94a3b8;margin-left:8px">by ${escape(args.changedByName)}</span>` : ""}
    </div>
    ${args.actionTaken ? `
      <div style="margin-top:10px;padding:12px;background:#fff;border:1px solid #e5e7eb;border-radius:6px">
        <p style="margin:0 0 4px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">Action taken</p>
        <p style="margin:0;font-size:13.5px;color:#1f2937;line-height:1.55;white-space:pre-wrap">${escape(args.actionTaken)}</p>
      </div>
    ` : ""}
    ${args.notes ? `
      <div style="margin-top:10px;padding:12px;background:#fff;border:1px solid #e5e7eb;border-radius:6px">
        <p style="margin:0 0 4px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">Notes</p>
        <p style="margin:0;font-size:13.5px;color:#1f2937;line-height:1.55;white-space:pre-wrap">${escape(args.notes)}</p>
      </div>
    ` : ""}
    ${ctaButton("View on dashboard", link)}
  `;
  const text = [
    `Hi ${args.userName},`,
    `The status of the violation "${args.title}" has changed: ${oldStat} → ${newStat}${args.changedByName ? ` (by ${args.changedByName})` : ""}.`,
    args.actionTaken ? `\nAction taken:\n${args.actionTaken}` : null,
    args.notes ? `\nNotes:\n${args.notes}` : null,
    ``,
    `Open: ${link}`,
  ].filter(Boolean).join("\n");
  return { subject, html: SHELL(subject, body), text };
}

// Cron-scheduled gentle nudge to HR / CEO / admins when a violation has
// been sitting "in progress" for too long. Sent at most every 15 days
// per violation — throttle is enforced by Violation.lastReminderAt.
export function violationInProgressReminderEmail(args: {
  recipientName?: string | null;
  affectedUserName: string;
  title: string;
  daysOpen: number;
  severity: string;
  category?: string | null;
  reporterName?: string | null;
  actionTaken?: string | null;
}): EmailContent {
  const subject = `Reminder: violation for ${args.affectedUserName} is still in progress`;
  const link = `${appUrl()}/dashboard/violations`;
  const sev = SEVERITY_LABEL[args.severity] ?? args.severity;

  const rows: Array<[string, string]> = [];
  rows.push(["Employee", args.affectedUserName]);
  rows.push(["Title",    args.title]);
  if (args.category)     rows.push(["Category", args.category]);
  rows.push(["Severity", sev]);
  rows.push(["Open for", `${args.daysOpen} day${args.daysOpen === 1 ? "" : "s"}`]);
  if (args.reporterName) rows.push(["Reported by", args.reporterName]);

  const tableHtml = rows.map(([k, v]) => `
    <tr>
      <td style="padding:6px 12px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;width:130px;vertical-align:top">${escape(k)}</td>
      <td style="padding:6px 12px;font-size:13.5px;color:#1f2937">${escape(v)}</td>
    </tr>`).join("");

  const body = `
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6">
      ${args.recipientName ? `Hi ${escape(args.recipientName)},` : "Hi,"} a violation marked as <strong>in progress</strong>
      hasn't been closed yet. Could someone take another look?
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:14px 0;background:#f8fafc;border-radius:6px;overflow:hidden">
      ${tableHtml}
    </table>
    ${args.actionTaken ? `
      <div style="margin-top:10px;padding:12px;background:#fff;border:1px solid #e5e7eb;border-radius:6px">
        <p style="margin:0 0 4px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">Last action taken</p>
        <p style="margin:0;font-size:13.5px;color:#1f2937;line-height:1.55;white-space:pre-wrap">${escape(args.actionTaken)}</p>
      </div>
    ` : ""}
    <p style="margin:18px 0 0;font-size:12.5px;color:#64748b;line-height:1.55">
      You're getting this reminder because the matter is still showing
      "in progress". Update the status to "closed" once it's resolved.
    </p>
    ${ctaButton("Open the violation", link)}
  `;
  const text = [
    args.recipientName ? `Hi ${args.recipientName},` : "Hi,",
    `A violation marked "in progress" still hasn't been closed.`,
    ``,
    `Employee: ${args.affectedUserName}`,
    `Title: ${args.title}`,
    args.category ? `Category: ${args.category}` : null,
    `Severity: ${sev}`,
    `Open for: ${args.daysOpen} day${args.daysOpen === 1 ? "" : "s"}`,
    args.reporterName ? `Reported by: ${args.reporterName}` : null,
    args.actionTaken ? `\nLast action taken:\n${args.actionTaken}` : null,
    ``,
    `Open: ${link}`,
  ].filter(Boolean).join("\n");
  return { subject, html: SHELL(subject, body), text };
}
