// Sends ONE test email through the app's actual transport so you
// can verify the From header in your inbox. No data writes, no
// templates — just enough HTML to confirm SMTP_USER + SMTP_FROM_NAME
// are what you expect.
//
// Run:  npx tsx scripts/_smtp-send-test.ts you@example.com
//
// The recipient is the only required arg. The script prints the
// resolved sender header before sending so you can sanity-check it.

import * as fs from "node:fs";
import * as path from "node:path";

// Inline .env loader (no `dotenv` dep on the project).
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

import nodemailer from "nodemailer";

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error("Usage: npx tsx scripts/_smtp-send-test.ts you@example.com");
    process.exit(1);
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || "465");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const fromName = process.env.SMTP_FROM_NAME || "NB Media";
  if (!host || !user || !pass) {
    console.error("Missing SMTP_HOST / SMTP_USER / SMTP_PASS in env.");
    process.exit(1);
  }
  const fromHeader = `"${fromName}" <${user}>`;

  console.log(`SMTP host  : ${host}:${port}`);
  console.log(`From       : ${fromHeader}`);
  console.log(`To         : ${to}`);
  console.log(`EMAIL_DRY_RUN: ${process.env.EMAIL_DRY_RUN ?? "(unset)"}`);
  console.log("");

  if (process.env.EMAIL_DRY_RUN === "true") {
    console.log("⚠ EMAIL_DRY_RUN=true is set — flip it to false (or unset) to actually send.");
    process.exit(0);
  }

  const t = nodemailer.createTransport({
    host, port, secure: port === 465, auth: { user, pass },
  });

  await t.verify();
  console.log("✓ SMTP login OK. Sending test email…");

  const info = await t.sendMail({
    from:    fromHeader,
    to,
    subject: "SMTP test — verify the sender header",
    text:    `If you can read this, the message reached you.\nFrom header should read: ${fromHeader}\nTimestamp: ${new Date().toISOString()}`,
    html: `<p>If you can read this, the message reached you.</p>
           <p><b>From header should read:</b> ${fromHeader.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
           <p>Timestamp: ${new Date().toISOString()}</p>`,
  });

  console.log("✓ Sent. messageId:", info.messageId);
  console.log("Open the email in Gmail → click the small ▾ next to your name → check the 'from:' line.");
}

main().catch((e) => { console.error("✗ failed:", e?.message || e); process.exit(1); });
