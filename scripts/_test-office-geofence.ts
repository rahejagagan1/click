/**
 * Sanity-tests for the office-geofence helper.
 *
 *   npx tsx scripts/_test-office-geofence.ts
 *
 * Env vars are set BEFORE the dynamic import so the module reads the
 * test values rather than whatever .env shipped. The geofence module
 * reads env vars at module-load time and caches them, so static
 * imports up top wouldn't see these mutations in ESM mode.
 */
// `export {}` makes this file a module so its top-level `type` / `const`
// declarations don't collide with the other test scripts in the same
// TypeScript project.
export {};

process.env.OFFICE_LAT = "30.705699476505067";
process.env.OFFICE_LNG = "76.68554358640502";
process.env.OFFICE_RADIUS_M = "100";

type Status = "PASS" | "FAIL";
const results: { name: string; status: Status; evidence: string }[] = [];
const expect = (cond: boolean): Status => (cond ? "PASS" : "FAIL");
const rec = (name: string, status: Status, evidence: string) => results.push({ name, status, evidence });

async function main() {
  const { evaluateOfficeGeofence, isGeofenceConfigured } = await import("../src/lib/office-geofence");

  console.log(`╔════════════════════════════════════════════════════════════╗`);
  console.log(`║ Office geofence sanity tests                                ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝`);

  rec("Geofence reports configured", expect(isGeofenceConfigured()), `isGeofenceConfigured()=${isGeofenceConfigured()}`);

  // Exact office → atOffice=true, distance ≈ 0.
  const exact = evaluateOfficeGeofence(30.705699476505067, 76.68554358640502);
  rec("Exact office → atOffice=true + distance≈0", expect(exact.atOffice === true && (exact.distanceM ?? 99) <= 1), JSON.stringify(exact));

  // ~50m north → still atOffice.
  const near = evaluateOfficeGeofence(30.706149, 76.685543);
  rec("~50m away → atOffice=true (within 100m radius)", expect(near.atOffice === true && (near.distanceM ?? 0) >= 30 && (near.distanceM ?? 0) <= 70), JSON.stringify(near));

  // ~150m north → off-site.
  const offNear = evaluateOfficeGeofence(30.707049, 76.685543);
  rec("~150m away → atOffice=false (outside 100m radius)", expect(offNear.atOffice === false && (offNear.distanceM ?? 0) >= 100), JSON.stringify(offNear));

  // Different city → very far + off-site.
  const farCity = evaluateOfficeGeofence(28.61, 77.21);
  rec("Different city → atOffice=false + distance > 100km", expect(farCity.atOffice === false && (farCity.distanceM ?? 0) > 100_000), JSON.stringify(farCity));

  // Null inputs → configured=false-ish (atOffice undefined).
  const nullLat = evaluateOfficeGeofence(null as any, 76.68);
  rec("Null lat → atOffice undefined", expect(nullLat.atOffice === undefined && nullLat.configured === false), JSON.stringify(nullLat));

  // Radius respected (still configured, just outside).
  rec("Configured radius reported as 100m", expect(exact.radiusM === 100), `radiusM=${exact.radiusM}`);

  console.log("");
  for (const r of results) {
    const icon = r.status === "PASS" ? "✓" : "✗";
    console.log(`  [${icon} ${r.status}] ${r.name}`);
    console.log(`           ${r.evidence}`);
  }
  const pass = results.filter(r => r.status === "PASS").length;
  const fail = results.filter(r => r.status === "FAIL").length;
  console.log(``);
  console.log(`── Summary ──────────────────────────────────────────────────`);
  console.log(`  ${pass} PASS   ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
