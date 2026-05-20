/**
 * Quick lookup: print every OnDutyRequest for a user (optionally on a
 * specific date). Read-only.
 *
 *   npx tsx scripts/_inspect-od.ts <email-or-name-fragment> [YYYY-MM-DD]
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

async function main() {
  const q = process.argv[2];
  const ymd = process.argv[3];
  if (!q) {
    console.error("Usage: npx tsx scripts/_inspect-od.ts <email-or-name-fragment> [YYYY-MM-DD]");
    process.exit(1);
  }

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: q, mode: "insensitive" } },
        { name:  { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true },
  });
  if (users.length === 0) {
    console.log(`No user matched "${q}".`);
    process.exit(0);
  }
  for (const u of users) {
    console.log(`\n== ${u.name} <${u.email}> (id=${u.id}) ==`);
    const where: any = { userId: u.id };
    if (ymd) where.date = parseYmd(ymd);
    const rows = await prisma.onDutyRequest.findMany({
      where,
      orderBy: { date: "desc" },
      take: 30,
      include: { approver: { select: { name: true } } },
    });
    if (rows.length === 0) {
      console.log("  (no OD requests)");
      continue;
    }
    for (const r of rows) {
      console.log(`  #${r.id}  date=${r.date.toISOString().slice(0,10)}  status=${r.status}`);
      console.log(`    purpose:      ${JSON.stringify(r.purpose)}`);
      console.log(`    location:     ${r.location ?? "(null)"}`);
      console.log(`    fromTime:     ${r.fromTime ? r.fromTime.toISOString() : "(null)"}`);
      console.log(`    toTime:       ${r.toTime   ? r.toTime.toISOString()   : "(null)"}`);
      console.log(`    approver:     ${r.approver?.name ?? "(none)"}`);
      console.log(`    approvalNote: ${JSON.stringify(r.approvalNote ?? "")}`);
      console.log(`    createdAt:    ${r.createdAt.toISOString()}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
