/**
 * One-shot cleanup: delete every currently-pending AttendanceRegularization
 * row (and any Notification rows that referenced them) so the user can submit
 * a fresh request with the new notification wiring.
 *
 * Only touches rows with `status = "pending"` — anything approved or rejected
 * is left untouched so history is preserved.
 *
 * Run:
 *   npx tsx scripts/delete-pending-regularizations.ts
 */

import prisma from "../src/lib/prisma";

async function main() {
    const pending = await prisma.attendanceRegularization.findMany({
        where: { status: "pending" },
        select: { id: true, userId: true, date: true, reason: true },
    });
    console.log(`[cleanup] Found ${pending.length} pending regularization(s).`);

    if (pending.length === 0) {
        console.log("[cleanup] Nothing to delete.");
        return;
    }

    for (const r of pending) {
        console.log(`  - id=${r.id} userId=${r.userId} date=${r.date.toISOString().slice(0, 10)}`);
    }

    const ids = pending.map((r) => r.id);

    // Clear any notifications that pointed to these requests first (entityId
    // is not FK-bound, so this is cosmetic — keeps the bell tidy).
    const notifs = await prisma.notification.deleteMany({
        where: { type: "regularization", entityId: { in: ids } },
    });
    console.log(`[cleanup] Deleted ${notifs.count} stray notification(s).`);

    const regs = await prisma.attendanceRegularization.deleteMany({
        where: { status: "pending", id: { in: ids } },
    });
    console.log(`[cleanup] Deleted ${regs.count} pending regularization(s). Done.`);
}

main()
    .catch((e) => { console.error("[cleanup] fatal:", e); process.exit(1); })
    .finally(() => prisma.$disconnect());
