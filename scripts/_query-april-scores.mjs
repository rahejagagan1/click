import { PrismaClient } from "@prisma/client";

const PROD_URL =
  "postgresql://gagan:gagan180204@69.62.79.231:5432/nb_dashboard?connection_limit=5&pool_timeout=20";

const prisma = new PrismaClient({
  datasources: { db: { url: PROD_URL } },
});

const start = new Date("2026-04-01T00:00:00Z");
const end = new Date("2026-05-01T00:00:00Z");

const rows = await prisma.monthlyRating.findMany({
  where: { month: { gte: start, lt: end } },
  include: { user: { select: { name: true, email: true, role: true } } },
  orderBy: [
    { roleType: "asc" },
    { rankInRole: "asc" },
    { overallRating: "desc" },
  ],
});

console.log(`Found ${rows.length} MonthlyRating rows for April 2026 in PROD\n`);
for (const r of rows) {
  console.log(
    [
      r.roleType.padEnd(10),
      `#${String(r.rankInRole ?? "-").padStart(2)}`,
      (r.user?.name ?? "?").padEnd(28),
      `cases=${String(r.casesCompleted).padStart(3)}`,
      `overall=${r.overallRating ?? "-"}`,
      `q=${r.avgQualityScore ?? "-"}`,
      `d=${r.avgDeliveryScore ?? "-"}`,
      `e=${r.avgEfficiencyScore ?? "-"}`,
      r.isManualOverride ? "[manual]" : "",
    ].join("  ")
  );
}

await prisma.$disconnect();
