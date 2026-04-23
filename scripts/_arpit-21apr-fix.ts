import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  // 2026-04-21 (IST calendar day) stored as UTC-midnight Date.
  const dateOnly = new Date("2026-04-21T00:00:00.000Z");
  // 8:18 AM IST = 02:48 UTC
  // 5:21 PM IST = 11:51 UTC
  const clockIn  = new Date("2026-04-21T02:48:00.000Z");
  const clockOut = new Date("2026-04-21T11:51:00.000Z");
  const totalMinutes    = Math.floor((clockOut.getTime() - clockIn.getTime()) / 60000); // 543
  const overtimeMinutes = Math.max(0, totalMinutes - 540);                              //   3

  const user = await p.user.findUnique({
    where: { email: "arpit@nbmediaproductions.com" },
    select: { id: true, name: true },
  });
  if (!user) { console.log("user not found"); return; }

  // ── 1. Hard-delete any regularization request for 2026-04-21 ───────────
  const regs = await p.attendanceRegularization.findMany({
    where: { userId: user.id, date: dateOnly },
  });
  for (const r of regs) {
    await p.attendanceRegularization.delete({ where: { id: r.id } });
    console.log(`✂  Deleted regularization id=${r.id} (status=${r.status}).`);
  }
  if (regs.length === 0) console.log("No regularization rows found for 2026-04-21.");

  // ── 2. Upsert attendance row for 2026-04-21 with the corrected shift ───
  const existing = await p.attendance.findUnique({
    where: { userId_date: { userId: user.id, date: dateOnly } },
  });

  const payload = {
    clockIn,
    clockOut,
    totalMinutes,
    overtimeMinutes,
    status: "present",
    isRegularized: false, // no longer backed by a regularization request
    notes: "Manual fix: shift set to 8:18 AM → 5:21 PM IST (regularization removed).",
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

  console.log(`Done for ${user.name} on 2026-04-21.`);
}

main().catch(console.error).finally(() => p.$disconnect());
