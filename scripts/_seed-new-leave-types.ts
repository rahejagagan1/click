// One-shot: ensures "Casual Leave" (CL) and "Carry Over Leave" (CO)
// exist in the LeaveType table. Idempotent — safe to re-run.
//
//   • Casual Leave        → applicable, daysPerYear=0 (HR sets per
//                           employee via the leave-balances grid).
//   • Carry Over Leave    → balance-only (applicable=false), daysPerYear=0.
//                           Old employees keep whatever balance HR
//                           manually set; new employees see 0/0.
//                           Encashment / payout happens at exit.
//
// Run:  npx tsx scripts/_seed-new-leave-types.ts
// Add `--dry` to preview without writing.

import { PrismaClient } from "@prisma/client";

type SeedRow = {
  name: string;
  code: string;
  daysPerYear: number;
  applicable: boolean;
  carryForward: boolean;
  isPaid: boolean;
};

const ROWS: SeedRow[] = [
  { name: "Casual Leave",     code: "CL", daysPerYear: 0, applicable: true,  carryForward: false, isPaid: true },
  { name: "Carry Over Leave", code: "CO", daysPerYear: 0, applicable: false, carryForward: true,  isPaid: true },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const isDry = process.argv.includes("--dry");
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    // Postgres auto-increment sequence drift can leave the next-value
    // pointing at an already-used id (happens after raw SQL inserts /
    // backup restores). Resync the sequence to MAX(id) before any
    // insert so the .create() call lands on a free slot.
    try {
      await prisma.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('"LeaveType"', 'id'), (SELECT COALESCE(MAX(id), 1) FROM "LeaveType"))`,
      );
    } catch (e) {
      console.warn("[warn] Could not resync LeaveType id sequence — continuing anyway:", e);
    }

    let created = 0, updated = 0, kept = 0;
    for (const r of ROWS) {
      const existing = await prisma.leaveType.findUnique({ where: { code: r.code } });
      if (existing) {
        const needsPatch =
          existing.applicable !== r.applicable ||
          existing.isActive   !== true;
        if (needsPatch) {
          if (isDry) {
            console.log(`[dry] Would patch ${r.code}: applicable=${r.applicable} isActive=true`);
          } else {
            await prisma.leaveType.update({
              where: { code: r.code },
              data:  { applicable: r.applicable, isActive: true },
            });
            console.log(`✓ Patched ${r.code}: applicable=${r.applicable} isActive=true`);
            updated++;
          }
        } else {
          console.log(`· ${r.code} already correct — skipping.`);
          kept++;
        }
      } else {
        if (isDry) {
          console.log(`[dry] Would create ${r.code} '${r.name}' (applicable=${r.applicable})`);
        } else {
          await prisma.leaveType.create({ data: { ...r, isActive: true } });
          console.log(`✓ Created ${r.code} '${r.name}' (applicable=${r.applicable})`);
          created++;
        }
      }
    }
    if (!isDry) console.log(`\nSummary: ${created} created, ${updated} patched, ${kept} unchanged.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
