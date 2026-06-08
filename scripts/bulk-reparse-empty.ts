// Bulk re-parse every JobApplication with empty / missing
// education or skills. Uses the same extractResumeData() pipeline
// (heuristic → OCR → LLM) so it picks up everything that has
// gone in since the last run.
//
// Usage on the VPS:
//   npx tsx scripts/bulk-reparse-empty.ts                # dry-run
//   npx tsx scripts/bulk-reparse-empty.ts --write        # actually write
//   npx tsx scripts/bulk-reparse-empty.ts --write --max=5  # cap to first N
//
// Safe to re-run — only touches rows whose extracted data is
// currently null / empty / garbled. Never overwrites HR-edited
// values that already have content.

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import prisma from "../src/lib/prisma";
import { extractResumeData } from "../src/lib/resume-auto-extract";

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const maxArg = args.find((a) => a.startsWith("--max="));
const MAX = maxArg ? Math.max(1, Number(maxArg.split("=")[1] || 0)) : 0;

type Row = {
  id: number;
  fullName: string;
  resumeFileName: string | null;
  resumeBlob: Buffer | null;
  educationDetails: string | null;
  skills: string | null;
};

function parseEdu(raw: string | null): any[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}

function eduLooksUsable(edu: any[]): boolean {
  if (edu.length === 0) return false;
  // At least one entry needs course + university for "usable"
  return edu.some((e: any) =>
    !!(e?.course || e?.branch) && !!(e?.university || e?.location));
}

function summarise(arr: any[]): string {
  if (!Array.isArray(arr) || arr.length === 0) return "(none)";
  return arr.map((e: any) => {
    const c = e.course ?? "—";
    const u = e.university ?? "—";
    const start = e.startOfCourse ?? "";
    const end   = e.endOfCourse   ?? "";
    return `${String(c).slice(0, 26)} @ ${String(u).slice(0, 28)} (${[start, end].filter(Boolean).join(" – ")})`;
  }).join("\n              ");
}

async function main() {
  // Pull every applicant. Filter client-side because the "garbled"
  // check is too complex for SQL.
  const all = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT id, "fullName", "resumeFileName", "resumeBlob",
            "educationDetails", "skills"
       FROM "JobApplication"
       WHERE "resumeBlob" IS NOT NULL
       ORDER BY id ASC`,
  );
  const candidates = all.filter((r) => {
    const edu = parseEdu(r.educationDetails);
    return !eduLooksUsable(edu) || !r.skills || r.skills.trim() === "";
  });

  if (candidates.length === 0) {
    console.log("Every applicant has usable education + skills. Nothing to do.");
    return;
  }
  console.log(`${WRITE ? "[WRITE]" : "[DRY-RUN]"} ${candidates.length} applicant(s) need a re-parse${MAX ? ` (capping to first ${MAX})` : ""}.\n`);

  const work = MAX ? candidates.slice(0, MAX) : candidates;
  let ok = 0, noChange = 0, failed = 0, eduWritten = 0, skillsWritten = 0;

  for (const r of work) {
    const before = parseEdu(r.educationDetails);
    console.log(`── #${r.id} ${r.fullName} ──`);
    console.log(`  resume:    ${r.resumeFileName ?? "(unnamed)"}  ${r.resumeBlob ? (r.resumeBlob.length / 1024).toFixed(1) + " KB" : "(no blob)"}`);
    console.log(`  BEFORE:    edu=${before.length}${before.length ? "\n              " + summarise(before) : ""}    skills=${r.skills ? "yes" : "(empty)"}`);
    if (!r.resumeBlob) { console.log(`  ⚠ no blob — skip\n`); continue; }
    const t0 = Date.now();
    let parsed: any;
    try {
      parsed = await extractResumeData(Buffer.from(r.resumeBlob), r.resumeFileName ?? "resume.pdf");
    } catch (e: any) {
      failed++;
      console.log(`  ✗ extract failed: ${e?.message ?? e}\n`);
      continue;
    }
    const newEdu: any[] = parsed?.educations ?? [];
    const newSkills: string[] = Array.isArray(parsed?.skills) ? parsed.skills : [];
    console.log(`  AFTER:     edu=${newEdu.length}${newEdu.length ? "\n              " + summarise(newEdu) : ""}    skills=${newSkills.length}  (${Date.now() - t0}ms)`);

    const willWriteEdu    = !eduLooksUsable(before) && newEdu.length > 0;
    const willWriteSkills = (!r.skills || r.skills.trim() === "") && newSkills.length > 0;

    if (!willWriteEdu && !willWriteSkills) {
      noChange++;
      console.log(`  · no improvement, DB unchanged\n`);
      continue;
    }
    if (WRITE) {
      const sets: string[] = [];
      const params: any[] = [];
      if (willWriteEdu)    { params.push(JSON.stringify(newEdu));   sets.push(`"educationDetails" = $${params.length}`); }
      if (willWriteSkills) { params.push(newSkills.join(", "));     sets.push(`"skills" = $${params.length}`); }
      params.push(r.id);
      await prisma.$executeRawUnsafe(
        `UPDATE "JobApplication" SET ${sets.join(", ")}, "updatedAt" = NOW() WHERE id = $${params.length}`,
        ...params,
      );
      ok++;
      if (willWriteEdu)    eduWritten++;
      if (willWriteSkills) skillsWritten++;
      console.log(`  ✓ wrote ${willWriteEdu ? newEdu.length + " edu" : ""}${willWriteEdu && willWriteSkills ? " + " : ""}${willWriteSkills ? newSkills.length + " skills" : ""}\n`);
    } else {
      console.log(`  (would write)\n`);
    }
  }

  console.log("══ Summary ══");
  console.log(`  Processed:           ${work.length}`);
  console.log(`  Updated:             ${ok}`);
  console.log(`  No improvement:      ${noChange}`);
  console.log(`  Failed:              ${failed}`);
  console.log(`  Education writes:    ${eduWritten}`);
  console.log(`  Skills writes:       ${skillsWritten}`);
  if (!WRITE) console.log(`\nDry-run only. Re-run with --write to apply.`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect().catch(() => {}));
