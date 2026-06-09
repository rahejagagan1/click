// Wipe the test job + every JobApplication / Notification /
// stage-history row tied to it. Use after the referral flow smoke
// test is done. Idempotent — safe to run even if the job is
// already gone.

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import prisma from "../src/lib/prisma";

const TITLE = "TEST — Referral Flow Smoke Test (delete me)";

async function main() {
  const job = (await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, title FROM "JobOpening" WHERE title = $1 LIMIT 1`, TITLE,
  ))[0];
  if (!job) { console.log("No test job to delete."); return; }
  console.log(`Found test job #${job.id} — "${job.title}"\n`);

  // 1. Notifications fired by the publish fanout (entityId = jobId, type = 'referral_open').
  const notifs = await prisma.$executeRawUnsafe(
    `DELETE FROM "Notification" WHERE type = 'referral_open' AND "entityId" = $1`, job.id,
  );
  console.log(`  ✓ Deleted ${notifs} notification row(s)`);

  // 2. Applications attached to this job + their stage history.
  const apps = (await prisma.$queryRawUnsafe<any[]>(
    `SELECT id FROM "JobApplication" WHERE "jobOpeningId" = $1`, job.id,
  ));
  if (apps.length > 0) {
    const ids = apps.map((a: any) => a.id);
    await prisma.$executeRawUnsafe(
      `DELETE FROM "JobApplicationStage" WHERE "applicationId" = ANY($1::int[])`, ids,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "CandidateActivity" WHERE "applicationId" = ANY($1::int[])`, ids,
    );
    const removed = await prisma.$executeRawUnsafe(
      `DELETE FROM "JobApplication" WHERE id = ANY($1::int[])`, ids,
    );
    console.log(`  ✓ Deleted ${removed} JobApplication row(s) (and their history)`);
  } else {
    console.log(`  · No applications attached`);
  }

  // 3. Any JobLocation rows we might have spawned.
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "JobLocation" WHERE "jobOpeningId" = $1`, job.id,
    );
  } catch { /* table may not exist on every env */ }

  // 4. The job itself.
  await prisma.$executeRawUnsafe(`DELETE FROM "JobOpening" WHERE id = $1`, job.id);
  console.log(`\n✓ Deleted test job #${job.id}`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect().catch(()=>{}));
