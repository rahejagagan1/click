import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const q = process.argv[2] ?? "arpit";
  const users = await prisma.user.findMany({
    where: { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] },
    select: { id: true, name: true, email: true, isActive: true, role: true, orgLevel: true },
    orderBy: { id: "asc" },
  });
  console.log(`Matches for '${q}':`);
  users.forEach(u => console.log(`  id=${u.id}  ${u.name}  <${u.email}>  active=${u.isActive}  ${u.role}/${u.orgLevel}`));
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
