import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const t = process.argv[2];
  if (!t) { console.error("Usage: npx tsx scripts/_describe-table.ts <TableName>"); process.exit(1); }
  const cols = await prisma.$queryRawUnsafe<any[]>(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
    t,
  );
  console.log(`Columns in "${t}":`);
  cols.forEach(c => console.log(`  ${c.column_name.padEnd(24)} ${c.data_type.padEnd(28)} nullable=${c.is_nullable} default=${c.column_default ?? "—"}`));
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
