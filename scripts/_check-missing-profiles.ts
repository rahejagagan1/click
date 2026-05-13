import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const total = await p.user.count({ where: { isActive: true } });
  const withProfile = await p.user.count({ where: { isActive: true, employeeProfile: { isNot: null } } });
  const without = total - withProfile;
  console.log(`Active users: ${total}`);
  console.log(`  with EmployeeProfile:    ${withProfile}`);
  console.log(`  WITHOUT EmployeeProfile: ${without}`);

  if (without > 0 && without <= 20) {
    const list = await p.user.findMany({
      where: { isActive: true, employeeProfile: null },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    });
    console.log(`\nFirst few users missing profiles:`);
    for (const u of list.slice(0, 15)) console.log(`  id=${u.id}  ${u.name?.padEnd(28)} ${u.email}`);
    if (list.length > 15) console.log(`  ... and ${list.length - 15} more`);
  } else if (without > 20) {
    console.log(`(${without} missing — too many to list)`);
  }
}

main().catch(console.error).finally(() => p.$disconnect());
