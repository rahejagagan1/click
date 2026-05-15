import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const users = await p.user.findMany({
    where: { name: { contains: "arpit", mode: "insensitive" } },
    select: { id: true, name: true, email: true, isActive: true },
    orderBy: { id: "asc" },
  });
  const exits = await p.$queryRawUnsafe<any[]>(
    `SELECT e.id, e."userId", e.status, e."exitType", u.name, u.email, u."isActive"
       FROM "EmployeeExit" e JOIN "User" u ON u.id = e."userId" ORDER BY e.id`
  );
  console.log("USERS:", JSON.stringify(users, null, 2));
  console.log("EXITS:", JSON.stringify(exits, null, 2));
  await p.$disconnect();
})();
