// Debug helper — runs the same filter logic as
// sendMissedClockInReminders() but prints WHY each active user
// would or wouldn't be emailed. No email is actually sent.
//
// Use this when users are reporting incorrect reminders. The
// printout shows for each candidate:
//   • what `today` resolved to (UTC + IST)
//   • whether they have an Attendance row with clockIn set today
//   • whether they have approved leave / WFH / OD today
//   • the row-level decision (would-skip / would-email)
//
// Run:  npx tsx scripts/_debug-clockin-reminder.ts
//       npx tsx scripts/_debug-clockin-reminder.ts --emails=a@x.com,b@y.com   # only inspect listed users

import { PrismaClient } from "@prisma/client";

function istTodayDateOnly(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === "year")!.value;
  const m = parts.find(p => p.type === "month")!.value;
  const d = parts.find(p => p.type === "day")!.value;
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const onlyEmails = process.argv.find((a) => a.startsWith("--emails="))?.slice(9)
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) ?? null;

  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const today = istTodayDateOnly();
    const now   = new Date();
    console.log("Server now (UTC):", now.toISOString());
    console.log("Server tz offset (min from UTC):", now.getTimezoneOffset());
    console.log("today (IST date as UTC midnight):", today.toISOString());
    console.log("");

    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { email: "asc" },
    });

    const [todays, leaves, wfh, onDuty, holidayHit] = await Promise.all([
      prisma.attendance.findMany({
        where: { date: today, clockIn: { not: null } },
        select: { userId: true, clockIn: true, clockOut: true, date: true },
      }),
      prisma.leaveApplication.findMany({
        where: { status: "approved", fromDate: { lte: today }, toDate: { gte: today } },
        select: { userId: true },
      }),
      prisma.wFHRequest.findMany({
        where: { status: "approved", date: today },
        select: { userId: true },
      }),
      prisma.onDutyRequest.findMany({
        where: { status: "approved", date: today },
        select: { userId: true },
      }),
      prisma.holidayCalendar.findFirst({ where: { date: today }, select: { id: true } }),
    ]);

    console.log("Active users:               ", users.length);
    console.log("Attendance rows for today:  ", todays.length);
    console.log("  (each: userId / clockIn / clockOut / row.date)");
    for (const a of todays.slice(0, 5)) {
      console.log(
        `    user=${a.userId}  clockIn=${a.clockIn?.toISOString() ?? "null"}  clockOut=${a.clockOut?.toISOString() ?? "null"}  date=${a.date.toISOString()}`,
      );
    }
    if (todays.length > 5) console.log(`    ... +${todays.length - 5} more`);
    console.log("Approved leaves today:      ", leaves.length);
    console.log("Approved WFH today:         ", wfh.length);
    console.log("Approved on-duty today:     ", onDuty.length);
    console.log("Holiday today?              ", holidayHit ? "yes" : "no");
    console.log("");

    if (holidayHit) {
      console.log("🎉 Holiday — sendMissedClockInReminders() would short-circuit and send 0 emails.");
      return;
    }

    const clockedInIds = new Set(todays.map(a => a.userId));
    const onLeaveIds   = new Set(leaves.map(l => l.userId));
    const onWfhIds     = new Set(wfh.map(w => w.userId));
    const onDutyIds    = new Set(onDuty.map(o => o.userId));

    const filtered = onlyEmails
      ? users.filter((u) => u.email && onlyEmails.includes(u.email.toLowerCase()))
      : users;

    let wouldSend = 0;
    for (const u of filtered) {
      const reasons: string[] = [];
      if (clockedInIds.has(u.id))   reasons.push("clocked in");
      if (onLeaveIds.has(u.id))     reasons.push("on leave");
      if (onWfhIds.has(u.id))       reasons.push("WFH approved");
      if (onDutyIds.has(u.id))      reasons.push("on duty");
      if (!u.email)                 reasons.push("no email");
      const decision = reasons.length === 0 ? "WOULD-EMAIL" : `skip (${reasons.join(", ")})`;
      if (reasons.length === 0) wouldSend++;
      console.log(
        `  ${decision.padEnd(40)} ${(u.email || "(no email)").padEnd(40)} id=${u.id} ${u.name}`,
      );
    }
    console.log("");
    console.log(`Total would-email this run: ${wouldSend}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
