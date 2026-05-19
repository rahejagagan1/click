import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

(async () => {
  const policies = await p.$queryRawUnsafe<any[]>(
    `SELECT lp.id, lp.name, lp.description, lp."isActive",
            (SELECT COUNT(*) FROM "User" u WHERE u."leavePolicyId" = lp.id AND u."isActive" = true) AS "userCount"
       FROM "LeavePolicy" lp
       ORDER BY lp.id`
  );
  console.log(`${policies.length} leave policies:\n`);
  for (const pol of policies) {
    console.log(`#${pol.id} ${pol.name}  (active=${pol.isActive}, users=${pol.userCount})`);
    if (pol.description) console.log(`    desc: ${pol.description}`);
    const entries = await p.$queryRawUnsafe<any[]>(
      `SELECT lpe."daysPerYear", lpe."monthlyAccrual",
              lt.name AS "leaveTypeName", lt.code AS "leaveTypeCode"
         FROM "LeavePolicyEntry" lpe
         JOIN "LeaveType" lt ON lt.id = lpe."leaveTypeId"
        WHERE lpe."policyId" = $1
        ORDER BY lt.name`,
      pol.id,
    );
    if (entries.length === 0) {
      console.log("    (no entries)");
    } else {
      for (const e of entries) {
        const dpy = Number(e.daysPerYear);
        const ma  = Number(e.monthlyAccrual);
        const parts = [];
        if (dpy > 0) parts.push(`${dpy}/yr`);
        if (ma  > 0) parts.push(`${ma}/mo`);
        if (parts.length === 0) parts.push("0");
        console.log(`    - ${e.leaveTypeName.padEnd(20)} (${e.leaveTypeCode}): ${parts.join(" + ")}`);
      }
    }
    console.log("");
  }
  await p.$disconnect();
})();
