import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

(async () => {
  const u = await p.user.findFirst({
    where: { name: { contains: "Abhishek Rajput", mode: "insensitive" } },
    select: { id: true, name: true, leavePolicyId: true },
  });
  console.log("User:", u);
  if (!u) return p.$disconnect();

  const cl = await p.leaveType.findFirst({
    where: { OR: [{ code: "CL" }, { name: { contains: "Casual", mode: "insensitive" } }] },
    select: { id: true, name: true, code: true, daysPerYear: true },
  });
  console.log("Casual Leave type:", cl);

  if (u.leavePolicyId && cl) {
    const e = await p.$queryRawUnsafe(
      `SELECT * FROM "LeavePolicyEntry" WHERE "policyId" = $1 AND "leaveTypeId" = $2`,
      u.leavePolicyId, cl.id,
    );
    console.log("Policy entry for CL:", e);
  }
  if (cl) {
    const bal = await p.$queryRawUnsafe(
      `SELECT * FROM "LeaveBalance" WHERE "userId" = $1 AND "leaveTypeId" = $2 AND year = 2026`,
      u!.id, cl.id,
    );
    console.log("Current 2026 LeaveBalance row:", bal);
  }
  await p.$disconnect();
})();
