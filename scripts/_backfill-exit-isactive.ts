// One-time backfill: bring User.isActive in line with EmployeeExit.status
// for every existing exit row. After this runs, the invariant
//   isActive = (status !== "offboarded")
// holds for every exit, matching the new PATCH-driven sync.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const exits = await p.$queryRawUnsafe<Array<{ userId: number; status: string }>>(
    `SELECT "userId", status FROM "EmployeeExit"`
  );
  let fixed = 0;
  for (const e of exits) {
    const expected = e.status !== "offboarded";
    const before = await p.user.findUnique({ where: { id: e.userId }, select: { isActive: true, email: true } });
    if (!before) continue;
    if (before.isActive !== expected) {
      await p.user.update({ where: { id: e.userId }, data: { isActive: expected } });
      console.log(`  fixed userId=${e.userId} (${before.email}): ${before.isActive} → ${expected}  (status=${e.status})`);
      fixed++;
    }
  }
  console.log(`Done. ${fixed} user(s) reconciled.`);
  await p.$disconnect();
})();
