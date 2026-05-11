/**
 * Quick read-only check: does Vanshika have report rows in the DB,
 * and what role/orgLevel does she sit at?
 *
 * Run with: npx tsx scripts/_check-vanshika-reports.ts
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const u = await p.user.findFirst({
    where: { email: { contains: "vanshika", mode: "insensitive" } },
    select: { id: true, name: true, email: true, role: true, orgLevel: true, managerId: true },
  });
  if (!u) { console.log("✗ No Vanshika found"); return; }
  console.log(`User: ${u.name} <${u.email}> id=${u.id}`);
  console.log(`  role=${u.role}  orgLevel=${u.orgLevel}  managerId=${u.managerId}`);

  const [weekly, monthly] = await Promise.all([
    p.weeklyReport.count({ where: { managerId: u.id } }),
    p.monthlyReport.count({ where: { managerId: u.id } }),
  ]);
  console.log(`\nReports in DB referencing Vanshika as managerId:`);
  console.log(`  WeeklyReport rows : ${weekly}`);
  console.log(`  MonthlyReport rows: ${monthly}`);

  // Anyone reporting TO Vanshika? (i.e., does anyone have managerId = her.id)
  const reportsTo = await p.user.findMany({
    where: { managerId: u.id },
    select: { id: true, name: true, orgLevel: true },
  });
  console.log(`\nDirect reports to Vanshika: ${reportsTo.length}`);
  reportsTo.forEach((r) => console.log(`  - ${r.name} (orgLevel=${r.orgLevel})`));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
