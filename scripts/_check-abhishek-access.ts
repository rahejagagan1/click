/**
 * Check whether each Abhishek in the DB has access to reports.
 * Mirrors:
 *   - sidebar `canSeeReports` (src/lib/access.ts)
 *   - API `isFullAccess` (src/app/api/reports/[managerId]/route.ts)
 *
 * Run with: npx tsx scripts/_check-abhishek-access.ts
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const DEV_EMAILS = (process.env.DEVELOPER_EMAILS || "")
  .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

function canSeeReports(u: { orgLevel: string | null; role: string | null; isDev: boolean }): { allow: boolean; reason: string } {
  if (u.orgLevel === "ceo")            return { allow: true, reason: "orgLevel=ceo" };
  if (u.isDev)                          return { allow: true, reason: "isDeveloper=true" };
  if (u.orgLevel === "special_access") return { allow: true, reason: "orgLevel=special_access" };
  if (u.role === "admin")              return { allow: true, reason: "role=admin" };
  if (u.orgLevel === "manager")        return { allow: true, reason: "orgLevel=manager" };
  if (u.orgLevel === "hod")            return { allow: true, reason: "orgLevel=hod" };
  if (u.orgLevel === "hr_manager")     return { allow: true, reason: "orgLevel=hr_manager (HEAD branch rule)" };
  if (u.role === "hr_manager")         return { allow: true, reason: "role=hr_manager (origin/main rule)" };
  return { allow: false, reason: "none of the above" };
}

function isFullAccessAPI(u: { orgLevel: string | null; isDev: boolean }): boolean {
  return u.orgLevel === "ceo" || u.orgLevel === "special_access" || u.isDev;
}

async function main() {
  const users = await p.user.findMany({
    where: {
      OR: [
        { name:  { contains: "abhishek", mode: "insensitive" } },
        { email: { contains: "abhishek", mode: "insensitive" } },
      ],
    },
    select: {
      id: true, name: true, email: true,
      role: true, orgLevel: true, managerId: true, isActive: true,
    },
    orderBy: { id: "asc" },
  });

  if (!users.length) {
    console.log("✗ No user matching 'abhishek' found in DB.");
    return;
  }

  console.log(`Found ${users.length} Abhishek user(s):\n`);
  for (const u of users) {
    const isDev = !!u.email && DEV_EMAILS.includes(u.email.toLowerCase());
    const see = canSeeReports({ orgLevel: u.orgLevel, role: u.role, isDev });
    const fullAPI = isFullAccessAPI({ orgLevel: u.orgLevel, isDev });

    // UserReportAccess grants (raw — table may not be in prisma client yet)
    let grants: any[] = [];
    try {
      grants = await p.$queryRaw`
        SELECT ura."managerId", u.name AS "managerName", u."orgLevel"
        FROM "UserReportAccess" ura
        LEFT JOIN "User" u ON u.id = ura."managerId"
        WHERE ura."userId" = ${u.id}
      ` as any[];
    } catch (e: any) {
      grants = [{ error: e?.message || String(e) }];
    }

    // Is THIS user themselves a manager (i.e. would `/reports/<their id>` work via self-rule)?
    const reportsTo = await p.user.count({ where: { managerId: u.id, isActive: true } });

    console.log(`— ${u.name} <${u.email}>  id=${u.id}  active=${u.isActive}`);
    console.log(`    role=${u.role}   orgLevel=${u.orgLevel}   managerId=${u.managerId}   isDeveloper=${isDev}`);
    console.log(`    Sidebar (canSeeReports): ${see.allow ? "YES" : "NO"}  (${see.reason})`);
    console.log(`    API full access (any manager's report): ${fullAPI ? "YES" : "NO"}`);
    console.log(`    Owns reports (direct reports count): ${reportsTo}`);
    console.log(`    UserReportAccess grants: ${grants.length === 0 ? "none" : ""}`);
    grants.forEach((g) => console.log(`      • managerId=${g.managerId}  ${g.managerName ?? "(unknown)"} [${g.orgLevel ?? "?"}]`));
    console.log();
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
