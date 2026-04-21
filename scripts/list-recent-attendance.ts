import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const days = parseInt(process.argv[2] || "7", 10);
  const since = new Date(); since.setDate(since.getDate() - days); since.setHours(0, 0, 0, 0);
  const recs = await prisma.attendance.findMany({
    where: { date: { gte: since } },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: [{ date: "desc" }, { userId: "asc" }],
  });
  console.log(`Last ${days} day(s) — ${recs.length} row(s):`);
  for (const r of recs) {
    console.log(` - ${r.date.toISOString().slice(0,10)} id=${r.id} user=${r.user?.name} <${r.user?.email}> in=${r.clockIn?.toISOString() ?? "-"} out=${r.clockOut?.toISOString() ?? "-"} status=${r.status}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
