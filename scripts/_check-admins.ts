import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const devEmails = (process.env.DEVELOPER_EMAILS || "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  console.log(`DEVELOPER_EMAILS env var contains: ${JSON.stringify(devEmails)}`);
  console.log();

  // Anyone the button SHOULD show for (matches the UI gate):
  //   isDeveloper (email in env) OR orgLevel=ceo OR orgLevel=special_access OR role=admin
  const ceoOrSA = await p.user.findMany({
    where: {
      isActive: true,
      OR: [
        { orgLevel: "ceo" },
        { orgLevel: "special_access" },
        { role: "admin" },
      ],
    },
    select: { id: true, name: true, email: true, role: true, orgLevel: true },
    orderBy: { name: "asc" },
  });
  console.log(`Users matching CEO / special_access / role=admin: ${ceoOrSA.length}`);
  for (const u of ceoOrSA) {
    const isDev = devEmails.includes(u.email.toLowerCase());
    console.log(`  id=${u.id}  ${u.name?.padEnd(24)} <${u.email}>  role=${u.role}  orgLevel=${u.orgLevel}  isDeveloper=${isDev}`);
  }

  console.log();
  console.log(`Users in DEVELOPER_EMAILS (regardless of role):`);
  for (const e of devEmails) {
    const u = await p.user.findFirst({
      where: { email: { equals: e, mode: "insensitive" } },
      select: { id: true, name: true, email: true, role: true, orgLevel: true, isActive: true },
    });
    if (u) console.log(`  ${u.name?.padEnd(24)} <${u.email}>  id=${u.id}  active=${u.isActive}  role=${u.role}  orgLevel=${u.orgLevel}`);
    else   console.log(`  ✗ no User row found for ${e}`);
  }
}

main().catch(console.error).finally(() => p.$disconnect());
