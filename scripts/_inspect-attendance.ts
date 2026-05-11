import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

function parseYmd(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

async function main() {
  const [, , email, ...days] = process.argv;
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true } });
  if (!u) { console.error(`✗ ${email} not found`); process.exit(1); }
  console.log(`User: ${u.name} (id=${u.id})`);
  for (const ymd of days) {
    const date = parseYmd(ymd);
    const att = await prisma.attendance.findUnique({
      where: { userId_date: { userId: u.id, date } },
      select: { id: true, date: true, clockIn: true, clockOut: true, totalMinutes: true, status: true, location: true },
    });
    console.log(`\n=== ${ymd} ===`);
    if (!att) { console.log(`  (no Attendance row)`); continue; }
    console.log(`  Attendance #${att.id}  status=${att.status}  totalMinutes=${att.totalMinutes}`);
    console.log(`  clockIn  = ${att.clockIn?.toISOString() ?? "(null)"}`);
    console.log(`  clockOut = ${att.clockOut?.toISOString() ?? "(null)"}`);
    console.log(`  location = ${att.location ?? "(null)"}`);
    const sessions = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, "clockIn", "clockOut", "clockInLocation", "clockOutLocation"
         FROM "AttendanceSession" WHERE "attendanceId" = $1 ORDER BY "clockIn" ASC`,
      att.id,
    );
    console.log(`  Sessions (${sessions.length}):`);
    sessions.forEach((s, i) => {
      console.log(`    [${i}] sess#${s.id} in=${s.clockIn.toISOString()} out=${s.clockOut?.toISOString() ?? "(null)"}`);
      console.log(`         clockInLocation  = ${s.clockInLocation ?? "(null)"}`);
      console.log(`         clockOutLocation = ${s.clockOutLocation ?? "(null)"}`);
    });
  }
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
