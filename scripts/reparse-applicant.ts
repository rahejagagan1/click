// Re-run the resume parser (incl. OCR fallback) for one or more
// applicants. Useful when a parse miss is detected — the parser
// keeps improving so a re-run on the latest code often picks up
// entries the original ingest missed.
//
// Usage:
//   npx tsx scripts/reparse-applicant.ts <id> [<id> …]              # dry-run
//   npx tsx scripts/reparse-applicant.ts --write <id> [<id> …]      # write back
//
// Writes the new extraction to JobApplication.educationDetails as a
// JSON-string (matches the column's stored shape — text-typed
// jsonb that holds a stringified array).

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import prisma from "../src/lib/prisma";
import { extractResumeData } from "../src/lib/resume-auto-extract";

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const ids = args.filter((a) => /^\d+$/.test(a)).map((a) => Number(a));
if (ids.length === 0) {
  console.error("Usage: npx tsx scripts/reparse-applicant.ts [--write] <id1> <id2> …");
  process.exit(1);
}

function preview(arr: any[]): string {
  if (!Array.isArray(arr) || arr.length === 0) return "(empty)";
  return arr.map((e: any, i: number) => {
    const c = e.course ?? e.degree ?? "—";
    const u = e.university ?? e.institution ?? "—";
    const start = e.startOfCourse ?? e.startYear ?? "";
    const end = e.endOfCourse ?? e.endYear ?? e.passingYear ?? "";
    const span = [start, end].filter(Boolean).join(" – ");
    return `\n    [${i}] ${String(c).slice(0, 36).padEnd(36)} @ ${String(u).slice(0, 36).padEnd(36)} ${span}`;
  }).join("");
}

async function main() {
  console.log(`${WRITE ? "[WRITE]" : "[DRY-RUN]"} Re-parsing ${ids.length} applicant(s)…\n`);
  for (const id of ids) {
    const r = (await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, "fullName", "resumeFileName", "resumeBlob", "educationDetails"
         FROM "JobApplication" WHERE id = $1`, id,
    ))[0];
    if (!r) { console.log(`#${id}  NOT FOUND`); continue; }
    console.log(`── #${r.id} ${r.fullName} ──`);

    // BEFORE
    let beforeArr: any[] = [];
    if (typeof r.educationDetails === "string") {
      try { beforeArr = JSON.parse(r.educationDetails); } catch { beforeArr = []; }
    } else if (Array.isArray(r.educationDetails)) beforeArr = r.educationDetails;
    console.log(`  BEFORE: ${beforeArr.length} entries${preview(beforeArr)}`);

    if (!r.resumeBlob) {
      console.log(`  ⚠ no resume blob, can't re-parse.\n`);
      continue;
    }

    const buf = Buffer.from(r.resumeBlob);
    const fileName = r.resumeFileName ?? "resume.pdf";
    const t0 = Date.now();
    let parsed: any;
    try {
      parsed = await extractResumeData(buf, fileName);
    } catch (e: any) {
      console.log(`  ✗ extractResumeData failed: ${e?.message ?? e}\n`);
      continue;
    }
    const elapsed = Date.now() - t0;
    const newArr: any[] = parsed?.educations ?? [];
    console.log(`  AFTER : ${newArr.length} entries (${elapsed}ms)${preview(newArr)}`);

    if (WRITE) {
      if (newArr.length === 0) {
        console.log(`  · skipped DB write (parser returned 0)\n`);
        continue;
      }
      // Column is text holding JSON — match the existing storage
      // shape so the CandidateDrawer's parseJsonList<T>() reads it.
      await prisma.$executeRawUnsafe(
        `UPDATE "JobApplication"
            SET "educationDetails" = $1,
                "updatedAt"        = NOW()
          WHERE id = $2`,
        JSON.stringify(newArr), r.id,
      );
      console.log(`  ✓ wrote ${newArr.length} entries to DB\n`);
    } else {
      console.log("");
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect().catch(() => {}));
