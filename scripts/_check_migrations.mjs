import { PrismaClient } from "@prisma/client";
const PROD = "postgresql://gagan:gagan180204@69.62.79.231:5432/nb_dashboard";
const c = new PrismaClient({ datasources: { db: { url: PROD } } });
const rows = await c.$queryRawUnsafe(
  `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 20`
);
for (const r of rows) {
  const status = r.rolled_back_at ? "ROLLED" : r.finished_at ? "OK" : "PENDING";
  console.log(`${status.padEnd(8)} ${r.migration_name}`);
}
await c.$disconnect();
