/**
 * One-shot audit: list every user with their role, orgLevel, manager,
 * and effective access (admin? HR admin? developer? report viewer?)
 * — the same checks the sidebar and middleware use. Run with:
 *     npx tsx scripts/_audit-access.ts
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const devEmails = (process.env.DEVELOPER_EMAILS || "")
  .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

async function main() {
  const users = await p.user.findMany({
    where: { isActive: true },
    select: {
      id: true, name: true, email: true,
      role: true, orgLevel: true,
      managerId: true,
      manager: { select: { name: true } },
    },
    orderBy: [{ orgLevel: "asc" }, { name: "asc" }],
  });

  // Group by orgLevel for a readable summary.
  const byLevel = new Map<string, typeof users>();
  for (const u of users) {
    const k = u.orgLevel as string;
    if (!byLevel.has(k)) byLevel.set(k, [] as any);
    byLevel.get(k)!.push(u);
  }

  console.log(`\nActive users: ${users.length}\n`);

  const order = ["ceo", "special_access", "hod", "hr_manager", "manager", "lead", "sub_lead", "production_team", "member"];

  for (const level of order) {
    const group = byLevel.get(level);
    if (!group?.length) continue;
    console.log(`\n─── ${level.toUpperCase()} (${group.length}) ───`);
    for (const u of group) {
      const isDev = devEmails.includes(u.email.toLowerCase());
      // Mirrors sidebar/middleware checks.
      const isAdmin    = u.orgLevel === "ceo" || isDev;
      const isHRAdmin  = isAdmin || u.orgLevel === "hr_manager";
      const isCeo      = u.orgLevel === "ceo" || isDev;
      const seeReports = isAdmin || u.orgLevel === "manager" || u.orgLevel === "hod";
      const protectedR = isDev || u.orgLevel === "ceo" || u.orgLevel === "special_access";

      const badges = [
        isCeo          ? "CEO"          : "",
        isDev          ? "DEV"          : "",
        isAdmin        ? "ADMIN"        : "",
        isHRAdmin      ? "HR-ADMIN"     : "",
        seeReports     ? "REPORTS"      : "",
        protectedR     ? "PROTECTED"    : "",
        u.role === "admin" ? "ROLE=admin" : "",
      ].filter(Boolean).join(" · ");

      const mgr = u.manager?.name ? `(mgr: ${u.manager.name})` : "(no mgr)";
      console.log(`  ${u.name.padEnd(28)}  ${u.email.padEnd(36)}  role=${u.role.padEnd(18)}  ${mgr}`);
      if (badges) console.log(`      → ${badges}`);
    }
  }

  console.log("\n─── Access summary (what each org level SEES) ───");
  console.log("                    Home  Me   YT   Fb   Team  HRAdmin  People  Cases  Dash  Admin  Scores  Reports");
  const rows = [
    ["ceo",           true,  true, true, true, true, true,  true,  true, true, true, true, true],
    ["special_access",true,  true, true, true, true, true,  true,  true, true, true, true, true],
    ["hod",           true,  true, true, true, true, false, false, false,false,false,true, true],
    ["hr_manager",    true,  true, true, true, true, true,  false, false,false,false,false,false],
    ["manager",       true,  true, true, true, false,false, false, false,false,false,true, true],
    ["lead",          true,  true, true, true, false,false, false, false,false,false,false,false],
    ["sub_lead",      true,  true, true, true, false,false, false, false,false,false,false,false],
    ["member",        true,  true, true, true, false,false, false, false,false,false,false,false],
  ];
  for (const r of rows) {
    const level = r[0] as string;
    const cells = r.slice(1).map((v) => (v ? "  ✓" : "  ·")).join(" ");
    console.log(`  ${level.padEnd(18)}${cells}`);
  }
  console.log("\n  Legend: ✓ = visible · · = hidden");
  console.log("  Dev emails always see everything (they're treated as special_access in session).");
}

main().catch(console.error).finally(() => p.$disconnect());
