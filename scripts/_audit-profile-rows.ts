/**
 * Diagnostic: which users on prod have an EmployeeProfile row and
 * which don't. Anyone WITHOUT a profile row hits a silent bug in
 * src/app/api/hr/people/[id]/route.ts where the PUT handler returns
 * { ok: true } without persisting anything (both the typed UPDATE
 * and the raw-SQL UPDATE are gated on `if (existing)`).
 *
 *   npx tsx scripts/_audit-profile-rows.ts
 *   npx tsx scripts/_audit-profile-rows.ts <email>   # zoom in on one user
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const target = process.argv[2];

  if (target) {
    const u = await prisma.user.findUnique({
      where: { email: target },
      select: { id: true, name: true, email: true, isActive: true, employeeProfile: { select: { id: true, employeeId: true } } },
    });
    if (!u) { console.log(`No user found with email ${target}`); return; }
    console.log(`User: ${u.name} <${u.email}>  id=${u.id}  active=${u.isActive}`);
    if (u.employeeProfile) {
      console.log(`✓ Has EmployeeProfile (id=${u.employeeProfile.id}, employeeId=${u.employeeProfile.employeeId}). Saves will persist.`);
    } else {
      console.log(`✗ NO EmployeeProfile row. EditProfilePanel saves silently fail for this user.`);
    }
    return;
  }

  const totalUsers   = await prisma.user.count({ where: { isActive: true } });
  const withProfile  = await prisma.user.count({
    where: { isActive: true, employeeProfile: { isNot: null } },
  });
  const without      = totalUsers - withProfile;

  console.log(`Active users on prod          : ${totalUsers}`);
  console.log(`  with    EmployeeProfile     : ${withProfile}`);
  console.log(`  WITHOUT EmployeeProfile     : ${without}   ← saves silently fail for these`);

  if (without > 0) {
    const list = await prisma.user.findMany({
      where: { isActive: true, employeeProfile: { is: null } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
      take: 50,
    });
    console.log(``);
    console.log(`Users without a profile row (first 50):`);
    for (const u of list) {
      console.log(`  id=${String(u.id).padEnd(5)} ${u.name?.padEnd(30) ?? ""} <${u.email}>`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
