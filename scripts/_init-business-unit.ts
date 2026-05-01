// Adds the EmployeeProfile.businessUnit column. The onboarding form
// always collected this value; it was just being thrown away because
// the schema had no place to store it. Idempotent — safe to re-run on
// dev and VPS.
//
// Run:  npx tsx scripts/_init-business-unit.ts

import { PrismaClient } from "@prisma/client";

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
    const prisma = new PrismaClient({ datasources: { db: { url } } });

    try {
        await prisma.$executeRawUnsafe(`
            ALTER TABLE "EmployeeProfile"
            ADD COLUMN IF NOT EXISTS "businessUnit" TEXT;
        `);
        console.log("✓ EmployeeProfile.businessUnit column ready.");
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
