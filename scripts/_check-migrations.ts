import { PrismaClient } from "@prisma/client";

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error("DATABASE_URL is not set");
        process.exit(1);
    }

    const prisma = new PrismaClient({ datasources: { db: { url } } });

    try {
        const rows = await prisma.$queryRawUnsafe<Array<{ migration_name: string; finished_at: Date | null }>>(
            `SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY migration_name;`
        );

        console.log(`\nApplied migrations (${rows.length}):`);
        for (const r of rows) {
            const status = r.finished_at ? "✓" : "…";
            console.log(`  ${status} ${r.migration_name}`);
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
