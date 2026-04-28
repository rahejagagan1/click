/**
 * One-off: write Arpit's attendance for a specific date.
 * Run with:  npx tsx scripts/_set-arpit-clockin.ts
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

// Edit this block to retarget the script.
const TARGET_DATE_IST = "2026-04-24"; // YYYY-MM-DD in IST
const CLOCK_IN_IST = "08:14";         // HH:MM 24-hour IST
const CLOCK_OUT_IST: string | null = "17:15"; // HH:MM 24-hour IST, or null

function istToUtc(dateIst: string, timeIst: string): Date {
  // IST = UTC+5:30. To go IST → UTC, subtract 5h30m.
  const [hh, mm] = timeIst.split(":").map(Number);
  const totalIstMin = hh * 60 + mm;
  const totalUtcMin = totalIstMin - (5 * 60 + 30);
  let utcDay = dateIst;
  let utcMinutes = totalUtcMin;
  if (utcMinutes < 0) {
    utcMinutes += 24 * 60;
    const d = new Date(`${dateIst}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    utcDay = d.toISOString().slice(0, 10);
  } else if (utcMinutes >= 24 * 60) {
    utcMinutes -= 24 * 60;
    const d = new Date(`${dateIst}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    utcDay = d.toISOString().slice(0, 10);
  }
  const utcH = Math.floor(utcMinutes / 60).toString().padStart(2, "0");
  const utcM = (utcMinutes % 60).toString().padStart(2, "0");
  return new Date(`${utcDay}T${utcH}:${utcM}:00.000Z`);
}

async function main() {
  const arpit = await p.user.findFirst({
    where: {
      OR: [
        { email: "ai.nbmediaa@gmail.com" },
        { email: "arpitsharma4602@gmail.com" },
        { email: "arpit@nbmediaproductions.com" },
        { name: { contains: "Arpit", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true },
  });
  if (!arpit) throw new Error("Arpit user not found");
  console.log("Found user:", arpit);

  const dateOnly = new Date(`${TARGET_DATE_IST}T00:00:00.000Z`);
  const clockIn  = istToUtc(TARGET_DATE_IST, CLOCK_IN_IST);
  const clockOut = CLOCK_OUT_IST ? istToUtc(TARGET_DATE_IST, CLOCK_OUT_IST) : null;
  const totalMinutes = clockOut
    ? Math.max(0, Math.round((clockOut.getTime() - clockIn.getTime()) / 60000))
    : 0;

  console.log("date (IST):", TARGET_DATE_IST);
  console.log("clockIn (UTC):",  clockIn.toISOString(),  "→ IST", CLOCK_IN_IST);
  console.log("clockOut (UTC):", clockOut?.toISOString() ?? "—", "→ IST", CLOCK_OUT_IST);
  console.log("totalMinutes:", totalMinutes, `(${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m)`);

  const existing = await p.attendance.findUnique({
    where: { userId_date: { userId: arpit.id, date: dateOnly } },
  });

  if (existing) {
    const updated = await p.attendance.update({
      where: { id: existing.id },
      data: { clockIn, clockOut, totalMinutes, status: "present" },
    });
    console.log("Updated existing record:", {
      id: updated.id, clockIn: updated.clockIn, clockOut: updated.clockOut,
      totalMinutes: updated.totalMinutes, status: updated.status,
    });
  } else {
    const created = await p.attendance.create({
      data: {
        userId: arpit.id,
        date: dateOnly,
        clockIn,
        clockOut,
        status: "present",
        totalMinutes,
      },
    });
    console.log("Created new record:", {
      id: created.id, clockIn: created.clockIn, clockOut: created.clockOut,
      totalMinutes: created.totalMinutes,
    });
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => p.$disconnect());
