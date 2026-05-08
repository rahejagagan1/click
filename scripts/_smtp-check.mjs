import nodemailer from "nodemailer";
import "dotenv/config";

const t = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

console.log("Verifying SMTP login as", process.env.SMTP_USER, "→", process.env.SMTP_HOST + ":" + process.env.SMTP_PORT);
try {
  await t.verify();
  console.log("✓ SMTP credentials valid — Gmail accepted the App Password.");
} catch (e) {
  console.error("✗ SMTP verify failed:", e.message);
  process.exit(1);
}
