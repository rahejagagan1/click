/**
 * Reads DEVELOPER_EMAILS from .env and ensures each one has a matching User
 * row so notifications + the approvals page work end-to-end for developer
 * accounts. Idempotent — existing rows are left exactly as they are.
 *
 * New rows land with role=admin, orgLevel=ceo, isActive=true,
 * clickupUserId=null. You can edit any of that later in the DB.
 *
 * Run:
 *   npx tsx scripts/upsert-developer-users.ts
 */

import prisma from "../src/lib/prisma";

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] || "";
  const words = local.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/);
  const pretty = words.map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : "")).join(" ");
  return pretty || "Developer";
}

async function main() {
  const emails = (process.env.DEVELOPER_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (emails.length === 0) {
    console.log("[dev-upsert] DEVELOPER_EMAILS is empty — nothing to do.");
    return;
  }

  console.log(`[dev-upsert] Checking ${emails.length} developer email(s):`);

  let created = 0;
  let existing = 0;

  for (const email of emails) {
    const row = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, role: true, orgLevel: true, isActive: true },
    });
    if (row) {
      existing++;
      console.log(`  ✓ ${email} already present (id=${row.id}, role=${row.role}, orgLevel=${row.orgLevel}, active=${row.isActive})`);
      continue;
    }
    const newUser = await prisma.user.create({
      data: {
        email,
        name:          nameFromEmail(email),
        role:          "admin",   // session gate for admin-only API routes
        orgLevel:      "ceo",     // session gate for CEO-only approvals (final approver)
        isActive:      true,
        clickupUserId: null,      // allowed now that the column is nullable
      },
      select: { id: true, name: true },
    });
    created++;
    console.log(`  + Created ${email} → id=${newUser.id}, name="${newUser.name}", role=admin, orgLevel=ceo`);
  }

  console.log(`[dev-upsert] Done. created=${created} existing=${existing}`);
}

main()
  .catch((e) => { console.error("[dev-upsert] fatal:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
