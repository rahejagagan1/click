/**
 * Sends one of each attendance reminder email — clock-in and clock-out —
 * to the address at the top of this file. Useful for verifying the
 * format before the scheduler fires for real at 09:58 / 20:00 IST.
 *
 * Run with:  npx tsx scripts/_test-reminders.ts
 */
import nodemailer from "nodemailer";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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
  } catch { /* no .env */ }
}
loadDotEnv();

import { attendanceReminderEmail } from "../src/lib/email/templates";

const TO = "arpitsharma4602@gmail.com";

async function main() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");
  const port = Number(process.env.SMTP_PORT || 465);
  if (!host || !user || !pass) {
    console.error("❌ SMTP_HOST / SMTP_USER / SMTP_PASS missing.");
    process.exit(1);
  }

  // Logo as an inline CID attachment — same way production sender does it.
  const logoPath = resolve(process.cwd(), "public", "logo.png");
  const attachments = existsSync(logoPath)
    ? [{ filename: "logo.png", content: readFileSync(logoPath), cid: "logo", contentType: "image/png" }]
    : undefined;

  const t = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  await t.verify();
  console.log(`✅ SMTP login OK. Sending 2 reminder samples to ${TO}\n`);

  const samples = [
    { label: "Clock-IN reminder",  content: attendanceReminderEmail({ userName: "Arpit Sharma", kind: "clock-in"  }) },
    { label: "Clock-OUT reminder", content: attendanceReminderEmail({ userName: "Arpit Sharma", kind: "clock-out" }) },
  ];

  for (const s of samples) {
    try {
      const info = await t.sendMail({
        from:    `"${process.env.SMTP_FROM_NAME || "NB Media HR"}" <${user}>`,
        to:      TO,
        subject: `[REMINDER TEST] ${s.content.subject}`,
        html:    s.content.html,
        text:    s.content.text,
        attachments,
      });
      console.log(`  ✅ ${s.label}  →  ${info.messageId}`);
    } catch (e: any) {
      console.log(`  ❌ ${s.label}  →  ${e?.message || e}`);
    }
  }

  console.log(`\nDone. Check ${TO}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
