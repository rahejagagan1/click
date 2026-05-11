// Transfers ALL profile & HR data from a source user to a target user.
// One-to-one records on the source replace those on the target.
// Many-to-one records are re-keyed from source userId → target userId.
// Raw-SQL tables (EmployeeOnboarding*) are also migrated.
//
// Run (dry):   npx tsx scripts/_transfer-user-profile.ts <source-email> <target-email>
// Run (live):  npx tsx scripts/_transfer-user-profile.ts <source-email> <target-email> --force

import { PrismaClient } from "@prisma/client";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }

  const args   = process.argv.slice(2);
  const emails = args.filter((a) => !a.startsWith("--"));
  const force  = args.includes("--force");

  if (emails.length !== 2) {
    console.error("Usage: npx tsx scripts/_transfer-user-profile.ts <source-email> <target-email> [--force]");
    process.exit(1);
  }

  const [srcEmail, tgtEmail] = emails.map((e) => e.toLowerCase());
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    // ── Load both users ────────────────────────────────────────────────
    const [src, tgt] = await Promise.all([
      prisma.user.findFirst({
        where: { email: { equals: srcEmail, mode: "insensitive" } },
        include: { employeeProfile: true, userShift: true, salaryStructure: true, employeeExit: true },
      }),
      prisma.user.findFirst({
        where: { email: { equals: tgtEmail, mode: "insensitive" } },
        include: { employeeProfile: true, userShift: true, salaryStructure: true, employeeExit: true },
      }),
    ]);

    if (!src) { console.error(`Source user not found: ${srcEmail}`); process.exit(1); }
    if (!tgt) { console.error(`Target user not found: ${tgtEmail}`); process.exit(1); }

    console.log(`\nSource  : id=${src.id}  ${src.name}  <${src.email}>`);
    console.log(`Target  : id=${tgt.id}  ${tgt.name}  <${tgt.email}>\n`);

    // ── Count what will be moved ────────────────────────────────────────
    const [
      attendanceCnt, leaveBalCnt, leaveAppCnt, assetCnt,
      docOwnerCnt, docUploaderCnt, ticketRaisedCnt, ticketCommentCnt,
      announceCnt, announceReadCnt, goalCnt, expenseCnt, travelCnt,
      payslipCnt, regularizeCnt, wfhCnt, onDutyCnt, compOffCnt,
      engagePostCnt, engageReactionCnt, engageCommentCnt, notifCnt,
      tabPermCnt, auditCnt, feedbackCnt,
      onboardingRows, onboardingTaskRows,
    ] = await Promise.all([
      prisma.attendance.count({ where: { userId: src.id } }),
      prisma.leaveBalance.count({ where: { userId: src.id } }),
      prisma.leaveApplication.count({ where: { userId: src.id } }),
      prisma.assetAssignment.count({ where: { userId: src.id } }),
      prisma.employeeDocument.count({ where: { userId: src.id } }),
      prisma.employeeDocument.count({ where: { uploadedById: src.id } }),
      prisma.ticket.count({ where: { raisedById: src.id } }),
      prisma.ticketComment.count({ where: { authorId: src.id } }),
      prisma.announcement.count({ where: { postedById: src.id } }),
      prisma.announcementRead.count({ where: { userId: src.id } }),
      prisma.goal.count({ where: { ownerId: src.id } }),
      prisma.expense.count({ where: { userId: src.id } }),
      prisma.travelRequest.count({ where: { userId: src.id } }),
      prisma.payslip.count({ where: { userId: src.id } }),
      prisma.attendanceRegularization.count({ where: { userId: src.id } }),
      prisma.wFHRequest.count({ where: { userId: src.id } }),
      prisma.onDutyRequest.count({ where: { userId: src.id } }),
      prisma.compOffRequest.count({ where: { userId: src.id } }),
      prisma.engagePost.count({ where: { authorId: src.id } }),
      prisma.engageReaction.count({ where: { userId: src.id } }),
      prisma.engageComment.count({ where: { authorId: src.id } }),
      prisma.notification.count({ where: { userId: src.id } }),
      prisma.userTabPermission.count({ where: { userId: src.id } }),
      prisma.auditLog.count({ where: { actorId: src.id } }),
      prisma.userFeedback.count({ where: { userId: src.id } }),
      prisma.$queryRaw<{count:bigint}[]>`SELECT COUNT(*) as count FROM "EmployeeOnboarding" WHERE "userId" = ${src.id}`.then(r => Number(r[0]?.count ?? 0)).catch(() => 0),
      prisma.$queryRaw<{count:bigint}[]>`
        SELECT COUNT(*) as count FROM "EmployeeOnboardingTask" eot
        JOIN "EmployeeOnboarding" eo ON eo.id = eot."onboardingId"
        WHERE eo."userId" = ${src.id}
      `.then(r => Number(r[0]?.count ?? 0)).catch(() => 0),
    ]);

    console.log("── One-to-one records ─────────────────────────────────────────");
    console.log(`  EmployeeProfile : ${src.employeeProfile ? `✓ (id=${src.employeeProfile.id}, empId=${src.employeeProfile.employeeId})` : "none"}${tgt.employeeProfile ? "  [will REPLACE target's existing profile]" : ""}`);
    console.log(`  UserShift       : ${src.userShift ? "✓" : "none"}${tgt.userShift ? "  [will REPLACE target's]" : ""}`);
    console.log(`  SalaryStructure : ${src.salaryStructure ? "✓" : "none"}${tgt.salaryStructure ? "  [will REPLACE target's]" : ""}`);
    console.log(`  EmployeeExit    : ${src.employeeExit ? "✓" : "none"}${tgt.employeeExit ? "  [will REPLACE target's]" : ""}`);
    console.log("\n── Many-to-one records ────────────────────────────────────────");
    console.log(`  Attendance               : ${attendanceCnt}`);
    console.log(`  LeaveBalance             : ${leaveBalCnt}`);
    console.log(`  LeaveApplication         : ${leaveAppCnt}`);
    console.log(`  AssetAssignment          : ${assetCnt}`);
    console.log(`  EmployeeDocument (owner) : ${docOwnerCnt}`);
    console.log(`  EmployeeDocument (upldr) : ${docUploaderCnt}`);
    console.log(`  Ticket (raised)          : ${ticketRaisedCnt}`);
    console.log(`  TicketComment            : ${ticketCommentCnt}`);
    console.log(`  Announcement             : ${announceCnt}`);
    console.log(`  AnnouncementRead         : ${announceReadCnt}`);
    console.log(`  Goal                     : ${goalCnt}`);
    console.log(`  Expense                  : ${expenseCnt}`);
    console.log(`  TravelRequest            : ${travelCnt}`);
    console.log(`  Payslip                  : ${payslipCnt}`);
    console.log(`  AttendanceRegularization : ${regularizeCnt}`);
    console.log(`  WFHRequest               : ${wfhCnt}`);
    console.log(`  OnDutyRequest            : ${onDutyCnt}`);
    console.log(`  CompOffRequest           : ${compOffCnt}`);
    console.log(`  EngagePost               : ${engagePostCnt}`);
    console.log(`  EngageReaction           : ${engageReactionCnt}`);
    console.log(`  EngageComment            : ${engageCommentCnt}`);
    console.log(`  Notification             : ${notifCnt}`);
    console.log(`  UserTabPermission        : ${tabPermCnt}`);
    console.log(`  AuditLog                 : ${auditCnt}`);
    console.log(`  UserFeedback             : ${feedbackCnt}`);
    console.log(`  EmployeeOnboarding       : ${onboardingRows}`);
    console.log(`  EmployeeOnboardingTask   : ${onboardingTaskRows} (via onboarding)`);

    if (!force) {
      console.log("\n[dry-run] Pass --force to execute the transfer.");
      return;
    }

    // ── Execute in a transaction ────────────────────────────────────────
    console.log("\nExecuting transfer…");

    await prisma.$transaction(async (tx) => {

      // ── Copy User-level fields from source → target ───────────────────
      await tx.user.update({
        where: { id: tgt.id },
        data: {
          name:                       src.name,
          role:                       src.role,
          orgLevel:                   src.orgLevel,
          managerId:                  src.managerId,
          inlineManagerId:            src.inlineManagerId,
          teamCapsule:                src.teamCapsule,
          monthlyDeliveryTargetCases: src.monthlyDeliveryTargetCases,
          profilePictureUrl:          src.profilePictureUrl,
          reportAccess:               src.reportAccess,
          onboardingPending:          src.onboardingPending,
          clickupUserId:              src.clickupUserId,
        },
      });
      console.log(`  ✓ User fields copied (role=${src.role}, orgLevel=${src.orgLevel}, manager=${src.managerId ?? "none"})`);

      // ── One-to-one: EmployeeProfile ──────────────────────────────────
      if (src.employeeProfile) {
        if (tgt.employeeProfile) {
          await tx.employeeProfile.delete({ where: { userId: tgt.id } });
          console.log(`  Deleted target's existing EmployeeProfile (id=${tgt.employeeProfile.id})`);
        }
        await tx.employeeProfile.update({
          where: { userId: src.id },
          data: { userId: tgt.id },
        });
        console.log(`  ✓ EmployeeProfile moved (empId=${src.employeeProfile.employeeId})`);
      }

      // ── One-to-one: UserShift ─────────────────────────────────────────
      if (src.userShift) {
        if (tgt.userShift) {
          await tx.userShift.delete({ where: { userId: tgt.id } });
          console.log("  Deleted target's existing UserShift");
        }
        await tx.userShift.update({ where: { userId: src.id }, data: { userId: tgt.id } });
        console.log("  ✓ UserShift moved");
      }

      // ── One-to-one: SalaryStructure ───────────────────────────────────
      if (src.salaryStructure) {
        if (tgt.salaryStructure) {
          await tx.salaryStructure.delete({ where: { userId: tgt.id } });
          console.log("  Deleted target's existing SalaryStructure");
        }
        await tx.salaryStructure.update({ where: { userId: src.id }, data: { userId: tgt.id } });
        console.log("  ✓ SalaryStructure moved");
      }

      // ── One-to-one: EmployeeExit ──────────────────────────────────────
      if (src.employeeExit) {
        if (tgt.employeeExit) {
          await tx.employeeExit.delete({ where: { userId: tgt.id } });
          console.log("  Deleted target's existing EmployeeExit");
        }
        await tx.employeeExit.update({ where: { userId: src.id }, data: { userId: tgt.id } });
        console.log("  ✓ EmployeeExit moved");
      }

      // ── Many-to-one re-keys ───────────────────────────────────────────
      const rekey = async (label: string, fn: () => Promise<{ count: number }>) => {
        const { count } = await fn();
        if (count > 0) console.log(`  ✓ ${label}: ${count} row(s)`);
      };

      await rekey("Attendance", () =>
        tx.attendance.updateMany({ where: { userId: src.id }, data: { userId: tgt.id } }));

      await rekey("LeaveBalance", () =>
        tx.leaveBalance.updateMany({ where: { userId: src.id }, data: { userId: tgt.id } }));

      await rekey("LeaveApplication", () =>
        tx.leaveApplication.updateMany({ where: { userId: src.id }, data: { userId: tgt.id } }));

      await rekey("AssetAssignment", () =>
        tx.assetAssignment.updateMany({ where: { userId: src.id }, data: { userId: tgt.id } }));

      await rekey("EmployeeDocument (owner)", () =>
        tx.employeeDocument.updateMany({ where: { userId: src.id }, data: { userId: tgt.id } }));

      await rekey("EmployeeDocument (uploader)", () =>
        tx.employeeDocument.updateMany({ where: { uploadedById: src.id }, data: { uploadedById: tgt.id } }));

      await rekey("Ticket (raised)", () =>
        tx.ticket.updateMany({ where: { raisedById: src.id }, data: { raisedById: tgt.id } }));

      await rekey("TicketComment", () =>
        tx.ticketComment.updateMany({ where: { authorId: src.id }, data: { authorId: tgt.id } }));

      await rekey("Announcement", () =>
        tx.announcement.updateMany({ where: { postedById: src.id }, data: { postedById: tgt.id } }));

      await rekey("AnnouncementRead", () =>
        tx.announcementRead.updateMany({ where: { userId: src.id }, data: { userId: tgt.id } }));

      await rekey("Goal", () =>
        tx.goal.updateMany({ where: { ownerId: src.id }, data: { ownerId: tgt.id } }));

      await rekey("Expense", () =>
        tx.expense.updateMany({ where: { userId: src.id }, data: { userId: tgt.id } }));

      await rekey("TravelRequest", () =>
        tx.travelRequest.updateMany({ where: { userId: src.id }, data: { userId: tgt.id } }));

      await rekey("Payslip", () =>
        tx.payslip.updateMany({ where: { userId: src.id }, data: { userId: tgt.id } }));

      await rekey("AttendanceRegularization", () =>
        tx.attendanceRegularization.updateMany({ where: { userId: src.id }, data: { userId: tgt.id } }));

      await rekey("WFHRequest", () =>
        tx.wFHRequest.updateMany({ where: { userId: src.id }, data: { userId: tgt.id } }));

      await rekey("OnDutyRequest", () =>
        tx.onDutyRequest.updateMany({ where: { userId: src.id }, data: { userId: tgt.id } }));

      await rekey("CompOffRequest", () =>
        tx.compOffRequest.updateMany({ where: { userId: src.id }, data: { userId: tgt.id } }));

      await rekey("EngagePost (author)", () =>
        tx.engagePost.updateMany({ where: { authorId: src.id }, data: { authorId: tgt.id } }));

      await rekey("EngagePost (praise)", () =>
        tx.engagePost.updateMany({ where: { praiseToId: src.id }, data: { praiseToId: tgt.id } }));

      await rekey("EngageReaction", () =>
        tx.engageReaction.updateMany({ where: { userId: src.id }, data: { userId: tgt.id } }));

      await rekey("EngageComment", () =>
        tx.engageComment.updateMany({ where: { authorId: src.id }, data: { authorId: tgt.id } }));

      await rekey("Notification", () =>
        tx.notification.updateMany({ where: { userId: src.id }, data: { userId: tgt.id } }));

      await rekey("UserTabPermission", () =>
        tx.userTabPermission.updateMany({ where: { userId: src.id }, data: { userId: tgt.id } }));

      await rekey("AuditLog", () =>
        tx.auditLog.updateMany({ where: { actorId: src.id }, data: { actorId: tgt.id } }));

      await rekey("UserFeedback", () =>
        tx.userFeedback.updateMany({ where: { userId: src.id }, data: { userId: tgt.id } }));

      // ── Raw-SQL tables (not in Prisma client) ─────────────────────────
      await tx.$executeRaw`
        UPDATE "EmployeeOnboarding" SET "userId" = ${tgt.id} WHERE "userId" = ${src.id}
      `;
      console.log("  ✓ EmployeeOnboarding migrated (raw SQL)");

      // ── Deactivate source user ─────────────────────────────────────────
      await tx.user.update({
        where: { id: src.id },
        data: { isActive: false },
      });
      console.log(`\n  ✓ Source user id=${src.id} marked isActive=false`);
    });

    console.log(`\n✓ Transfer complete. All data from <${src.email}> is now under <${tgt.email}>.`);
    console.log(`  Source account (id=${src.id}) has been deactivated.`);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
