import { PrismaClient } from "@prisma/client";

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error("DATABASE_URL is not set");
        process.exit(1);
    }

    const prisma = new PrismaClient({ datasources: { db: { url } } });

    try {
        const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string; row_count: bigint }>>(
            `
            SELECT
                c.relname::text AS table_name,
                c.reltuples::bigint AS row_count
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'r'
              AND n.nspname = 'public'
              AND (c.relname ILIKE '%youtube%' OR c.relname ILIKE 'yt%' OR c.relname ILIKE '%_yt_%')
            ORDER BY c.relname;
            `
        );

        console.log(`\nYT-related tables (${rows.length} found):`);
        if (rows.length === 0) {
            console.log("  (none)");
        } else {
            for (const r of rows) {
                const est = Number(r.row_count);
                console.log(`  - ${r.table_name}  (~${est.toLocaleString()} rows, estimate)`);
            }
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
