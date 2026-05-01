// Extends EmployeeProfile with the columns that were on the
// onboarding wizard but had no place to land — so HR can edit and
// cross-check every field on the existing profile, not just the
// subset that happened to have a column.
//
// Idempotent — safe to re-run on dev + VPS.
//
// Run:  npx tsx scripts/_init-extended-profile-fields.ts

import { PrismaClient } from "@prisma/client";

const COLUMNS: Array<[string, string]> = [
  // Step 1 (Basic) — workCountry / nationality already exist; nothing here.
  // Step 2 (Job)
  ["secondaryJobTitle",  `TEXT`],
  ["legalEntity",        `TEXT`],
  ["jobLocation",        `TEXT`],          // city-level (Mohali / Delhi / …) — distinct from workLocation (office/remote/hybrid)
  ["probationPolicy",    `TEXT`],
  ["internshipEndDate",  `TIMESTAMP(3)`],
  // Step 3 (Work)
  ["leavePlan",          `TEXT`],
  ["holidayList",        `TEXT`],
  ["weeklyOff",          `TEXT`],
  ["attendanceNumber",   `TEXT`],
  ["timeTrackingPolicy", `TEXT`],
  ["penalizationPolicy", `TEXT`],
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    for (const [name, type] of COLUMNS) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "${name}" ${type};`,
      );
      console.log(`✓ EmployeeProfile.${name} (${type}) ready.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
