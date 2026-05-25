// Office geofencing — compute whether a clock-in's coordinates fall
// inside the office radius so HR sees a reliable "At Office" badge
// instead of relying on Nominatim's sometimes-wrong sector label.
//
// Config lives in env vars so HR can adjust without a deploy:
//
//   OFFICE_LAT       — office latitude  (e.g. "30.7100")
//   OFFICE_LNG       — office longitude (e.g. "76.7077")
//   OFFICE_RADIUS_M  — radius in meters (default 100)
//
// When OFFICE_LAT or OFFICE_LNG isn't set, every clock-in is treated
// as "unknown" (not at office, not off-site) — the badge silently
// disables so we don't render misleading info before the office is
// configured.

const OFFICE_LAT_RAW    = process.env.OFFICE_LAT;
const OFFICE_LNG_RAW    = process.env.OFFICE_LNG;
const OFFICE_RADIUS_RAW = process.env.OFFICE_RADIUS_M;

const OFFICE_LAT = OFFICE_LAT_RAW ? Number(OFFICE_LAT_RAW) : null;
const OFFICE_LNG = OFFICE_LNG_RAW ? Number(OFFICE_LNG_RAW) : null;
const OFFICE_RADIUS_M = OFFICE_RADIUS_RAW && Number.isFinite(Number(OFFICE_RADIUS_RAW))
  ? Number(OFFICE_RADIUS_RAW)
  : 100;

/** True when the office is fully configured (lat + lng both present + finite). */
export function isGeofenceConfigured(): boolean {
  return OFFICE_LAT !== null && OFFICE_LNG !== null
    && Number.isFinite(OFFICE_LAT) && Number.isFinite(OFFICE_LNG);
}

/** Haversine distance in meters between two lat/lng pairs. */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000; // earth radius in meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type GeofenceResult = {
  /** Whether the office is configured at all. False → atOffice/distance are undefined. */
  configured: boolean;
  /** Distance from office in meters, rounded to whole metres. Undefined when not configured. */
  distanceM?: number;
  /** True when distanceM ≤ OFFICE_RADIUS_M. Undefined when not configured. */
  atOffice?: boolean;
  /** Configured radius (so the UI can show "within 100 m" / "200 m away"). */
  radiusM: number;
};

/**
 * Compute the office-geofence result for a single coordinate pair.
 * Returns `configured: false` when env vars aren't set so the caller
 * can render a neutral state instead of a misleading "off-site" badge.
 */
export function evaluateOfficeGeofence(lat: number | null | undefined, lng: number | null | undefined): GeofenceResult {
  if (!isGeofenceConfigured() || typeof lat !== "number" || typeof lng !== "number"
      || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { configured: false, radiusM: OFFICE_RADIUS_M };
  }
  const dist = haversineMeters(OFFICE_LAT!, OFFICE_LNG!, lat, lng);
  return {
    configured: true,
    distanceM: Math.round(dist),
    atOffice: dist <= OFFICE_RADIUS_M,
    radiusM: OFFICE_RADIUS_M,
  };
}
