// One-time / discretionary bonus log per employee. Separate from
// SalaryStructure.bonusIncluded which is just a flag on the structure
// — this table records actual payout events HR can add ad-hoc.
//
// Run:  npx tsx scripts/_init-employee-bonus.ts
// Idempotent — safe to re-run on dev or VPS.

import { PrismaClient } from "@prisma/client";

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
    const prisma = new PrismaClient({ datasources: { db: { url } } });

    try {
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "EmployeeBonus" (
                "id"            SERIAL PRIMARY KEY,
                "userId"        INT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
                "amount"        DECIMAL(12,2) NOT NULL,
                "reason"        TEXT,
                "effectiveDate" DATE NOT NULL,
                "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                "createdBy"     INT REFERENCES "User"("id") ON DELETE SET NULL
            );
        `);
        // Newer columns added in a follow-up — IF NOT EXISTS makes the
        // migration idempotent across re-runs.
        await prisma.$executeRawUnsafe(`
            ALTER TABLE "EmployeeBonus"
              ADD COLUMN IF NOT EXISTS "bonusType"     TEXT,
              ADD COLUMN IF NOT EXISTS "paymentStatus" TEXT NOT NULL DEFAULT 'due_future';
        `);
        await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "EmployeeBonus_userId_idx"
              ON "EmployeeBonus" ("userId");
        `);
        console.log("✓ EmployeeBonus table ready (with bonusType + paymentStatus).");
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
