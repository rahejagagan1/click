/**
 * Read-only diagnostic: dump attendance + per-session geo for
 * arpitsharma4602@gmail.com so we can see what the DB actually
 * has vs what the UI is showing.
 *
 * Run with:  npx tsx scripts/_check-arpit-attendance.ts
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const TARGET_EMAIL = "arpitsharma4602@gmail.com";

function fmt(d: Date | null | undefined) {
  if (!d) return "—";
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

async function main() {
  const user = await p.user.findFirst({
    where: { email: { equals: TARGET_EMAIL, mode: "insensitive" } },
    select: { id: true, name: true, email: true },
  });
  if (!user) { console.log(`✗ No user with email ${TARGET_EMAIL}`); return; }
  console.log(`User: ${user.name} <${user.email}> (id ${user.id})`);
  console.log("─".repeat(80));

  const recent = await p.attendance.findMany({
    where: { userId: user.id },
    orderBy: { date: "desc" },
    take: 14,
  });

  if (!recent.length) { console.log("(no attendance rows)"); return; }

  type Sess = {
    id: number; attendanceId: number;
    clockIn: Date; clockOut: Date | null;
    clockInLocation: string | null; clockOutLocation: string | null;
  };

  const ids = recent.map((r) => r.id);
  const sessions = await p.$queryRawUnsafe<Sess[]>(
    `SELECT id, "attendanceId", "clockIn", "clockOut", "clockInLocation", "clockOutLocation"
       FROM "AttendanceSession"
      WHERE "attendanceId" = ANY($1::int[])
      ORDER BY "clockIn" ASC`,
    ids,
  );
  const byAttendance = new Map<number, Sess[]>();
  for (const s of sessions) {
    if (!byAttendance.has(s.attendanceId)) byAttendance.set(s.attendanceId, []);
    byAttendance.get(s.attendanceId)!.push(s);
  }

  for (const r of recent) {
    const dateStr = r.date.toISOString().slice(0, 10);
    console.log(`\n📅 ${dateStr}  status=${r.status}  totalMinutes=${r.totalMinutes}  overtimeMinutes=${r.overtimeMinutes}`);
    console.log(`   parent.clockIn  = ${fmt(r.clockIn)}`);
    console.log(`   parent.clockOut = ${fmt(r.clockOut)}`);
    console.log(`   parent.location = ${r.location ?? "(null)"}`);
    const ss = byAttendance.get(r.id) ?? [];
    if (!ss.length) { console.log("   sessions: (none)"); continue; }
    ss.forEach((s, i) => {
      console.log(`   session #${i + 1} (id ${s.id})`);
      console.log(`      in  = ${fmt(s.clockIn)}    location = ${s.clockInLocation ?? "(null)"}`);
      console.log(`      out = ${fmt(s.clockOut)}   location = ${s.clockOutLocation ?? "(null)"}`);
    });
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => p.$disconnect());
