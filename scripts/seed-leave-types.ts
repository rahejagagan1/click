// Seeds the standard leave types every Indian HR app needs.
// Safe to re-run — upserts by the unique `code` column.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Only the leave types the company actually offers — nothing extra.
const TYPES = [
  { code: "COMP", name: "Comp Offs",          daysPerYear: 0,  carryForward: false, isPaid: true  },
  { code: "FL",   name: "Floater Leave",      daysPerYear: 2,  carryForward: false, isPaid: true  },
  { code: "HD",   name: "Half Day",           daysPerYear: 0,  carryForward: false, isPaid: true  },
  { code: "LWP",  name: "Leave Without Pay",  daysPerYear: 0,  carryForward: false, isPaid: false },
  { code: "SL",   name: "Sick Leave",         daysPerYear: 12, carryForward: false, isPaid: true  },
  { code: "SPL",  name: "Special Paid Leave", daysPerYear: 0,  carryForward: false, isPaid: true  },
];

async function main() {
  // Drop any leave types that aren't in the approved list. Skips deletion if
  // the row is already referenced (balance / application rows) and logs it.
  const keepCodes = new Set(TYPES.map((t) => t.code));
  const existing  = await prisma.leaveType.findMany({ select: { id: true, code: true, name: true } });
  for (const row of existing) {
    if (keepCodes.has(row.code)) continue;
    try {
      await prisma.leaveType.delete({ where: { id: row.id } });
      console.log(`  - removed ${row.code} (${row.name})`);
    } catch (e: any) {
      if (e?.code === "P2003") {
        await prisma.leaveType.update({ where: { id: row.id }, data: { isActive: false } });
        console.log(`  ~ deactivated ${row.code} (${row.name}) — in use by balances / applications`);
      } else {
        throw e;
      }
    }
  }

  let created = 0, updated = 0;
  for (const t of TYPES) {
    const existing = await prisma.leaveType.findUnique({ where: { code: t.code } });
    if (existing) {
      await prisma.leaveType.update({
        where: { id: existing.id },
        data:  { name: t.name, daysPerYear: t.daysPerYear, carryForward: t.carryForward, isPaid: t.isPaid },
      });
      updated++;
    } else {
      await prisma.leaveType.create({
        data: {
          name: t.name,
          code: t.code,
          daysPerYear: t.daysPerYear,
          carryForward: t.carryForward,
          isPaid: t.isPaid,
          isActive: true,
        },
      });
      created++;
    }
  }
  console.log(`Seeded ${TYPES.length} leave types (${created} created, ${updated} updated).`);

  const total = await prisma.leaveType.count();
  console.log(`Total LeaveType rows now: ${total}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
