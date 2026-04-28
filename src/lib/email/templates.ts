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
