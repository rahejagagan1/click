export {};
import prisma from "../src/lib/prisma";
import { getManagerReportFormat } from "../src/lib/reports/manager-report-format";

(async () => {
  const all = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true, role: true, orgLevel: true },
  });
  const qa = all.filter((u) => getManagerReportFormat(u) === "qa");
  console.log("QA Manager(s) in the system today:");
  for (const u of qa) {
    console.log(`  id=${u.id}  ${u.name}  email=${u.email}  role=${u.role}  orgLevel=${u.orgLevel}`);
  }
  if (qa.length === 0) console.log("  (none matched role+orgLevel; legacy 'andrew' name match also empty)");
  await prisma.$disconnect();
})();
