import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

function todayIstDateOnly(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === "year")!.value;
  const m = parts.find(p => p.type === "month")!.value;
  const d = parts.find(p => p.type === "day")!.value;
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
}

async function main() {
  const today = todayIstDateOnly();
  const recs = await prisma.attendance.findMany({
    where: { date: today },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  console.log(`Today (${today.toISOString().slice(0, 10)} IST) — ${recs.length} attendance row(s):`);
  for (const r of recs) {
    console.log(` - id=${r.id} user=${r.user?.name} <${r.user?.email}> clockIn=${r.clockIn?.toISOString() ?? "-"} clockOut=${r.clockOut?.toISOString() ?? "-"} status=${r.status} loc=${r.location}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
