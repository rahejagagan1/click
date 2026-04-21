// Backfill MonthlyRating rows for the current month + the previous N months
// by calling the unified calculator directly for each (month, role) pair.
//
// Usage:
//   npx tsx scripts/backfill-ratings.ts                # 4 months × every role (dry-run count only)
//   npx tsx scripts/backfill-ratings.ts --apply        # actually run calculations
//   npx tsx scripts/backfill-ratings.ts --apply --months 6
//
// Months param defaults to 4 (current + previous 3). Roles default to the full
// supported list. Admin-locked rows (isManualOverride) are preserved by the
// calculator — they won't be overwritten.

import { calculateAllRatings } from "../src/lib/ratings/unified-calculator";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ALL_ROLES = [
  "writer",
  "editor",
  "hr_manager",
  "researcher_manager",
  "production_manager",
  "researcher_foia",
  "researcher_rtc",
  "researcher_foia_pitching",
] as const;

function getMonthStarts(count: number, anchor = new Date()): Date[] {
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth();
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(y, m - i, 1)));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const monthsIdx = process.argv.findIndex((a) => a === "--months");
  const monthCount = monthsIdx > -1 ? parseInt(process.argv[monthsIdx + 1] || "4", 10) : 4;

  const monthStarts = getMonthStarts(monthCount);
  console.log(
    `Backfill plan — ${monthStarts.length} month(s) × ${ALL_ROLES.length} role(s) = ${monthStarts.length * ALL_ROLES.length} jobs`
  );
  for (const d of monthStarts) {
    console.log(`  • ${d.toISOString().slice(0, 7)}`);
  }
  console.log(`Roles: ${ALL_ROLES.join(", ")}\n`);

  if (!apply) {
    console.log("DRY RUN — re-run with --apply to execute calculations.");
    return;
  }

  let ok = 0, fail = 0;
  for (const month of monthStarts) {
    const period = month.toISOString().slice(0, 7);
    for (const role of ALL_ROLES) {
      process.stdout.write(`[${period}] ${role.padEnd(26)} … `);
      try {
        const result = await calculateAllRatings(role, month);
        console.log(
          `✓  ${result.count} rated, ${result.errors.length} errors, ${result.skippedManualLocks.length} locked`
        );
        ok++;
      } catch (e: any) {
        console.log(`✗  ${e.message || String(e)}`);
        fail++;
      }
    }
  }
  console.log(`\nDone. ${ok} ok, ${fail} failed.`);

  const total = await prisma.monthlyRating.count();
  console.log(`MonthlyRating rows now: ${total}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
