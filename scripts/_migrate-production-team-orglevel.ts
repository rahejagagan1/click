// One-shot: migrates any User rows with orgLevel = "production_team"
// to "member". The orgLevel was a legacy free-text value not in the
// Prisma OrgLevel enum, with the same effective access scope as
// "member" (sees only self), so the migration is lossless.
//
// Run:  npx tsx scripts/_migrate-production-team-orglevel.ts
// Add `--dry` to preview without writing.

import { PrismaClient } from "@prisma/client";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const isDry = process.argv.includes("--dry");
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    // Use raw SQL — production_team isn't in the typed Prisma enum,
    // so the typed client wouldn't even let us query for it.
    const rows = await prisma.$queryRawUnsafe<Array<{ id: number; name: string; email: string }>>(
      `SELECT id, name, email FROM "User" WHERE "orgLevel"::text = 'production_team'`,
    );

    console.log(`Found ${rows.length} user(s) on orgLevel='production_team':`);
    for (const r of rows) console.log(`  · id=${r.id}  ${r.name}  <${r.email}>`);

    if (rows.length === 0) {
      console.log("\nNothing to migrate — DB is already clean.");
      return;
    }

    if (isDry) {
      console.log("\n[dry] Would set orgLevel = 'member' for the rows above.");
      return;
    }

    const updated = await prisma.$executeRawUnsafe(
      `UPDATE "User" SET "orgLevel" = 'member' WHERE "orgLevel"::text = 'production_team'`,
    );
    console.log(`\n✓ Updated ${updated} row(s) to orgLevel='member'.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
