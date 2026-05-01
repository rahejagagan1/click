// Migration: introduce AttendanceSession to support multi-session days.
//
// Schema:
//   AttendanceSession (id PK, attendanceId FK→Attendance, clockIn, clockOut, createdAt)
//
// Backfill: for every existing Attendance row that has a clockIn, create
// one matching session — so accumulated totals stay correct on day one.
//
// Run:  npx tsx scripts/_init-attendance-sessions.ts
// Idempotent: safe to re-run.

import { PrismaClient } from "@prisma/client";

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
    const prisma = new PrismaClient({ datasources: { db: { url } } });

    try {
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "AttendanceSession" (
                "id"           SERIAL PRIMARY KEY,
                "attendanceId" INT NOT NULL REFERENCES "Attendance"("id") ON DELETE CASCADE,
                "clockIn"      TIMESTAMPTZ NOT NULL,
                "clockOut"     TIMESTAMPTZ,
                "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "AttendanceSession_attendanceId_idx"
              ON "AttendanceSession" ("attendanceId");
        `);
        // Backfill — create one session per existing Attendance row that
        // has a clockIn but no matching session row yet. We use NOT EXISTS
        // so re-running the migration won't double-insert.
        const inserted = await prisma.$executeRawUnsafe(`
            INSERT INTO "AttendanceSession" ("attendanceId","clockIn","clockOut","createdAt")
            SELECT a.id, a."clockIn", a."clockOut", COALESCE(a."createdAt", NOW())
              FROM "Attendance" a
             WHERE a."clockIn" IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM "AttendanceSession" s WHERE s."attendanceId" = a.id
               );
        `);
        console.log(`✓ AttendanceSession ready. Backfilled ${inserted} session(s).`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
