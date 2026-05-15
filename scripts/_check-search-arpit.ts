import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  // Replicate the exact filter the /api/search endpoint uses
  const employees = await p.user.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: "arpit", mode: "insensitive" } },
        { email: { contains: "arpit", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true, isActive: true },
    orderBy: { name: "asc" },
  });
  console.log("Search endpoint would return:", JSON.stringify(employees, null, 2));
  await p.$disconnect();
})();
