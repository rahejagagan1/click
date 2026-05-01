// Generic dropdown-options table — one shared bucket keyed by
// (listKey, value) so any dropdown in the app can opt into "+ Add
// custom" / "delete" behaviour without its own schema.
//
// Run:  npx tsx scripts/_init-option-list.ts
// Idempotent — safe to re-run on dev or VPS.

import { PrismaClient } from "@prisma/client";

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
    const prisma = new PrismaClient({ datasources: { db: { url } } });

    try {
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "OptionList" (
                "id"        SERIAL PRIMARY KEY,
                "listKey"   TEXT NOT NULL,
                "value"     TEXT NOT NULL,
                "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                "createdBy" INT REFERENCES "User"("id") ON DELETE SET NULL
            );
        `);
        await prisma.$executeRawUnsafe(`
            CREATE UNIQUE INDEX IF NOT EXISTS "OptionList_listKey_value_key"
              ON "OptionList" ("listKey", "value");
        `);
        await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "OptionList_listKey_idx"
              ON "OptionList" ("listKey");
        `);
        console.log("✓ OptionList table ready.");
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
