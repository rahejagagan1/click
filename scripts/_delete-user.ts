// Hard-delete a User row by email. Refuses to run unless --force is
// passed so a misclick doesn't nuke someone. Cascades whatever Prisma
// is configured to cascade; if FK constraints block the delete the
// script reports which related rows to clean up first instead of
// half-deleting silently.
//
// Run:  npx tsx scripts/_delete-user.ts user@example.com
// Add `--force` to actually delete (default = dry-run preview).

import { PrismaClient } from "@prisma/client";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const args  = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith("--"))?.toLowerCase();
  const force = args.includes("--force");
  if (!email) {
    console.error("Usage: npx tsx scripts/_delete-user.ts <email> [--force]");
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      include: { employeeProfile: true },
    });
    if (!user) {
      console.log(`No user found with email '${email}'.`);
      return;
    }

    console.log(`Target: id=${user.id}  ${user.name}  <${user.email}>`);
    console.log(`        isActive=${user.isActive}  role=${user.role}  orgLevel=${user.orgLevel}`);

    // Count related rows in the tables most likely to block a hard
    // delete or leak orphans.
    const [
      leaves, attendance, wfh, onDuty, leaveBalances, notifications,
      monthlyRatings, teamMembers,
    ] = await Promise.all([
      prisma.leaveApplication.count({ where: { userId: user.id } }),
      prisma.attendance.count({ where: { userId: user.id } }),
      prisma.wFHRequest.count({ where: { userId: user.id } }),
      prisma.onDutyRequest.count({ where: { userId: user.id } }),
      prisma.leaveBalance.count({ where: { userId: user.id } }),
      prisma.notification.count({ where: { userId: user.id } }),
      prisma.monthlyRating.count({ where: { userId: user.id } }),
      prisma.user.count({ where: { managerId: user.id } }),
    ]);

    console.log("Related row counts:");
    console.log(`  LeaveApplication: ${leaves}`);
    console.log(`  Attendance:       ${attendance}`);
    console.log(`  WFHRequest:       ${wfh}`);
    console.log(`  OnDutyRequest:    ${onDuty}`);
    console.log(`  LeaveBalance:     ${leaveBalances}`);
    console.log(`  Notification:     ${notifications}`);
    console.log(`  MonthlyRating:    ${monthlyRatings}`);
    console.log(`  Direct reports:   ${teamMembers}`);

    if (teamMembers > 0) {
      console.error(`\n✗ Refusing to delete: ${teamMembers} user(s) report to this person.`);
      console.error(`  Reassign their managerId first via Admin → Users.`);
      process.exit(2);
    }

    if (!force) {
      console.log("\n[dry] Pass --force to actually delete the User row (and let Prisma cascade related rows).");
      return;
    }

    // Best-effort cleanup of common tables that don't have ON DELETE
    // CASCADE wired in their FK. Wrapped in a transaction so a partial
    // failure rolls back.
    await prisma.$transaction(async (tx) => {
      await tx.leaveApplication.deleteMany({ where: { userId: user.id } });
      await tx.attendance.deleteMany({ where: { userId: user.id } });
      await tx.wFHRequest.deleteMany({ where: { userId: user.id } });
      await tx.onDutyRequest.deleteMany({ where: { userId: user.id } });
      await tx.leaveBalance.deleteMany({ where: { userId: user.id } });
      await tx.notification.deleteMany({ where: { userId: user.id } });
      await tx.monthlyRating.deleteMany({ where: { userId: user.id } });
      if (user.employeeProfile) {
        await tx.employeeProfile.delete({ where: { userId: user.id } });
      }
      await tx.user.delete({ where: { id: user.id } });
    });
    console.log(`\n✓ Deleted user id=${user.id}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
