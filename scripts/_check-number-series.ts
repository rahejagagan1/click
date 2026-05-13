import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const all = await p.employeeNumberSeries.findMany({ orderBy: { id: "asc" } });
  console.log(`EmployeeNumberSeries rows: ${all.length}`);
  for (const s of all) {
    console.log(`  id=${s.id}  name="${s.name}"  prefix="${s.prefix}"  nextNumber=${s.nextNumber}  active=${s.isActive}`);
  }
  const active = all.find((s) => s.isActive);
  if (!active) console.log(`\n⚠ NO ACTIVE SERIES — auto-create will fail.`);
  else         console.log(`\n✓ Will auto-allocate next id as "${active.prefix}${active.nextNumber}" (then bumps to ${active.nextNumber + 1}).`);
}

main().catch(console.error).finally(() => p.$disconnect());
