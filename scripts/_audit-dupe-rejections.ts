import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import prisma from "../src/lib/prisma";

async function main() {
  // Count rejection emails per applicant, regardless of which
  // templateKey was logged (auto-send uses 'candidate_rejection',
  // backfill used 'rejection').
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT a.id, a."fullName", a.email,
            count(c.id)::int AS sends,
            MIN(c."createdAt") AS first_send,
            MAX(c."createdAt") AS last_send
       FROM "JobApplication" a
       JOIN "CandidateActivity" c ON c."applicationId" = a.id
      WHERE c.kind = 'email_sent'
        AND (c.meta->>'templateKey' IN ('rejection', 'candidate_rejection'))
      GROUP BY a.id, a."fullName", a.email
      HAVING count(c.id) > 1
      ORDER BY count(c.id) DESC, a.id ASC`,
  );

  if (rows.length === 0) {
    console.log("No duplicates detected.");
    return;
  }
  console.log(`Found ${rows.length} applicant(s) with duplicate rejection emails:\n`);
  for (const r of rows) {
    const first = new Date(r.first_send).toISOString().slice(0, 19).replace("T", " ");
    const last  = new Date(r.last_send).toISOString().slice(0, 19).replace("T", " ");
    console.log(`  #${String(r.id).padStart(3)}  ${String(r.fullName).padEnd(22)}  ${String(r.email).padEnd(38)}  sends=${r.sends}  first=${first}  last=${last}`);
  }
  console.log(`\nTotal duplicate sends: ${rows.reduce((s: number, r: any) => s + (r.sends - 1), 0)}`);
}
main().catch(e => console.error(e)).finally(() => prisma.$disconnect().catch(() => {}));
