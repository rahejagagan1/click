// Adds the User.inlineManagerId column — a secondary "inline" /
// dotted-line manager separate from the formal reporting line in
// `managerId`. Idempotent — safe to re-run on dev + VPS.
//
// Run:  npx tsx scripts/_init-inline-manager.ts

import { PrismaClient } from "@prisma/client";

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
    const prisma = new PrismaClient({ datasources: { db: { url } } });

    try {
        await prisma.$executeRawUnsafe(`
            ALTER TABLE "User"
            ADD COLUMN IF NOT EXISTS "inlineManagerId" INTEGER;
        `);
        await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "User_inlineManagerId_idx"
            ON "User" ("inlineManagerId");
        `);
        // FK constraint — wrapped because Postgres rejects duplicate
        // constraint names and there is no IF NOT EXISTS for ADD
        // CONSTRAINT.
        await prisma.$executeRawUnsafe(`
            DO $$ BEGIN
                ALTER TABLE "User"
                ADD CONSTRAINT "User_inlineManagerId_fkey"
                FOREIGN KEY ("inlineManagerId") REFERENCES "User"("id")
                ON DELETE SET NULL ON UPDATE CASCADE;
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
        `);
        console.log("✓ User.inlineManagerId column + index + FK ready.");
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
