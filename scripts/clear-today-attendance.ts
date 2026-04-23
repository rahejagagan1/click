// One-off: clear today's Attendance record for a single user by email.
// Usage:
//   npx tsx scripts/clear-today-attendance.ts <email>            # dry-run (prints what would be deleted)
//   npx tsx scripts/clear-today-attendance.ts <email> --apply    # actually deletes
// Only touches the Attendance row for today (IST). No other rows / tables.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function todayIstDateOnly(): Date {
  // Compute start-of-day in IST, return as a plain Date for the schema's @db.Date column.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === "year")!.value;
  const m = parts.find(p => p.type === "month")!.value;
  const d = parts.find(p => p.type === "day")!.value;
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
}

async function main() {
  const email = process.argv[2];
  const apply = process.argv.includes("--apply");
  const dateArgIdx = process.argv.findIndex(a => a === "--date");
  const dateOverride = dateArgIdx > -1 ? process.argv[dateArgIdx + 1] : undefined;
  if (!email) {
    console.error("Usage: npx tsx scripts/clear-today-attendance.ts <email> [--date YYYY-MM-DD] [--apply]");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true } });
  if (!user) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }

  const today = dateOverride
    ? new Date(`${dateOverride}T00:00:00.000Z`)
    : todayIstDateOnly();
  const rec = await prisma.attendance.findUnique({
    where: { userId_date: { userId: user.id, date: today } },
  });

  console.log(`User:  ${user.name} <${user.email}> (id=${user.id})`);
  console.log(`Today: ${today.toISOString().slice(0, 10)} (IST)`);
  if (!rec) {
    console.log("No attendance record for today — nothing to delete.");
    return;
  }
  console.log("Target record:", {
    id: rec.id,
    clockIn: rec.clockIn,
    clockOut: rec.clockOut,
    status: rec.status,
    totalMinutes: rec.totalMinutes,
    location: rec.location,
  });

  if (!apply) {
    console.log("\nDRY RUN — no changes made. Re-run with --apply to delete.");
    return;
  }

  await prisma.attendance.delete({ where: { id: rec.id } });
  console.log(`\n✓ Deleted attendance record id=${rec.id}.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
