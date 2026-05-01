// Adds Violation.lastReminderAt — used by the in-progress reminder
// cron to throttle "still in progress" emails to ~15 days apart.
//
// Run:  npx tsx scripts/_init-violation-reminder.ts
// Idempotent — safe to re-run on dev or VPS.

import { PrismaClient } from "@prisma/client";

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
    const prisma = new PrismaClient({ datasources: { db: { url } } });

    try {
        await prisma.$executeRawUnsafe(`
            ALTER TABLE "Violation"
            ADD COLUMN IF NOT EXISTS "lastReminderAt" TIMESTAMPTZ;
        `);
        console.log("✓ Violation.lastReminderAt column ready.");
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
