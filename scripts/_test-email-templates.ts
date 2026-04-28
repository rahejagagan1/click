/**
 * Renders every HR email template and sends one of each to a single
 * inbox so you can eyeball the formatting end-to-end.
 *
 * Run with:  npx tsx scripts/_test-email-templates.ts
 *
 * Edits the recipient at the top of the file.
 */
import nodemailer from "nodemailer";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Tiny .env loader (no `dotenv` dep — mirrors what next.js does at runtime).
function loadDotEnv() {
  try {
    const txt = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch { /* no .env — rely on shell env */ }
}
loadDotEnv();

import {
  leaveRequestEmail,
  wfhRequestEmail,
  onDutyRequestEmail,
  regularizationRequestEmail,
  compOffRequestEmail,
  decisionEmail,
  announcementEmail,
} from "../src/lib/email/templates";

// Edit if needed.
const TO = "arpitsharma4602@gmail.com";

// Sample data — realistic-looking so the rendering reflects production.
const samples = [
  {
    label: "1/8 — Leave request",
    content: leaveRequestEmail({
      applicantName: "Arpit Sharma",
      leaveType: "Sick Leave",
      fromDate: "2026-05-04",
      toDate: "2026-05-06",
      totalDays: 3,
      reason: "Down with the flu — will resume on Monday.",
    }),
  },
  {
    label: "2/8 — WFH request",
    content: wfhRequestEmail({
      applicantName: "Arpit Sharma",
      date: "2026-05-02",
      reason: "Plumber visit at home — can be available on Slack the whole day.",
    }),
  },
  {
    label: "3/8 — On-Duty request",
    content: onDutyRequestEmail({
      applicantName: "Arpit Sharma",
      date: "2026-05-08",
      location: "Client meeting — Hyatt Regency, Chandigarh",
      reason: "Sit-in for the Q2 marketing review with the client team.",
    }),
  },
  {
    label: "4/8 — Regularization request",
    content: regularizationRequestEmail({
      applicantName: "Arpit Sharma",
      date: "2026-04-29",
      reason: "Phone died before clock-in; came in at 09:14 IST as usual.",
    }),
  },
  {
    label: "5/8 — Comp-off request",
    content: compOffRequestEmail({
      applicantName: "Arpit Sharma",
      workedDate: "2026-04-26",
      creditDays: 1,
      reason: "Worked Saturday for the YouTube quarterly publish.",
    }),
  },
  {
    label: "6/8 — Decision (approved)",
    content: decisionEmail({
      applicantName: "Arpit Sharma",
      typeLabel: "leave",
      outcome: "approved",
      approverName: "Tanvi Dogra",
      note: "Get well soon — cleared with no objections from the team.",
    }),
  },
  {
    label: "7/8 — Decision (rejected)",
    content: decisionEmail({
      applicantName: "Arpit Sharma",
      typeLabel: "WFH",
      outcome: "rejected",
      approverName: "Anand Gautam",
      note: "Sprint review on the same day — needs everyone in office.",
    }),
  },
  {
    label: "8/8 — Announcement",
    content: announcementEmail({
      title: "Holiday calendar for May 2026",
      authorName: "HR — NB Media",
      body:
`Team,

Heads up — May has two public holidays:

• Fri, 01 May — Labour Day
• Mon, 12 May — Buddha Purnima (floater)

Please plan your sprints accordingly. The full calendar is on the Holidays page.

— HR`,
    }),
  },
];

async function main() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");
  const port = Number(process.env.SMTP_PORT || 465);

  if (!host || !user || !pass) {
    console.error("❌ SMTP_HOST / SMTP_USER / SMTP_PASS are not all set in .env.");
    process.exit(1);
  }

  const t = nodemailer.createTransport({
    host, port, secure: port === 465, auth: { user, pass },
  });

  console.log(`Connecting to ${host}:${port} as ${user} …`);
  await t.verify();
  console.log("✅ SMTP login successful.\n");
  console.log(`Sending ${samples.length} sample emails to ${TO}:\n`);

  let ok = 0;
  for (const s of samples) {
    try {
      const info = await t.sendMail({
        from: `"${process.env.SMTP_FROM_NAME || "NB Media"}" <${user}>`,
        to: TO,
        subject: `[TEMPLATE TEST] ${s.content.subject}`,
        html: s.content.html,
        text: s.content.text,
      });
      console.log(`  ✅ ${s.label}  →  ${info.messageId}`);
      ok++;
    } catch (e: any) {
      console.log(`  ❌ ${s.label}  →  ${e?.message || e}`);
    }
  }

  console.log(`\n${ok}/${samples.length} sent. Check ${TO}.`);
}

main().catch((e) => {
  console.error("❌ Fatal:", e?.message || e);
  process.exit(1);
});
