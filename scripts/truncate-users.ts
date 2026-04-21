// Wipes every row from the User table (and every cascading relation).
// DEV USE ONLY — refuses to run if DATABASE_URL points anywhere that isn't
// obviously a dev DB.
//
// Usage:
//   npx tsx scripts/truncate-users.ts          # dry-run: prints what would happen
//   npx tsx scripts/truncate-users.ts --apply  # actually truncates
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const url = process.env.DATABASE_URL || "";
  if (!/dev|shadow|local/i.test(url)) {
    console.error("Refusing to run: DATABASE_URL doesn't look like a dev DB.");
    console.error(`  DATABASE_URL = ${url.replace(/:[^:@]+@/, ":***@")}`);
    process.exit(1);
  }

  const before = await prisma.user.count();
  console.log(`DATABASE_URL: ${url.replace(/:[^:@]+@/, ":***@")}`);
  console.log(`User rows currently: ${before}`);

  const apply = process.argv.includes("--apply");
  if (!apply) {
    console.log("\nDRY RUN — re-run with --apply to TRUNCATE User (CASCADE).");
    return;
  }

  console.log("\nRunning: TRUNCATE TABLE \"User\" RESTART IDENTITY CASCADE;");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" RESTART IDENTITY CASCADE;`);

  const after = await prisma.user.count();
  console.log(`✓ Done. User rows now: ${after}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
