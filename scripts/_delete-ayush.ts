/**
 * Hard-deletes user id=55 (Ayush, ayushrajbahr@nbmediaproductions.com).
 *
 * The User table has 50+ FK relations, most with onDelete: Restrict.
 * This script first nulls out nullable approver/actor pointers, then
 * deletes child rows where the FK is non-nullable, then deletes the
 * user row itself in a single transaction.
 *
 * Usage:
 *   npx tsx scripts/_delete-ayush.ts            # audit (counts only, no writes)
 *   npx tsx scripts/_delete-ayush.ts --apply    # actually delete
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TARGET_EMAIL = "ayushrajbahr@nbmediaproductions.com";
let TARGET_ID = -1; // resolved at runtime from TARGET_EMAIL

async function resolveTargetId() {
    const u = await prisma.user.findUnique({
        where: { email: TARGET_EMAIL },
        select: { id: true, name: true, email: true, role: true, isActive: true },
    });
    if (!u) {
        console.error(`No user with email=${TARGET_EMAIL} found in this database.`);
        process.exit(1);
    }
    TARGET_ID = u.id;
    return u;
}

async function audit() {
    const u = await resolveTargetId();
    console.log(`Target: id=${u.id} ${u.name} <${u.email}> role=${u.role} active=${u.isActive}`);
    console.log("");

    const counts: Record<string, number> = {};

    // ── direct cascades (FYI, will be removed automatically by user delete) ──
    counts["UserFeedback (cascade)"] = await prisma.userFeedback.count({ where: { userId: TARGET_ID } });
    counts["EmployeeProfile (cascade)"] = await prisma.employeeProfile.count({ where: { userId: TARGET_ID } });
    counts["UserShift (cascade)"] = await prisma.userShift.count({ where: { userId: TARGET_ID } });
    counts["Attendance (cascade)"] = await prisma.attendance.count({ where: { userId: TARGET_ID } });
    counts["LeaveBalance (cascade)"] = await prisma.leaveBalance.count({ where: { userId: TARGET_ID } });
    counts["LeaveApplication as applicant (cascade)"] = await prisma.leaveApplication.count({ where: { userId: TARGET_ID } });
    counts["AttendanceRegularization as user (cascade)"] = await prisma.attendanceRegularization.count({ where: { userId: TARGET_ID } });
    counts["WFHRequest as user (cascade)"] = await prisma.wFHRequest.count({ where: { userId: TARGET_ID } });
    counts["OnDutyRequest as user (cascade)"] = await prisma.onDutyRequest.count({ where: { userId: TARGET_ID } });
    counts["CompOffRequest as user (cascade)"] = await prisma.compOffRequest.count({ where: { userId: TARGET_ID } });
    counts["Goal as owner (cascade)"] = await prisma.goal.count({ where: { ownerId: TARGET_ID } });
    counts["Expense as user (cascade)"] = await prisma.expense.count({ where: { userId: TARGET_ID } });
    counts["TravelRequest as user (cascade)"] = await prisma.travelRequest.count({ where: { userId: TARGET_ID } });
    counts["SalaryStructure (cascade)"] = await prisma.salaryStructure.count({ where: { userId: TARGET_ID } });
    counts["EmployeeDocument as owner (cascade)"] = await prisma.employeeDocument.count({ where: { userId: TARGET_ID } });
    counts["AnnouncementRead (cascade)"] = await prisma.announcementRead.count({ where: { userId: TARGET_ID } });
    counts["Notification as recipient (cascade)"] = await prisma.notification.count({ where: { userId: TARGET_ID } });
    counts["UserTabPermission as owner (cascade)"] = await prisma.userTabPermission.count({ where: { userId: TARGET_ID } });
    counts["UserReportAccess (cascade)"] = await prisma.userReportAccess.count({
        where: { OR: [{ userId: TARGET_ID }, { managerId: TARGET_ID }] },
    });
    counts["YoutubeDashUserQuarterChannel (cascade)"] = await prisma.youtubeDashUserQuarterChannel.count({ where: { userId: TARGET_ID } });

    // ── nullable approver/actor FKs (we will SET NULL) ──
    counts["LeaveApplication.approvedById (set null)"] = await prisma.leaveApplication.count({ where: { approvedById: TARGET_ID } });
    counts["LeaveApplication.finalApprovedById (set null)"] = await prisma.leaveApplication.count({ where: { finalApprovedById: TARGET_ID } });
    counts["AttendanceRegularization.approvedById (set null)"] = await prisma.attendanceRegularization.count({ where: { approvedById: TARGET_ID } });
    counts["AttendanceRegularization.finalApprovedById (set null)"] = await prisma.attendanceRegularization.count({ where: { finalApprovedById: TARGET_ID } });
    counts["AttendanceRegularization.grantedByAdminId (set null)"] = await prisma.attendanceRegularization.count({ where: { grantedByAdminId: TARGET_ID } });
    counts["WFHRequest.approvedById (set null)"] = await prisma.wFHRequest.count({ where: { approvedById: TARGET_ID } });
    counts["OnDutyRequest.approvedById (set null)"] = await prisma.onDutyRequest.count({ where: { approvedById: TARGET_ID } });
    counts["CompOffRequest.approvedById (set null)"] = await prisma.compOffRequest.count({ where: { approvedById: TARGET_ID } });
    counts["Expense.approvedById (set null)"] = await prisma.expense.count({ where: { approvedById: TARGET_ID } });
    counts["TravelRequest.approvedById (set null)"] = await prisma.travelRequest.count({ where: { approvedById: TARGET_ID } });
    counts["Ticket.assignedToId (set null)"] = await prisma.ticket.count({ where: { assignedToId: TARGET_ID } });
    counts["Notification.actorId (set null)"] = await prisma.notification.count({ where: { actorId: TARGET_ID } });
    counts["UserTabPermission.updatedBy (set null)"] = await prisma.userTabPermission.count({ where: { updatedBy: TARGET_ID } });
    counts["EngagePost.praiseToId (set null)"] = await prisma.engagePost.count({ where: { praiseToId: TARGET_ID } });
    counts["Violation.responsiblePersonId (set null)"] = await prisma.violation.count({ where: { responsiblePersonId: TARGET_ID } });
    counts["Case.assigneeUserId (set null)"] = await prisma.case.count({ where: { assigneeUserId: TARGET_ID } });
    counts["Case.researcherUserId (set null)"] = await prisma.case.count({ where: { researcherUserId: TARGET_ID } });
    counts["Case.writerUserId (set null)"] = await prisma.case.count({ where: { writerUserId: TARGET_ID } });
    counts["Case.editorUserId (set null)"] = await prisma.case.count({ where: { editorUserId: TARGET_ID } });
    counts["Subtask.assigneeUserId (set null)"] = await prisma.subtask.count({ where: { assigneeUserId: TARGET_ID } });
    counts["User.managerId (set null)"] = await prisma.user.count({ where: { managerId: TARGET_ID } });
    counts["ScorecardConfig.userId (delete; user-specific overrides)"] = await prisma.scorecardConfig.count({ where: { userId: TARGET_ID } });

    // ── non-nullable child rows we must delete first ──
    counts["CaseAssignee (delete)"] = await prisma.caseAssignee.count({ where: { userId: TARGET_ID } });
    counts["MonthlyRating (delete)"] = await prisma.monthlyRating.count({ where: { userId: TARGET_ID } });
    counts["ScoreEditLog as editor (delete)"] = await prisma.scoreEditLog.count({ where: { editedBy: TARGET_ID } });
    counts["ManagerRating as manager (delete)"] = await prisma.managerRating.count({ where: { managerId: TARGET_ID } });
    counts["ManagerRating as user (delete)"] = await prisma.managerRating.count({ where: { userId: TARGET_ID } });
    counts["TeamManagerRating as teamMember (delete)"] = await prisma.teamManagerRating.count({ where: { teamMemberId: TARGET_ID } });
    counts["TeamManagerRating as manager (delete)"] = await prisma.teamManagerRating.count({ where: { managerId: TARGET_ID } });
    counts["WeeklyReport as manager (delete)"] = await prisma.weeklyReport.count({ where: { managerId: TARGET_ID } });
    counts["MonthlyReport as manager (delete)"] = await prisma.monthlyReport.count({ where: { managerId: TARGET_ID } });
    counts["Violation as user (delete)"] = await prisma.violation.count({ where: { userId: TARGET_ID } });
    counts["Violation as reporter (delete)"] = await prisma.violation.count({ where: { reportedBy: TARGET_ID } });
    counts["Announcement as poster (delete)"] = await prisma.announcement.count({ where: { postedById: TARGET_ID } });
    counts["Ticket as raiser (delete; cascades comments)"] = await prisma.ticket.count({ where: { raisedById: TARGET_ID } });
    counts["TicketComment as author (delete)"] = await prisma.ticketComment.count({ where: { authorId: TARGET_ID } });
    counts["AssetAssignment (delete)"] = await prisma.assetAssignment.count({ where: { userId: TARGET_ID } });
    counts["EmployeeDocument as uploader (delete)"] = await prisma.employeeDocument.count({ where: { uploadedById: TARGET_ID } });
    counts["Payslip (delete)"] = await prisma.payslip.count({ where: { userId: TARGET_ID } });
    counts["EngagePost as author (delete; cascades reactions/comments)"] = await prisma.engagePost.count({ where: { authorId: TARGET_ID } });
    counts["EngageComment as author (delete)"] = await prisma.engageComment.count({ where: { authorId: TARGET_ID } });
    counts["EngageReaction as user (delete)"] = await prisma.engageReaction.count({ where: { userId: TARGET_ID } });

    // ── AuditLog actorId is onDelete: SetNull, no work needed ──
    counts["AuditLog as actor (auto SetNull)"] = await prisma.auditLog.count({ where: { actorId: TARGET_ID } });

    console.log("Row counts tied to this user:");
    const total = Object.entries(counts)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);
    for (const [k, v] of total) console.log(`  ${String(v).padStart(6)}  ${k}`);
    if (total.length === 0) console.log("  (none)");

    return u;
}

async function apply() {
    await audit();
    console.log("");
    console.log("Applying deletion in a single transaction…");

    await prisma.$transaction(async (tx) => {
        // (timeout/maxWait are passed as the second arg below)
        // 1) Null out nullable approver / actor / assignee pointers
        await tx.leaveApplication.updateMany({ where: { approvedById: TARGET_ID }, data: { approvedById: null } });
        await tx.leaveApplication.updateMany({ where: { finalApprovedById: TARGET_ID }, data: { finalApprovedById: null } });
        await tx.attendanceRegularization.updateMany({ where: { approvedById: TARGET_ID }, data: { approvedById: null } });
        await tx.attendanceRegularization.updateMany({ where: { finalApprovedById: TARGET_ID }, data: { finalApprovedById: null } });
        await tx.attendanceRegularization.updateMany({ where: { grantedByAdminId: TARGET_ID }, data: { grantedByAdminId: null } });
        await tx.wFHRequest.updateMany({ where: { approvedById: TARGET_ID }, data: { approvedById: null } });
        await tx.onDutyRequest.updateMany({ where: { approvedById: TARGET_ID }, data: { approvedById: null } });
        await tx.compOffRequest.updateMany({ where: { approvedById: TARGET_ID }, data: { approvedById: null } });
        await tx.expense.updateMany({ where: { approvedById: TARGET_ID }, data: { approvedById: null } });
        await tx.travelRequest.updateMany({ where: { approvedById: TARGET_ID }, data: { approvedById: null } });
        await tx.ticket.updateMany({ where: { assignedToId: TARGET_ID }, data: { assignedToId: null } });
        await tx.notification.updateMany({ where: { actorId: TARGET_ID }, data: { actorId: null } });
        await tx.userTabPermission.updateMany({ where: { updatedBy: TARGET_ID }, data: { updatedBy: null } });
        await tx.engagePost.updateMany({ where: { praiseToId: TARGET_ID }, data: { praiseToId: null } });
        await tx.violation.updateMany({ where: { responsiblePersonId: TARGET_ID }, data: { responsiblePersonId: null } });
        await tx.case.updateMany({ where: { assigneeUserId: TARGET_ID }, data: { assigneeUserId: null } });
        await tx.case.updateMany({ where: { researcherUserId: TARGET_ID }, data: { researcherUserId: null } });
        await tx.case.updateMany({ where: { writerUserId: TARGET_ID }, data: { writerUserId: null } });
        await tx.case.updateMany({ where: { editorUserId: TARGET_ID }, data: { editorUserId: null } });
        await tx.subtask.updateMany({ where: { assigneeUserId: TARGET_ID }, data: { assigneeUserId: null } });
        await tx.user.updateMany({ where: { managerId: TARGET_ID }, data: { managerId: null } });

        // 2) Delete child rows whose FK to this user is non-nullable
        await tx.scorecardConfig.deleteMany({ where: { userId: TARGET_ID } });
        await tx.caseAssignee.deleteMany({ where: { userId: TARGET_ID } });
        await tx.scoreEditLog.deleteMany({ where: { editedBy: TARGET_ID } });
        await tx.monthlyRating.deleteMany({ where: { userId: TARGET_ID } });
        await tx.managerRating.deleteMany({ where: { OR: [{ managerId: TARGET_ID }, { userId: TARGET_ID }] } });
        await tx.teamManagerRating.deleteMany({ where: { OR: [{ teamMemberId: TARGET_ID }, { managerId: TARGET_ID }] } });
        await tx.weeklyReport.deleteMany({ where: { managerId: TARGET_ID } });
        await tx.monthlyReport.deleteMany({ where: { managerId: TARGET_ID } });
        await tx.violation.deleteMany({ where: { OR: [{ userId: TARGET_ID }, { reportedBy: TARGET_ID }] } });
        await tx.announcement.deleteMany({ where: { postedById: TARGET_ID } });
        await tx.ticket.deleteMany({ where: { raisedById: TARGET_ID } });
        await tx.ticketComment.deleteMany({ where: { authorId: TARGET_ID } });
        await tx.assetAssignment.deleteMany({ where: { userId: TARGET_ID } });
        await tx.employeeDocument.deleteMany({ where: { uploadedById: TARGET_ID } });
        await tx.payslip.deleteMany({ where: { userId: TARGET_ID } });
        await tx.engageReaction.deleteMany({ where: { userId: TARGET_ID } });
        await tx.engageComment.deleteMany({ where: { authorId: TARGET_ID } });
        await tx.engagePost.deleteMany({ where: { authorId: TARGET_ID } });

        // 3) Delete the user — remaining cascades clean themselves
        await tx.user.delete({ where: { id: TARGET_ID } });
    }, { timeout: 60_000, maxWait: 10_000 });

    const after = await prisma.user.findUnique({ where: { id: TARGET_ID } });
    if (after) {
        console.error("DELETE FAILED — user still present.");
        process.exit(1);
    }
    console.log(`✓ Deleted user id=${TARGET_ID}.`);
}

async function main() {
    if (process.argv.includes("--apply")) {
        await apply();
    } else {
        await audit();
        console.log("");
        console.log("Dry run only. Re-run with --apply to delete.");
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
