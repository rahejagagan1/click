import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const q = (process.argv[2] || "arpit").toLowerCase();
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: q, mode: "insensitive" } },
        { name:  { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true },
    take: 20,
  });
  console.log(`Query '${q}' → ${users.length} match(es):`);
  for (const u of users) console.log(` - id=${u.id}  ${u.name}  <${u.email}>`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
