/**
 * SMTP smoke test. Sends one email to the recipient you supply at the top.
 * Run with:  npx tsx scripts/_test-smtp.ts
 *
 * Reads the same SMTP_* env vars the production code uses, so a green run
 * here means real notifications will work.
 */
import nodemailer from "nodemailer";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Tiny .env loader — the project doesn't depend on `dotenv` directly,
// next.js loads .env at runtime, so we mirror that behaviour for this script.
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

// Edit this to where you want the test mail to land.
const TO = "arpitsharma4602@gmail.com";

async function main() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  // Gmail app passwords are displayed with spaces every 4 chars; the spaces
  // are cosmetic only. Strip them so the auth string is exactly 16 chars.
  const pass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");
  const port = Number(process.env.SMTP_PORT || 465);

  if (!host || !user || !pass) {
    console.error("❌ SMTP_HOST / SMTP_USER / SMTP_PASS are not all set in .env.");
    process.exit(1);
  }

  console.log(`Connecting to ${host}:${port} as ${user} …`);

  const t = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  // Verify the connection + auth before trying to send.
  await t.verify();
  console.log("✅ SMTP login successful.");

  const info = await t.sendMail({
    from: `"${process.env.SMTP_FROM_NAME || "NB Media"}" <${user}>`,
    to: TO,
    subject: "NB Dashboard — SMTP test",
    text: "This is a one-off smoke test from scripts/_test-smtp.ts.\n\nIf you can read this, your SMTP config is good.",
    html: `<p>This is a one-off smoke test from <code>scripts/_test-smtp.ts</code>.</p>
           <p>If you can read this, your SMTP config is good. ✅</p>`,
  });

  console.log(`✅ Sent. Message ID: ${info.messageId}`);
  console.log(`   Accepted: ${info.accepted.join(", ")}`);
  if (info.rejected.length) console.log(`   Rejected: ${info.rejected.join(", ")}`);
}

main().catch((e) => {
  console.error("❌ Send failed:");
  console.error(e?.message || e);
  process.exit(1);
});
