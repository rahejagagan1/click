import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const u = await p.user.findFirst({
    where: { email: "ai.nbmediaa@gmail.com" },
    select: { id: true, name: true, email: true, role: true, orgLevel: true, isActive: true },
  });
  if (!u) { console.log("✗ Not found"); return; }
  const devEmails = (process.env.DEVELOPER_EMAILS || "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const isDeveloper = devEmails.includes(u.email.toLowerCase());
  console.log(`User: ${u.name} <${u.email}>  id=${u.id}`);
  console.log(`  role=${u.role}   orgLevel=${u.orgLevel}   isDeveloper=${isDeveloper}`);
  console.log();
  console.log(`Current snapshot-button gate (isDeveloper OR orgLevel="special_access"):`);
  console.log(`  → ${isDeveloper || u.orgLevel === "special_access" ? "✓ button shows" : "✗ button HIDDEN"}`);
}
main().catch(console.error).finally(() => p.$disconnect());
