import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

(async () => {
  const before = await p.leavePolicy.findUnique({
    where: { id: 2 },
    select: { id: true, name: true, description: true, isActive: true },
  });
  console.log("Before:", before);
  if (!before) { console.log("Policy id=2 not found."); return p.$disconnect(); }
  if (before.name !== "Probationary Policy") {
    console.log(`Refusing to rename — policy #2 name is "${before.name}", expected "Probationary Policy".`);
    return p.$disconnect();
  }

  const updated = await p.leavePolicy.update({
    where: { id: 2 },
    data: { name: "Intern Leave Plan" },
    select: { id: true, name: true, description: true, isActive: true },
  });
  console.log("After: ", updated);
  await p.$disconnect();
})();
