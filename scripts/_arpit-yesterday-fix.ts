import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  // Yesterday (IST calendar day) → 2026-04-22, stored as UTC-midnight Date.
  const dateOnly = new Date("2026-04-22T00:00:00.000Z");
  // 8:15 AM IST = 02:45 UTC
  // 5:17 PM IST = 11:47 UTC
  const clockIn  = new Date("2026-04-22T02:45:00.000Z");
  const clockOut = new Date("2026-04-22T11:47:00.000Z");
  const totalMinutes    = Math.floor((clockOut.getTime() - clockIn.getTime()) / 60000); // 542
  const overtimeMinutes = Math.max(0, totalMinutes - 540);                              //   2

  const user = await p.user.findUnique({
    where: { email: "arpit@nbmediaproductions.com" },
    select: { id: true, name: true },
  });
  if (!user) { console.log("user not found"); return; }

  // ── 1. Delete the sick-leave application for 2026-04-22 ────────────────
  const leaves = await p.leaveApplication.findMany({
    where: {
      userId: user.id,
      fromDate: { lte: dateOnly },
      toDate:   { gte: dateOnly },
      leaveType: { code: "SL" },
    },
    include: { leaveType: true },
  });

  for (const lv of leaves) {
    // Refund the balance if the request had consumed it (approved/partially_approved/pending hold).
    const consumed = ["approved", "partially_approved"].includes(lv.status);
    const heldPending = lv.status === "pending";
    if (consumed || heldPending) {
      const year = lv.fromDate.getUTCFullYear();
      const bal = await p.leaveBalance.findUnique({
        where: { userId_leaveTypeId_year: { userId: user.id, leaveTypeId: lv.leaveTypeId, year } },
      });
      if (bal) {
        await p.leaveBalance.update({
          where: { id: bal.id },
          data: consumed
            ? { usedDays:    { decrement: lv.totalDays } }
            : { pendingDays: { decrement: lv.totalDays } },
        });
        console.log(`↺ Refunded ${lv.totalDays} day(s) to ${lv.leaveType.code} balance (${year}).`);
      }
    }
    await p.leaveApplication.delete({ where: { id: lv.id } });
    console.log(`✂  Deleted ${lv.leaveType.code} application id=${lv.id} (${lv.status}).`);
  }

  // ── 2. Upsert attendance row for 2026-04-22 with a completed shift ─────
  const existing = await p.attendance.findUnique({
    where: { userId_date: { userId: user.id, date: dateOnly } },
  });

  const payload = {
    clockIn,
    clockOut,
    totalMinutes,
    overtimeMinutes,
    status: "present",
    isRegularized: true,
    notes: "Manual fix: replaced sick leave with a worked day (8:15 AM → 5:17 PM IST).",
  };

  if (existing) {
    await p.attendance.update({ where: { id: existing.id }, data: payload });
    console.log(`✓ Updated attendance id=${existing.id}:`, payload);
  } else {
    const created = await p.attendance.create({
      data: { userId: user.id, date: dateOnly, ...payload },
    });
    console.log(`✓ Created attendance id=${created.id}:`, payload);
  }

  console.log(`Done for ${user.name} on 2026-04-22.`);
}

main().catch(console.error).finally(() => p.$disconnect());
