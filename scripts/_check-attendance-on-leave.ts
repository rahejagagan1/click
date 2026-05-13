import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const istParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const y = istParts.find((x) => x.type === "year")!.value;
  const m = istParts.find((x) => x.type === "month")!.value;
  const d = istParts.find((x) => x.type === "day")!.value;
  const today = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
  console.log(`IST today: ${y}-${m}-${d}\n`);

  const todayRows = await p.attendance.findMany({
    where: { date: today },
    select: { userId: true, status: true, user: { select: { name: true } } },
  });
  console.log(`Total Attendance rows today: ${todayRows.length}`);
  const byStatus = new Map<string, number>();
  for (const r of todayRows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  for (const [s, n] of byStatus) console.log(`  ${s.padEnd(15)} ${n}`);

  const onLeaveAtt = todayRows.filter((r) => r.status === "on_leave");
  console.log(`\nAttendance rows with status="on_leave" today: ${onLeaveAtt.length}`);
  for (const r of onLeaveAtt) console.log(`  ${r.user?.name}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
