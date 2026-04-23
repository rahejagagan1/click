import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const ceos = await p.user.findMany({
    where: { orgLevel: "ceo" },
    select: { id: true, name: true, email: true, orgLevel: true },
    orderBy: { id: "asc" },
  });
  console.log("Current CEOs in DB:");
  if (ceos.length === 0) console.log("  (none)");
  ceos.forEach(u => console.log(`  id=${u.id}  ${u.name} <${u.email}>`));

  const arpit = await p.user.findFirst({
    where: { email: { contains: "arpitsharma4602", mode: "insensitive" } },
    select: { id: true, name: true, email: true, orgLevel: true, role: true },
  });
  console.log("\nArpit 4602 user record:");
  console.log(arpit ? `  id=${arpit.id}  ${arpit.name} <${arpit.email}>  orgLevel=${arpit.orgLevel}` : "  (not found)");

  const nikit = await p.user.findFirst({
    where: { name: { contains: "Nikit", mode: "insensitive" } },
    select: { id: true, name: true, email: true, orgLevel: true },
  });
  console.log("\nNikit Bassi user record:");
  console.log(nikit ? `  id=${nikit.id}  ${nikit.name} <${nikit.email}>  orgLevel=${nikit.orgLevel}` : "  (not found)");
}
main().catch(console.error).finally(() => p.$disconnect());
