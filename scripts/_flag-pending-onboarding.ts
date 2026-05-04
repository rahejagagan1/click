// One-shot: flips User.onboardingPending = true for anyone who is
// active, has an EmployeeProfile (i.e. they've been onboarded by HR),
// but hasn't gone through the first-login wizard yet — heuristic =
// their PAN field is still NULL (the wizard always writes PAN).
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
//       npx tsx scripts/_flag-pending-onboarding.ts --dry        # preview only
//       npx tsx scripts/_flag-pending-onboarding.ts --all        # also flag rows that already have PAN
//       npx tsx scripts/_flag-pending-onboarding.ts --emails=a@x.com,b@y.com   # only these users

import { PrismaClient } from "@prisma/client";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const isDry  = process.argv.includes("--dry");
  const all    = process.argv.includes("--all");
  const emails = process.argv.find((a) => a.startsWith("--emails="))?.slice(9).split(",").map((s) => s.trim()).filter(Boolean) ?? null;

  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    // Build the candidate set. Default is "PAN is NULL" — the wizard's
    // signature output. --all overrides to flag everyone active with
    // an EmployeeProfile.
    const filterParts: string[] = [
      `u."isActive" = true`,
      `ep."userId" IS NOT NULL`,                // has been HR-onboarded
    ];
    const args: any[] = [];
    if (!all) {
      filterParts.push(`(ep."panNumber" IS NULL OR ep."panNumber" = '')`);
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

    const toFlag = candidates.filter((c) => !c.alreadyPending);

    if (toFlag.length === 0) {
      console.log(`No rows need flagging — ${candidates.length} matched the filter, all already pending or already done.`);
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
