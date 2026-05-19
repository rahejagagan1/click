/**
 * Exercises every email template export with real-looking data and
 * scans the result for quality bugs (broken articles, leaked
 * `${...}` literals, empty subject, missing plain-text fallback,
 * double-spaces from dropped variables, etc.). Run with:
 *     npx tsx scripts/_audit-emails.ts
 */
import * as T from "../src/lib/email/templates";

type Result = { name: string; subject: string; bugs: string[] };
const results: Result[] = [];

function audit(name: string, c: { subject: string; html: string; text: string }) {
  const bugs: string[] = [];
  if (!c.subject || c.subject.length < 6) bugs.push("subject empty or too short");
  if (/undefined|\bnull\b|NaN/.test(c.subject + c.text)) bugs.push("contains undefined/null/NaN");
  if (/\$\{/.test(c.subject + c.html + c.text)) bugs.push("template-literal leak (${...})");
  // Strip HTML before checking for double-spaces — HTML has lots of
  // legitimate whitespace inside tags that aren't visible to readers.
  const textOnly = c.text || "";
  if (/[A-Za-z]  +[A-Za-z]/.test(textOnly)) bugs.push("double-space in text body (dropped variable?)");
  // "a " followed by a vowel — broken article (e.g. "a On-Duty")
  if (/\ba [aeiouAEIOU]/.test(c.subject)) bugs.push(`broken article in subject: "${c.subject.match(/a [aeiouAEIOU]\w+/)?.[0]}"`);
  if (/\ban [^aeiouAEIOU\s]/.test(c.subject)) bugs.push(`broken article in subject: "${c.subject.match(/an [^aeiouAEIOU\s]\w+/)?.[0]}"`);
  if (!/<html|<body|<div|<table/i.test(c.html)) bugs.push("html appears to be plain text");
  if (!textOnly.trim() || textOnly.trim().length < 20) bugs.push("text fallback empty or stub");
  results.push({ name, subject: c.subject, bugs });
}

const fromDate = new Date("2026-05-11T00:00:00Z");
const toDate   = new Date("2026-05-19T00:00:00Z");
const today    = new Date("2026-05-19T03:53:35Z");

// ── Per-request templates ────────────────────────────────────────────
audit("leaveRequest",          T.leaveRequestEmail({ applicantName: "Arpit Sharma", leaveType: "SL", fromDate, toDate, totalDays: 7, reason: "Grand mother got expired" }));
audit("leaveRequest+L1+L2",    T.leaveRequestEmail({ applicantName: "Arpit Sharma", leaveType: "SL", fromDate, toDate, totalDays: 7, reason: "Grand mother got expired", l1ApproverName: "Nikit Bassi", l1ApprovalNote: "OK", approverName: "Aviral", stageLabel: "Approved by", approvalNote: "Final OK" }));
audit("wfhRequest",            T.wfhRequestEmail({ applicantName: "Arpit Sharma", date: fromDate, toDate, reason: "Grand mother got expired" }));
audit("onDutyRequest",         T.onDutyRequestEmail({ applicantName: "Arpit Sharma", date: fromDate, location: "Client site", reason: "Project review" }));
audit("regularizationRequest", T.regularizationRequestEmail({ applicantName: "Arpit Sharma", date: fromDate, reason: "Forgot to clock out" }));
audit("compOffRequest",        T.compOffRequestEmail({ applicantName: "Arpit Sharma", workedDate: fromDate, creditDays: 1, reason: "Worked on Sunday for launch" }));

// ── Decision (used for stage transitions on legacy paths) ────────────
audit("decision-approved-a",   T.decisionEmail({ applicantName: "Arpit Sharma", typeLabel: "Leave",   outcome: "approved", approverName: "Nikit Bassi", note: "OK" }));
audit("decision-rejected-an",  T.decisionEmail({ applicantName: "Arpit Sharma", typeLabel: "On-Duty", outcome: "rejected", approverName: "Nikit Bassi", note: "Need details" }));
audit("decision-approved-an",  T.decisionEmail({ applicantName: "Arpit Sharma", typeLabel: "Expense", outcome: "approved", approverName: "Nikit Bassi" }));

// ── Operational ──────────────────────────────────────────────────────
audit("attendanceReminder-in",  T.attendanceReminderEmail({ userName: "Arpit Sharma", kind: "clock-in" }));
audit("attendanceReminder-out", T.attendanceReminderEmail({ userName: "Arpit Sharma", kind: "clock-out" }));
audit("hrLateSummary",          T.hrLateSummaryEmail({ today, absent: [{ name: "Anjali", department: "QA" }], late: [{ name: "Arpit Sharma", clockIn: today, department: "AI" }], totals: { absent: 1, late: 1, onTime: 60, onLeave: 2 } }));
audit("reportSubmitted-weekly", T.reportSubmittedEmail({ kind: "weekly", periodLabel: "11-17 May 2026", managerName: "Arpit Sharma", link: "https://app.example.com/r/123" }));
audit("reportSubmitted-monthly",T.reportSubmittedEmail({ kind: "monthly", periodLabel: "May 2026", managerName: "Arpit Sharma", link: "https://app.example.com/r/456" }));
audit("feedback",               T.feedbackEmail({ category: "Bug", message: "Modal won't close on mobile Safari." }));
audit("employeeFarewell",       T.employeeFarewellEmail({ name: "Arpit Sharma", lastWorkingDay: today }));
audit("exitNotification",       T.exitNotificationEmail({ name: "Arpit Sharma", email: "arpit@nbmediaproductions.com", exitType: "Resignation", lastWorkingDay: today, reason: "Better opportunity" }));
audit("jobApplication",         T.jobApplicationEmail({ name: "Jane Doe", email: "jane@example.com", phone: "+91 9000000000", role: "Engineer", link: "https://example.com/cv.pdf" }));
audit("welcomeLogin-onboard",   T.welcomeLoginEmail({ name: "Arpit Sharma", email: "arpit@nbmediaproductions.com", needsOnboarding: true }));
audit("welcomeLogin-existing",  T.welcomeLoginEmail({ name: "Arpit Sharma", email: "arpit@nbmediaproductions.com", needsOnboarding: false }));
audit("announcement",           T.announcementEmail({ title: "Server migration tonight", body: "We are migrating servers tonight at 10pm IST.", authorName: "Admin" }));
audit("violationCreated",       T.violationCreatedEmail({ userName: "Arpit Sharma", title: "Late punch", description: "3rd late this month", severity: "minor", status: "open", category: "Attendance", reporterName: "HR" }));
audit("violationStatus",        T.violationStatusChangedEmail({ userName: "Arpit Sharma", title: "Late punch", oldStatus: "open", newStatus: "resolved", changedByName: "HR" }));
audit("violationReminder",      T.violationInProgressReminderEmail({ recipientName: "HR Team", affectedUserName: "Arpit Sharma", title: "Late punch", daysOpen: 7, severity: "minor", category: "Attendance", reporterName: "HR" }));

// ── Print ────────────────────────────────────────────────────────────
console.log("\n=== Email template audit — " + results.length + " templates ===\n");
let ok = 0, fail = 0;
for (const r of results) {
  if (r.bugs.length === 0) {
    ok++;
    console.log("  \x1b[32m✓\x1b[0m " + r.name.padEnd(28) + " " + r.subject.slice(0, 80));
  } else {
    fail++;
    console.log("  \x1b[31m✗\x1b[0m " + r.name.padEnd(28) + " " + r.subject.slice(0, 80));
    for (const b of r.bugs) console.log("        \x1b[31m→\x1b[0m " + b);
  }
}
console.log("\n" + (fail === 0 ? "\x1b[32m" : "\x1b[31m") + ok + " passed, " + fail + " failed\x1b[0m");
process.exit(fail === 0 ? 0 : 1);
