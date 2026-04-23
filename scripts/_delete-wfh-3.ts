import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const before = await p.wFHRequest.findMany({
    select: { id: true, userId: true, date: true, status: true, reason: true },
  });
  console.log(`Before: ${before.length} WFH row(s).`);
  for (const r of before) console.log(`  id=${r.id} user=${r.userId} date=${r.date.toISOString().slice(0,10)} status=${r.status}`);

  const res = await p.wFHRequest.deleteMany({});
  console.log(`\n✂  Deleted ${res.count} WFH row(s).`);

  const after = await p.wFHRequest.count();
  console.log(`After:  ${after} WFH row(s).`);
}
main().catch(console.error).finally(() => p.$disconnect());
