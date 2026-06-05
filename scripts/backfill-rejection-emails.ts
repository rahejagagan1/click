// One-off backfill — sends the Candidate Rejection email to every
// applicant currently in status='rejected' who hasn't already been
// emailed. Logs every send to CandidateActivity so it's safe to
// re-run (already-emailed candidates are skipped).
//
// Run from the VPS where production SMTP is live:
//   cd ~/NB_Projects/ClickUp_Integration/nb-dashboard
//   npx tsx scripts/backfill-rejection-emails.ts
//
// Add --dry-run to preview without sending:
//   npx tsx scripts/backfill-rejection-emails.ts --dry-run

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import prisma from "../src/lib/prisma";
import { resolveTemplate } from "../src/lib/hr/email-merge";
import { sendEmail } from "../src/lib/email/sender";

const REJECTION_TEMPLATE_ID = 1;
const DRY_RUN = process.argv.includes("--dry-run");

function isValidEmail(e: string | null | undefined): boolean {
  if (!e) return false;
  // Standard TLDs are 2–6 letters (com, org, net, io, dev,
  // museum). Capping at 6 rejects garbage like
  // "user@gmail.comInstagram" where extra text was concatenated
  // after the real TLD. Also rejects multi-word junk after a
  // valid-looking address.
  const m = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,6}$/.exec(e.trim());
  return !!m;
}

async function main() {
  console.log(`${DRY_RUN ? "[DRY RUN] " : ""}Backfill rejection emails — starting.`);

  // 1. Find every rejected applicant with a plausibly-valid email
  // that hasn't already received the rejection email.
  const apps = await prisma.$queryRawUnsafe<any[]>(
    `SELECT a.id, a."fullName", a.email
       FROM "JobApplication" a
      WHERE a.status = 'rejected'
        AND a.email IS NOT NULL
        AND a.email != ''
        AND NOT EXISTS (
          SELECT 1 FROM "CandidateActivity" c
           WHERE c."applicationId" = a.id
             AND c.kind = 'email_sent'
             AND (c.meta->>'templateKey' = 'rejection'
                  OR c.summary ILIKE '%rejection%')
        )
      ORDER BY a.id ASC`,
  );

  // Skip emails that fail validation.
  const valid: any[] = [];
  const skipped: any[] = [];
  for (const a of apps) {
    if (isValidEmail(a.email)) valid.push(a);
    else skipped.push(a);
  }

  console.log(`  Candidates to email   : ${valid.length}`);
  console.log(`  Skipped (bad email)   : ${skipped.length}`);
  for (const s of skipped) console.log(`    SKIP  #${s.id}  ${s.fullName}  <${s.email}>`);

  if (valid.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let sent = 0;
  let failed = 0;
  for (const a of valid) {
    try {
      const resolved = await resolveTemplate({
        templateId:    REJECTION_TEMPLATE_ID,
        applicationId: a.id,
      });
      if (!resolved.to) {
        console.log(`  SKIP   #${a.id}  ${a.fullName}  — resolveTemplate returned no recipient.`);
        continue;
      }
      if (DRY_RUN) {
        console.log(`  DRY    #${a.id}  ${a.fullName}  → ${resolved.to}  (would send "${resolved.subject}")`);
        continue;
      }
      await sendEmail({
        to: resolved.to,
        content: {
          subject: resolved.subject,
          html:    resolved.bodyHtml,
          text:    resolved.bodyHtml.replace(/<[^>]+>/g, ""),
        } as any,
      });
      // Log so a re-run skips this row.
      await prisma.$executeRawUnsafe(
        `INSERT INTO "CandidateActivity" ("applicationId", "kind", "summary", "meta", "actorId")
         VALUES ($1, 'email_sent', $2, $3::jsonb, NULL)`,
        a.id,
        `Backfill: ${resolved.subject}`,
        JSON.stringify({ templateKey: "rejection", to: resolved.to, auto: false, backfill: true }),
      );
      sent++;
      console.log(`  SENT   #${a.id}  ${a.fullName}  → ${resolved.to}`);
    } catch (e: any) {
      failed++;
      console.error(`  FAIL   #${a.id}  ${a.fullName}: ${e?.message ?? e}`);
    }
  }
  console.log(`\nDone. sent=${sent}  failed=${failed}  skipped=${skipped.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect().catch(() => {}));
