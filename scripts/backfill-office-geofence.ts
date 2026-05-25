// `export {}` makes this file a module so its top-level declarations
// don't collide with the other scripts in this TypeScript project.
export {};

/**
 * One-shot back-fill: recomputes the office geofence (atOffice +
 * distanceFromOfficeM) for every Attendance row that has GPS coords
 * but is missing the geofence fields. Older punches predate the
 * feature — running this once paints the badge / mismatch banner for
 * the existing history.
 *
 * Usage:
 *   1. Make sure OFFICE_LAT, OFFICE_LNG (+ optional OFFICE_RADIUS_M)
 *      are set in the env (.env on dev, PM2 ecosystem on prod).
 *   2. npx tsx scripts/backfill-office-geofence.ts            (dry-run)
 *      npx tsx scripts/backfill-office-geofence.ts --apply    (write)
 *
 * Dry-run prints exactly what would change without touching the DB,
 * so you can sanity-check the count + a few sample rows before
 * committing to the rewrite. AttendanceSession rows are NOT touched
 * — they don't carry their own location blob; geofence lives on the
 * parent Attendance row.
 */
import { PrismaClient } from "@prisma/client";
import { evaluateOfficeGeofence, isGeofenceConfigured } from "../src/lib/office-geofence";
import { parseAttLoc, stringifyAttLoc } from "../src/lib/attendance-location";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

async function main() {
  if (!isGeofenceConfigured()) {
    console.error("✗ OFFICE_LAT / OFFICE_LNG not configured in env. Aborting.");
    process.exit(1);
  }
  console.log(`Mode: ${APPLY ? "APPLY (writing changes)" : "DRY-RUN (read-only)"}`);
  console.log(``);

  // Find every Attendance row with a location blob — we'll filter
  // further in-memory because location is plain TEXT and Prisma can't
  // JSON-introspect it.
  const rows = await prisma.attendance.findMany({
    where: { location: { not: null } },
    select: { id: true, userId: true, date: true, location: true },
  });

  let withCoords = 0;
  let alreadyTagged = 0;
  let toUpdate = 0;
  let atOfficeCount = 0;
  let offSiteCount = 0;
  const samples: string[] = [];

  for (const r of rows) {
    const loc = parseAttLoc(r.location);
    if (typeof loc.lat !== "number" || typeof loc.lng !== "number") continue;
    withCoords++;

    // Already has the geofence fields — skip.
    if (typeof loc.atOffice === "boolean" && typeof loc.distanceFromOfficeM === "number") {
      alreadyTagged++;
      continue;
    }

    const geo = evaluateOfficeGeofence(loc.lat, loc.lng);
    if (!geo.configured) continue;

    toUpdate++;
    if (geo.atOffice) atOfficeCount++;
    else offSiteCount++;

    if (samples.length < 5) {
      const dateStr = r.date.toISOString().slice(0, 10);
      samples.push(
        `  • userId=${r.userId} date=${dateStr} ${geo.atOffice ? "AT OFFICE" : "OFF-SITE"} (${geo.distanceM} m)`,
      );
    }

    if (APPLY) {
      const merged = stringifyAttLoc({
        ...loc,
        atOffice:            geo.atOffice,
        distanceFromOfficeM: geo.distanceM,
      });
      await prisma.attendance.update({ where: { id: r.id }, data: { location: merged } });
    }
  }

  console.log(`── Stats ──────────────────────────────────────────────────`);
  console.log(`  Total Attendance rows with location blob : ${rows.length}`);
  console.log(`  Rows with GPS coords                     : ${withCoords}`);
  console.log(`  Already tagged (skipped)                 : ${alreadyTagged}`);
  console.log(`  Rows ${APPLY ? "updated" : "would update"}                  : ${toUpdate}`);
  console.log(`    └ at office (within radius)            : ${atOfficeCount}`);
  console.log(`    └ off-site (outside radius)            : ${offSiteCount}`);
  if (samples.length > 0) {
    console.log(``);
    console.log(`Sample rows:`);
    for (const s of samples) console.log(s);
  }
  console.log(``);
  if (!APPLY && toUpdate > 0) {
    console.log(`(Dry-run.) Re-run with --apply to write these ${toUpdate} updates to the DB.`);
  } else if (APPLY) {
    console.log(`✓ Applied. Refresh the HR Attendance Dashboard to see the new badges.`);
  } else {
    console.log(`✓ Nothing to do — all rows already tagged.`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
