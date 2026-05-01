// One-shot backfill: applies the canonical roster (job title +
// inferred department) to every employee whose HRM employeeId appears
// below. Idempotent — safe to re-run; only writes when the stored
// value differs from the canonical one.
//
// Anchor is `EmployeeProfile.employeeId` (HRM###), NOT the user's
// name — names are unstable, employee codes are not.
//
// Run:  npx tsx scripts/_backfill-designations-2026-05.ts
//
// Add `--dry` to preview without writing.

import { PrismaClient } from "@prisma/client";

// HRM ID → designation. Sourced from the May-2026 roster the user
// provided. People whose row was blank in the roster are intentionally
// omitted here (we don't know the canonical title yet — leave as-is).
const DESIGNATIONS: Record<string, string> = {
  HRM2:   "Content Team Lead",
  HRM4:   "Sr. Video Editor",
  HRM5:   "Head - Quality Assurance",
  HRM12:  "Content Team Lead",
  HRM16:  "Content Team Lead",
  HRM18:  "Sr. Script Writer",
  HRM25:  "Content Team Lead",
  HRM32:  "Content Team Lead",
  HRM33:  "Sr. Video Editor",
  HRM35:  "Sr. Script Writer",
  HRM48:  "Associate Video Editor",
  HRM53:  "Associate Video Editor",
  HRM54:  "Associate Script Writer",
  HRM56:  "Sr. Video Editor",
  HRM58:  "Sr. Script Writer",   // roster said "Senior" — normalised to Sr. for the canonical list
  HRM59:  "Associate Script Writer",
  HRM63:  "Sr. Graphic Designer & Content Strategist",
  HRM69:  "Sr. Video Editor",
  HRM72:  "Script Quality Assurance Associate",
  HRM77:  "Associate Video Editor",
  HRM82:  "Sr. Content Researcher",
  HRM86:  "Sr. Video Editor",
  HRM88:  "Associate Video Editor",
  HRM91:  "Sr. Video Editor",    // roster said "Senior" — normalised to Sr.
  HRM92:  "Associate Script Writer",
  HRM94:  "Script Writer",
  HRM95:  "Associate Video Editor",
  HRM96:  "Associate Script Writer",
  HRM104: "Associate Video Editor",
  HRM105: "Sr. Content Researcher",
  HRM107: "Associate Graphic Designer",
  HRM110: "Content Researcher",
  HRM112: "Content Researcher",
  HRM113: "Content Review & Quality Associate",
  HRM115: "Associate Script Writer",
  HRM117: "Associate Video Editor",
  HRM121: "Video Editor and Spotify Content Strategist",
  HRM125: "Script Writer",
  HRM127: "Script Writer",
};

// Department is inferred from the title. Designation strings are stable;
// the mapping table keeps the inference in one place.
const DEPT_BY_TITLE: Record<string, string> = {
  "Sr. Video Editor":                          "Production",
  "Associate Video Editor":                    "Production",
  "Video Editor":                              "Production",
  "Video Editor and Spotify Content Strategist":"Production",
  "Sr. Script Writer":                         "Scripting",
  "Script Writer":                             "Scripting",
  "Associate Script Writer":                   "Scripting",
  "Content Team Lead":                         "Scripting",
  "Sr. Content Researcher":                    "Researcher",
  "Content Researcher":                        "Researcher",
  "Head - Quality Assurance":                  "QA",
  "Script Quality Assurance Associate":        "QA",
  "Content Review & Quality Associate":        "QA",
  "Sr. Graphic Designer & Content Strategist": "Design",
  "Associate Graphic Designer":                "Design",
  "Graphic Designer":                          "Design",
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const isDry = process.argv.includes("--dry");
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  let updated = 0;
  let skipped = 0;
  let missing: string[] = [];

  try {
    for (const [empId, designation] of Object.entries(DESIGNATIONS)) {
      const dept = DEPT_BY_TITLE[designation] ?? null;

      const profile = await prisma.employeeProfile.findUnique({
        where:  { employeeId: empId },
        select: { id: true, designation: true, department: true, userId: true },
      });
      if (!profile) {
        missing.push(empId);
        continue;
      }

      const needsTitle = profile.designation !== designation;
      const needsDept  = dept !== null && profile.department !== dept;

      if (!needsTitle && !needsDept) { skipped++; continue; }

      const data: Record<string, string> = {};
      if (needsTitle) data.designation = designation;
      if (needsDept)  data.department  = dept!;

      console.log(
        `${isDry ? "[dry] " : ""}${empId} → designation=${designation}` +
        (dept ? `, department=${dept}` : ""),
      );

      if (!isDry) {
        await prisma.employeeProfile.update({
          where: { id: profile.id },
          data,
        });
      }
      updated++;
    }

    console.log("");
    console.log(`✓ ${isDry ? "Would update" : "Updated"}: ${updated}`);
    console.log(`✓ Already canonical: ${skipped}`);
    if (missing.length > 0) {
      console.warn(`⚠ Missing employee profiles for ${missing.length} HRM IDs:`, missing.join(", "));
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
