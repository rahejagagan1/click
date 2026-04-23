import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  // Arpit: ceo → special_access (still full visibility, but not CEO-titled)
  const arpit = await p.user.update({
    where: { email: "arpitsharma4602@gmail.com" },
    data:  { orgLevel: "special_access" },
    select: { id: true, name: true, email: true, orgLevel: true },
  });
  console.log(`✓ ${arpit.name} → orgLevel=${arpit.orgLevel}`);

  // Sanity check — Nikit should remain the sole CEO.
  const ceos = await p.user.findMany({
    where: { orgLevel: "ceo" },
    select: { id: true, name: true, email: true },
    orderBy: { id: "asc" },
  });
  console.log("\nCEOs now:");
  ceos.forEach(u => console.log(`  id=${u.id}  ${u.name} <${u.email}>`));
}
main().catch(console.error).finally(() => p.$disconnect());
