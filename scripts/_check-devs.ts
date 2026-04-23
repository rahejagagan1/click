import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const devEmails = ["rahejagagan1@gmail.com", "arpitsharma4602@gmail.com"];
  for (const email of devEmails) {
    const u = await p.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, orgLevel: true, role: true, isActive: true },
    });
    console.log(u ? `  ${u.name} <${u.email}>  orgLevel=${u.orgLevel}  role=${u.role}  active=${u.isActive}` : `  ${email}: (not in DB)`);
  }
}
main().catch(console.error).finally(() => p.$disconnect());
