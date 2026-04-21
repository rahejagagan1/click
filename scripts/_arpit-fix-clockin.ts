import { PrismaClient } from "@prisma/client";
import { istTodayDateOnly } from "../src/lib/ist-date";

const p = new PrismaClient();

async function main() {
  const today = istTodayDateOnly(); // UTC-midnight on today's IST calendar day
  const user  = await p.user.findUnique({
    where: { email: "arpit@nbmediaproductions.com" },
    select: { id: true, name: true },
  });
  if (!user) { console.log("user not found"); return; }

  // 8:18 AM IST = 02:48 UTC on the same IST day.
  // istTodayDateOnly() returns 00:00 UTC for today's IST date, so add 2h 48m.
  const clockInAt = new Date(today.getTime() + (2 * 60 + 48) * 60_000);

  const rec = await p.attendance.findUnique({
    where: { userId_date: { userId: user.id, date: today } },
  });
  if (!rec) { console.log("no attendance row today"); return; }

  const updated = await p.attendance.update({
    where: { id: rec.id },
    data:  { clockIn: clockInAt },
  });

  console.log(`✓ Updated ${user.name}'s clock-in to ${clockInAt.toISOString()} (8:18 AM IST).`);
  console.log({ id: updated.id, clockIn: updated.clockIn, status: updated.status });
}

main().catch(console.error).finally(() => p.$disconnect());
