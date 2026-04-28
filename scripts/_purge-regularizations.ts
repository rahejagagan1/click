/**
 * One-off: delete every AttendanceRegularization row for Arpit + Gagan.
 * Run with:  npx tsx scripts/_purge-regularizations.ts
 *
 * Destructive — only intended for dev / test data cleanup.
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const users = await p.user.findMany({
    where: {
      OR: [
        { email: { contains: "arpit", mode: "insensitive" } },
        { email: { contains: "gagan", mode: "insensitive" } },
        { email: "rahejagagan1@gmail.com" },
        { email: "arpitsharma4602@gmail.com" },
        { email: "arpit@nbmediaproductions.com" },
        { name:  { contains: "Arpit", mode: "insensitive" } },
        { name:  { contains: "Gagan", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true },
  });

  if (users.length === 0) {
    console.log("No matching users found.");
    return;
  }

  console.log("Matched users:");
  for (const u of users) console.log(`  • ${u.id} — ${u.name} (${u.email})`);

  const userIds = users.map((u) => u.id);

  // Pre-count for the report.
  const existing = await p.attendanceRegularization.count({ where: { userId: { in: userIds } } });
  console.log(`\nFound ${existing} regularization row(s) across these users.`);

  if (existing === 0) {
    console.log("Nothing to delete.");
    return;
  }

  const result = await p.attendanceRegularization.deleteMany({
    where: { userId: { in: userIds } },
  });

  console.log(`\n✅ Deleted ${result.count} regularization row(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => p.$disconnect());
