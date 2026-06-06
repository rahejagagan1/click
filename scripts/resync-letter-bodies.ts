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
      `SELECT id, "bodyHtml" FROM "LetterTemplate" WHERE key = $1 AND "businessUnit" = $2 LIMIT 1`,
      t.key, brand,
    );
    if (!existing[0]) {
      console.log(`  MISSING  ${t.key} (${brand}) — no row to update`);
      missing++;
      continue;
    }
    const row = existing[0];
    const cleanBody = sanitizeLetterHtml(t.bodyHtml);
    if (row.bodyHtml === cleanBody) {
      console.log(`  =        ${t.key} (${brand})  #${row.id}  already matches`);
      noChange++;
      continue;
    }
    console.log(`  UPDATE   ${t.key} (${brand})  #${row.id}  ${row.bodyHtml.length} → ${cleanBody.length} chars`);
    if (CONFIRM) {
      await prisma.$executeRawUnsafe(
        `UPDATE "LetterTemplate" SET "bodyHtml" = $1, "updatedAt" = NOW() WHERE id = $2`,
        cleanBody, row.id,
      );
      updated++;
    }
  }
  console.log(`\nUpdated=${updated}  No-change=${noChange}  Missing=${missing}`);
  if (!CONFIRM) console.log(`\nDry-run only. Re-run with --confirm to overwrite.`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect().catch(()=>{}));
