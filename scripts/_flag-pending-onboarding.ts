// One-shot: flips User.onboardingPending = true for anyone who is
// active, has an EmployeeProfile (i.e. they've been onboarded by HR),
// but hasn't gone through the first-login wizard yet.
//
// Heuristic: EmployeeProfile.emergencyContact IS NULL.
// Rationale: that field is set ONLY by the wizard
// (/api/onboarding/complete writes it; Keka doesn't export it; HR's
// Edit Profile lets HR overwrite it but new rows start NULL). So a
// NULL value is a near-certain signal the user never finished the
// wizard. The previous heuristic (panNumber IS NULL) was wrong — PAN
// is never wizard-fed.
//
// Why this exists: the first version of the Keka bulk importer set
// enableOnboarding=false, so users created in that window never got
// flagged for the wizard. They appear in the dashboard fine but never
// see the form. This restamps onboardingPending=true so the next time
// they sign in, the wizard fires.
//
// Idempotent — re-running is safe; rows that have already completed
// the wizard (PAN populated) are skipped.
//
// Run:  npx tsx scripts/_flag-pending-onboarding.ts
//       npx tsx scripts/_flag-pending-onboarding.ts --dry                       # preview only
//       npx tsx scripts/_flag-pending-onboarding.ts --all                       # also flag rows that already have emergencyContact
//       npx tsx scripts/_flag-pending-onboarding.ts --emails=a@x.com,b@y.com    # only these users
//       npx tsx scripts/_flag-pending-onboarding.ts --exclude=a@x.com,b@y.com   # everyone EXCEPT these
//       npx tsx scripts/_flag-pending-onboarding.ts --unflag-all                # reverse: clear every onboardingPending flag
//
// Developers (anyone listed in process.env.DEVELOPER_EMAILS) are
// always skipped automatically — they don't need to walk through the
// employee wizard. Combine with --exclude to drop additional people
// (e.g. HR admin) for the same reason.

import { PrismaClient } from "@prisma/client";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const isDry      = process.argv.includes("--dry");
  const all        = process.argv.includes("--all");
  const unflagAll  = process.argv.includes("--unflag-all");
  const emails = process.argv.find((a) => a.startsWith("--emails="))?.slice(9).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) ?? null;

  // Always-excluded set: developer emails from .env + anything passed via --exclude.
  const cliExcludes = process.argv.find((a) => a.startsWith("--exclude="))?.slice(10)
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) ?? [];
  const devEmails = (process.env.DEVELOPER_EMAILS || "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const excludeSet = new Set<string>([...cliExcludes, ...devEmails]);

  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    // ── Unflag-all branch — clears every onboardingPending=true row ──
    if (unflagAll) {
      const pending = await prisma.$queryRawUnsafe<Array<{ id: number; email: string; name: string }>>(
        `SELECT id, email, name FROM "User" WHERE "onboardingPending" = true ORDER BY email`,
      );
      if (pending.length === 0) {
        console.log("No users currently flagged as onboarding-pending — nothing to clear.");
        return;
      }
      console.log(`${isDry ? "[dry] would clear" : "Clearing"} the onboarding flag for ${pending.length} users:`);
      for (const u of pending) console.log(`  ${u.email.padEnd(40)} ${u.name}`);
      if (isDry) return;
      await prisma.$executeRawUnsafe(
        `UPDATE "User" SET "onboardingPending" = false WHERE "onboardingPending" = true`,
      );
      console.log(`✓ Cleared ${pending.length} flags. Nobody will be bounced to /onboarding on next sign-in.`);
      return;
    }

    // Build the candidate set. Default is "PAN is NULL" — the wizard's
    // signature output. --all overrides to flag everyone active with
    // an EmployeeProfile.
    const filterParts: string[] = [
      `u."isActive" = true`,
      `ep."userId" IS NOT NULL`,                // has been HR-onboarded
    ];
    const args: any[] = [];
    if (!all) {
      filterParts.push(`(ep."emergencyContact" IS NULL OR ep."emergencyContact" = '')`);
    }
    if (emails && emails.length > 0) {
      filterParts.push(`u.email = ANY($1::text[])`);
      args.push(emails);
    }
    const where = filterParts.join(" AND ");

    const candidates = await prisma.$queryRawUnsafe<Array<{
      id: number; email: string; name: string; alreadyPending: boolean;
    }>>(
      `SELECT u.id, u.email, u.name, u."onboardingPending" AS "alreadyPending"
         FROM "User" u
         JOIN "EmployeeProfile" ep ON ep."userId" = u.id
        WHERE ${where}
        ORDER BY u.email`,
      ...args,
    );

    // Drop already-pending rows AND anyone in the exclude set
    // (developers + --exclude list). Excluded folks are reported
    // separately so HR can see what was held back.
    const toFlag    = candidates.filter((c) => !c.alreadyPending && !excludeSet.has(c.email.toLowerCase()));
    const heldBack  = candidates.filter((c) =>  excludeSet.has(c.email.toLowerCase()));

    if (heldBack.length > 0) {
      console.log(`Excluded ${heldBack.length} (developers + --exclude):`);
      for (const c of heldBack) console.log(`  - ${c.email}`);
      console.log("");
    }

    if (toFlag.length === 0) {
      console.log(`No rows need flagging — ${candidates.length} matched the filter, all already pending / done / excluded.`);
      return;
    }

    console.log(`${isDry ? "[dry] would flag" : "Flagging"} ${toFlag.length} of ${candidates.length} matched users:`);
    for (const c of toFlag) {
      console.log(`  ${c.email.padEnd(40)} ${c.name}`);
    }

    if (isDry) return;

    const ids = toFlag.map((c) => c.id);
    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET "onboardingPending" = true WHERE id = ANY($1::int[])`,
      ids,
    );
    console.log(`✓ Updated ${ids.length} rows. They'll see the first-login wizard on next sign-in.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
