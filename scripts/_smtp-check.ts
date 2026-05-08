// One-shot SMTP credential check. Loads .env, verifies the Gmail
// SMTP login (no email is sent — only the auth handshake runs).
//
// Run:  npx tsx scripts/_smtp-check.ts

// Tiny inline .env loader — `dotenv` isn't a project dep.
import * as fs from "node:fs";
import * as path from "node:path";
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
import nodemailer from "nodemailer";

async function main() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || "465");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.error("✗ Missing SMTP_HOST / SMTP_USER / SMTP_PASS in .env");
    process.exit(1);
  }
  console.log(`Verifying SMTP login as ${user} → ${host}:${port}`);
  console.log(`Password length: ${pass.length} chars (App Passwords are 16 chars without spaces)`);

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  try {
    await transport.verify();
    console.log("✓ SMTP credentials valid — Gmail accepted the App Password.");
    console.log(`  EMAIL_DRY_RUN=${process.env.EMAIL_DRY_RUN ?? "(unset, so real sends)"}`);
  } catch (e: any) {
    console.error("✗ SMTP verify failed:");
    console.error(`  code: ${e?.code || "(none)"}`);
    console.error(`  msg : ${e?.message}`);
    if (e?.response) console.error(`  smtp: ${e.response}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
