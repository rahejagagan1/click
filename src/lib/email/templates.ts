// Email templates for HR notifications. Every template returns
// { subject, html, text } so the sender doesn't care which type it is.
//
// Plain-text alternatives are mandatory — many corporate mail clients
// (and some Gmail filters) downrank emails that lack a text fallback.

import { appUrl } from "./transport";

export type EmailContent = { subject: string; html: string; text: string };

// ── Shared chrome ──────────────────────────────────────────────────────
const SHELL = (title: string, body: string) => `
<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#0f6ecd;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0">
      <p style="margin:0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.85">NB Media HR</p>
      <h1 style="margin:4px 0 0;font-size:18px;font-weight:600">${title}</h1>
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
