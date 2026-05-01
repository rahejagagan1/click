// Schema migration for the KPI documents feature.
// One document per department — every employee whose
// EmployeeProfile.department matches sees it on /dashboard/kpis.
//
// Run:  npx tsx scripts/_init-kpi-documents.ts
//
// Idempotent: safe to run multiple times.

import { PrismaClient } from "@prisma/client";

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
    const prisma = new PrismaClient({ datasources: { db: { url } } });

    try {
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "KpiDocument" (
                "id"          SERIAL PRIMARY KEY,
                "department"  TEXT NOT NULL,
                "fileName"    TEXT NOT NULL,
                "fileUrl"     TEXT NOT NULL,
                "uploadedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                "uploadedBy"  INT REFERENCES "User"("id") ON DELETE SET NULL
            );
        `);
        // Earlier iteration used (department, designation) — drop the
        // column + its old composite index if they're still present so
        // the table cleanly enforces "one doc per department".
        await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "KpiDocument_dept_role_key";`);
        await prisma.$executeRawUnsafe(`ALTER TABLE "KpiDocument" DROP COLUMN IF EXISTS "designation";`);
        await prisma.$executeRawUnsafe(`
            CREATE UNIQUE INDEX IF NOT EXISTS "KpiDocument_department_key"
              ON "KpiDocument" ("department");
        `);
        console.log("✓ KpiDocument table ready (one row per department).");
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
