// Create a test job for testing the referral flow. Inserts the
// row directly into JobOpening (bypassing the publish API) so the
// referral fanout DOES NOT email every employee during testing.
//
// After testing, run scripts/_delete-test-referral-job.ts to wipe
// the job + any referral applications created against it.

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import prisma from "../src/lib/prisma";

const TITLE        = "TEST — Referral Flow Smoke Test (delete me)";
const SLUG         = "test-referral-flow-smoke";

async function main() {
  // Ensure we don't pile up duplicates if the script is re-run.
  const existing = (await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, title FROM "JobOpening" WHERE title = $1 LIMIT 1`, TITLE,
  ))[0];
  if (existing) {
    console.log(`Test job already exists: #${existing.id}  "${existing.title}"`);
    console.log("Run scripts/_delete-test-referral-job.ts to remove it first.");
    return;
  }

  const inserted = await prisma.$queryRawUnsafe<any[]>(
    `INSERT INTO "JobOpening"
       (title, department, location, "isOpen", brand,
        "employmentType", "experienceLevel",
        status, "publishChannels", "publishedAt",
        "publicSlug", vacancies, "isPriority",
        "allowReapplyDays", "archiveAfterFilled",
        "inboundOwnerStrategy", "interviewFeedbackVisibility",
        "recruitersAccessOwnOnly", "interviewersAccessOwnOnly",
        "notifyRecruiterOnNewCandidate", "notifyHiringMgrOnNewCandidate",
        "createdAt", "updatedAt")
     VALUES
       ($1, $2, $3, true, $4,
        $5, $6,
        'published', $7::text[], NOW(),
        $8, 1, false,
        0, false,
        'none', 'open',
        false, false,
        false, false,
        NOW(), NOW())
     RETURNING id, title, "publicSlug"`,
    TITLE,                        // $1
    "Human Resource",             // $2
    "Mohali",                     // $3
    "nb_media",                   // $4 brand
    "Full-time",                  // $5
    "Mid-level (2-5 yrs)",        // $6
    ["career_site", "referral"],  // $7
    SLUG,                         // $8
  );

  const job = inserted[0];
  console.log(`✓ Created test job #${job.id}`);
  console.log(`  Title : ${job.title}`);
  console.log(`  Slug  : ${job.publicSlug}`);
  console.log(`  Status: published, referral channel ENABLED`);
  console.log(``);
  console.log(`Visible at:`);
  console.log(`  /dashboard/hr/referrals     (referrals page — every employee)`);
  console.log(`  /dashboard/hr/hiring        (Hiring tab → Jobs)`);
  console.log(`  /jobs/${job.publicSlug}     (public JD page)`);
  console.log(``);
  console.log(`After testing, run:`);
  console.log(`  npx tsx scripts/_delete-test-referral-job.ts`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect().catch(()=>{}));
