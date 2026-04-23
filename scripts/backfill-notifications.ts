/**
 * Backfill notifications for requests that were submitted BEFORE the
 * notifyApprovers/notifyUsers fix shipped. Walks every currently-pending
 * request (AttendanceRegularization, WFHRequest, OnDutyRequest,
 * LeaveApplication) and — if no Notification rows exist yet for that
 * (type, entityId) pair — fires the standard approver + self-confirmation
 * notifications.
 *
 * Idempotent: checks the Notification table first, so rerunning is a no-op
 * after the first pass.
 *
 * Run once:
 *   npx tsx scripts/backfill-notifications.ts
 */

import prisma from "../src/lib/prisma";
import { notifyApprovers, notifyUsers, type NotificationType } from "../src/lib/notifications";

type WorkItem = {
    type: NotificationType;
    entityId: number;
    userId: number;
    title: string;
    approverTitle: string;
    body: string;
    linkUrl: string;
    approverLinkUrl: string;
    extras: number[];
};

async function collectPending(): Promise<WorkItem[]> {
    const fmtDate = (d: Date) =>
        new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

    const [regs, wfhs, ods, leaves] = await Promise.all([
        prisma.attendanceRegularization.findMany({
            where: { status: "pending" },
            include: { user: { select: { name: true } } },
        }),
        prisma.wFHRequest.findMany({
            where: { status: "pending" },
            include: { user: { select: { name: true } } },
        }),
        prisma.onDutyRequest.findMany({
            where: { status: "pending" },
            include: { user: { select: { name: true } } },
        }),
        prisma.leaveApplication.findMany({
            where: { status: { in: ["pending", "partially_approved"] } },
            include: {
                user:      { select: { name: true } },
                leaveType: { select: { name: true } },
            },
        }),
    ]);

    const items: WorkItem[] = [];

    for (const r of regs) {
        items.push({
            type: "regularization",
            entityId: r.id,
            userId:   r.userId,
            title:    `Regularization request submitted`,
            approverTitle: `${r.user?.name || "An employee"} requested regularization`,
            body:     `Date: ${fmtDate(r.date)} — ${String(r.reason ?? "").slice(0, 120)}`,
            linkUrl:  "/dashboard/hr/attendance",
            approverLinkUrl: "/dashboard/hr/approvals?tab=regularize",
            extras:   [],
        });
    }

    for (const r of wfhs) {
        items.push({
            type: "wfh",
            entityId: r.id,
            userId:   r.userId,
            title:    `Work From Home request submitted`,
            approverTitle: `${r.user?.name || "An employee"} requested Work From Home`,
            body:     `Date: ${fmtDate(r.date)} — ${String(r.reason ?? "").slice(0, 120)}`,
            linkUrl:  "/dashboard/hr/attendance",
            approverLinkUrl: "/dashboard/hr/approvals?tab=wfh",
            extras:   [],
        });
    }

    for (const r of ods) {
        items.push({
            type: "on_duty",
            entityId: r.id,
            userId:   r.userId,
            title:    `On Duty request submitted`,
            approverTitle: `${r.user?.name || "An employee"} requested On Duty`,
            body:     `Date: ${fmtDate(r.date)}${r.location ? ` @ ${r.location}` : ""} — ${String(r.purpose ?? "").slice(0, 120)}`,
            linkUrl:  "/dashboard/hr/attendance",
            approverLinkUrl: "/dashboard/hr/approvals?tab=wfh",
            extras:   [],
        });
    }

    for (const r of leaves) {
        const range = `${fmtDate(r.fromDate)} – ${fmtDate(r.toDate)}`;
        const ltName = r.leaveType?.name || "leave";
        items.push({
            type: "leave",
            entityId: r.id,
            userId:   r.userId,
            title:    `Your ${ltName} request was submitted`,
            approverTitle: `${r.user?.name || "An employee"} requested ${ltName}`,
            body:     range,
            linkUrl:  "/dashboard/hr/leaves",
            approverLinkUrl: "/dashboard/hr/approvals?tab=leave",
            extras:   r.notifyUserIds ?? [],
        });
    }

    return items;
}

async function main() {
    const items = await collectPending();
    console.log(`[backfill] ${items.length} pending request(s) to evaluate`);

    let createdApprovers = 0;
    let createdSelf = 0;
    let skipped = 0;

    for (const it of items) {
        // Dedupe on (type, entityId) — if any notification already exists for
        // this request, skip it entirely.
        const existing = await prisma.notification.count({
            where: { type: it.type, entityId: it.entityId },
        });
        if (existing > 0) {
            skipped++;
            continue;
        }

        await notifyApprovers({
            actorId:  it.userId,
            type:     it.type,
            entityId: it.entityId,
            title:    it.approverTitle,
            body:     it.body,
            linkUrl:  it.approverLinkUrl,
            extraUserIds: it.extras,
        });

        await notifyUsers({
            actorId:  null,
            userIds:  [it.userId],
            type:     it.type,
            entityId: it.entityId,
            title:    it.title,
            body:     `${it.body} — awaiting approval.`,
            linkUrl:  it.linkUrl,
        });

        createdApprovers++;
        createdSelf++;
    }

    console.log(
        `[backfill] done. Sent approver notifs for ${createdApprovers} request(s), ` +
        `self notifs for ${createdSelf}, skipped ${skipped} already-notified.`
    );
}

main()
    .catch((e) => { console.error("[backfill] fatal:", e); process.exit(1); })
    .finally(() => prisma.$disconnect());
