import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  for (const table of ["MonthlyReport", "WeeklyReport"]) {
    const rows = await p.$queryRawUnsafe<Array<{ data_type: string }>>(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = $1 AND column_name = 'teamSnapshot'`,
      table,
    );
    if (rows.length === 0) console.log(`✗ ${table}.teamSnapshot does NOT exist`);
    else                   console.log(`✓ ${table}.teamSnapshot exists  (type=${rows[0].data_type})`);
  }
}
main().catch(console.error).finally(() => p.$disconnect());
