// Deletes KpiDocument rows for departments that have been formally
// retired (the canonical list in src/lib/departments.ts no longer
// contains them). The PDF blob in storage isn't touched — only the
// DB row goes away, so the card stops surfacing on /dashboard/kpis.
//
// To restore: re-upload the PDF via /dashboard/kpis/manage and pick
// a current canonical dept name.
//
// Run:  npx tsx scripts/_delete-retired-kpi-docs.ts
// Add `--dry` to preview without writing.

import { PrismaClient } from "@prisma/client";

// Hand-maintained allowlist — only these labels get deleted. Anything
// else stays put (orphans-with-people on the KPI page surface so HR
// can fix the people first). Add to this list ONLY when you've fully
// retired a dept and want its lingering doc gone.
const RETIRED_DOC_DEPARTMENTS: string[] = [
  "GC Team",
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const isDry = process.argv.includes("--dry");
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: number; department: string; fileName: string }>>(
      `SELECT id, department, "fileName" FROM "KpiDocument" WHERE department = ANY($1::text[])`,
      RETIRED_DOC_DEPARTMENTS,
    );

    if (rows.length === 0) {
      console.log("No retired-dept KpiDocument rows found — nothing to delete.");
      return;
    }

    for (const r of rows) {
      console.log(`  · id=${r.id}  dept='${r.department}'  file='${r.fileName}'`);
    }

    if (isDry) {
      console.log(`\n[dry] Would delete ${rows.length} row(s).`);
      return;
    }

    const deleted = await prisma.$executeRawUnsafe(
      `DELETE FROM "KpiDocument" WHERE department = ANY($1::text[])`,
      RETIRED_DOC_DEPARTMENTS,
    );
    console.log(`\n✓ Deleted ${deleted} KpiDocument row(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
