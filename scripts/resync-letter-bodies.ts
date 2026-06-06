// Force-resync the bodyHtml of every LetterTemplate row from the
// latest LETTER_TEMPLATE_SEEDS. Run when the seeds change (e.g.
// when we drop the duplicate letterhead / title from the body and
// the wrapper now provides them).
//
//   npx tsx scripts/resync-letter-bodies.ts            # dry-run
//   npx tsx scripts/resync-letter-bodies.ts --confirm  # actually overwrite
//
// This DOES blow away any HR edits made through the template
// editor on the rows it overwrites. Use sparingly.

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import prisma from "../src/lib/prisma";
import { LETTER_TEMPLATE_SEEDS } from "../src/lib/hr/letter-template-seeds";
import { sanitizeLetterHtml } from "../src/lib/hr/letter-render";

const CONFIRM = process.argv.includes("--confirm");

async function main() {
  console.log(`${CONFIRM ? "[OVERWRITE]" : "[DRY RUN]"} Resyncing ${LETTER_TEMPLATE_SEEDS.length} seeds…\n`);
  let updated = 0, missing = 0, noChange = 0;
  for (const t of LETTER_TEMPLATE_SEEDS) {
    const brand = t.businessUnit ?? "NB Media";
    const existing = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, "bodyHtml", "customFields" FROM "LetterTemplate" WHERE key = $1 AND "businessUnit" = $2 LIMIT 1`,
      t.key, brand,
    );
    if (!existing[0]) {
      const cleanBody = sanitizeLetterHtml(t.bodyHtml);
      const newFields = JSON.stringify(t.customFields ?? []);
      console.log(`  INSERT   ${t.key} (${brand}) — new template seed`);
      if (CONFIRM) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "LetterTemplate"
             (key, title, category, "businessUnit", "bodyHtml", "customFields", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW())`,
          t.key, t.title, t.category, brand, cleanBody, newFields,
        );
        updated++;
      } else {
        missing++;
      }
      continue;
    }
    const row = existing[0];
    const cleanBody = sanitizeLetterHtml(t.bodyHtml);
    const newFields = JSON.stringify(t.customFields ?? []);
    const oldFields = JSON.stringify(row.customFields ?? []);
    const bodyChanged   = row.bodyHtml !== cleanBody;
    const fieldsChanged = oldFields !== newFields;
    if (!bodyChanged && !fieldsChanged) {
      console.log(`  =        ${t.key} (${brand})  #${row.id}  already matches`);
      noChange++;
      continue;
    }
    const parts: string[] = [];
    if (bodyChanged)   parts.push(`body ${row.bodyHtml.length}→${cleanBody.length}`);
    if (fieldsChanged) parts.push(`fields ${oldFields.length}→${newFields.length}`);
    console.log(`  UPDATE   ${t.key} (${brand})  #${row.id}  ${parts.join(" + ")}`);
    if (CONFIRM) {
      await prisma.$executeRawUnsafe(
        `UPDATE "LetterTemplate"
            SET "bodyHtml"      = $1,
                "customFields"  = $2::jsonb,
                "updatedAt"     = NOW()
          WHERE id = $3`,
        cleanBody, newFields, row.id,
      );
      updated++;
    }
  }
  console.log(`\nUpdated=${updated}  No-change=${noChange}  Missing=${missing}`);
  if (!CONFIRM) console.log(`\nDry-run only. Re-run with --confirm to overwrite.`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect().catch(()=>{}));
