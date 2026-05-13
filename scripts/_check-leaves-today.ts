import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  // Mirror istTodayDateOnly() — date-only in IST.
  const now = new Date();
  const istParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const y = istParts.find((x) => x.type === "year")!.value;
  const m = istParts.find((x) => x.type === "month")!.value;
  const d = istParts.find((x) => x.type === "day")!.value;
  const todayIso = `${y}-${m}-${d}`;
  const today = new Date(`${todayIso}T00:00:00.000Z`);
  console.log(`IST today (date-only): ${todayIso}\n`);

  const allRecent = await p.leaveApplication.findMany({
    where: { fromDate: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) } },
    select: {
      id: true, userId: true, fromDate: true, toDate: true, status: true,
      user: { select: { name: true } },
    },
    orderBy: { fromDate: "desc" },
    take: 30,
  });
  console.log(`Leave applications in last 30 days: ${allRecent.length}`);
  for (const r of allRecent) {
    const cov = r.fromDate <= today && r.toDate >= today;
    console.log(`  [${cov ? "★" : " "}] id=${r.id} ${r.user?.name?.padEnd(22)} ${r.fromDate.toISOString().slice(0,10)} → ${r.toDate.toISOString().slice(0,10)}  status=${r.status}`);
  }

  console.log(`\n— Applying API filter (fromDate <= today AND toDate >= today AND status NOT IN [rejected, cancelled]) —`);
  const covering = await p.leaveApplication.findMany({
    where: {
      fromDate: { lte: today },
      toDate:   { gte: today },
      status:   { notIn: ["rejected", "cancelled"] },
    },
    select: {
      id: true, userId: true, fromDate: true, toDate: true, status: true,
      user: { select: { name: true } },
    },
  });
  console.log(`Matched ${covering.length}:`);
  for (const r of covering) {
    console.log(`  id=${r.id} ${r.user?.name}  ${r.fromDate.toISOString().slice(0,10)} → ${r.toDate.toISOString().slice(0,10)}  status=${r.status}`);
  }

  console.log(`\n— Distinct status values in LeaveApplication —`);
  const distinct = await p.$queryRaw<{ status: string; n: bigint }[]>`
    SELECT status, COUNT(*)::int AS n FROM "LeaveApplication" GROUP BY status ORDER BY n DESC
  `;
  for (const r of distinct) console.log(`  ${r.status.padEnd(22)} ${r.n}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
