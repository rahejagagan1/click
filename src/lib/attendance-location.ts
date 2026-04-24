export type AttLoc = {
  mode: "remote" | "office" | null;
  lat?: number;
  lng?: number;
  address?: string;
};

export function stringifyAttLoc(loc: AttLoc): string {
  const out: Record<string, unknown> = {};
  if (loc.mode) out.mode = loc.mode;
  if (typeof loc.lat === "number" && isFinite(loc.lat)) out.lat = loc.lat;
  if (typeof loc.lng === "number" && isFinite(loc.lng)) out.lng = loc.lng;
  if (loc.address) out.address = loc.address;
  return JSON.stringify(out);
}

export function parseAttLoc(raw?: string | null): AttLoc {
  if (!raw) return { mode: null };
  const s = raw.trim();
  if (s.startsWith("{")) {
    try {
      const j = JSON.parse(s);
      return {
        mode: j.mode === "remote" || j.mode === "office" ? j.mode : null,
        lat: typeof j.lat === "number" ? j.lat : undefined,
        lng: typeof j.lng === "number" ? j.lng : undefined,
        address: typeof j.address === "string" ? j.address : undefined,
      };
    } catch {
      return { mode: null };
    }
  }
  // Legacy plain-string values: either "remote"/"office" or a free-text address.
  if (s === "remote" || s === "office") return { mode: s };
  return { mode: null, address: s };
}

export type GeoFailReason = "unsupported" | "denied" | "position_unavailable" | "timeout" | "unknown";
export type GeoResult =
  | { ok: true;  lat: number; lng: number; address?: string }
  | { ok: false; reason: GeoFailReason; message: string };

/**
 * Browser-only: request geolocation and best-effort reverse-geocode via Nominatim.
 * Returns a tagged result so callers can show the user WHY it failed instead of
 * a generic "location required" message.
 */
export async function captureClockInGeo(): Promise<GeoResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { ok: false, reason: "unsupported", message: "Your browser doesn't support geolocation." };
  }
  // Timeout raised to 20s — first-time location on Windows (which needs to
  // query Wi-Fi SSIDs / the location service) can legitimately take 10–15s.
  const pos = await new Promise<GeolocationPosition | GeolocationPositionError>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p),
      (e) => resolve(e),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 }
    );
  });
  if ("code" in pos) {
    const reason: GeoFailReason =
      pos.code === 1 ? "denied" :
      pos.code === 2 ? "position_unavailable" :
      pos.code === 3 ? "timeout" : "unknown";
    const message =
      reason === "denied"               ? "Location permission is blocked for this site. Click the lock icon in the address bar and allow Location." :
      reason === "position_unavailable" ? "Your device couldn't determine a location. On Windows, make sure Location services are ON in system settings." :
      reason === "timeout"              ? "Location request timed out. Check your Wi-Fi / GPS, then try again." :
                                          pos.message || "Unknown location error.";
    return { ok: false, reason, message };
  }
  const { latitude: lat, longitude: lng } = pos.coords;
  // Reverse-geocode is best-effort and time-boxed to 3s so a slow Nominatim
  // response can't block the clock-in.
  let address: string | undefined;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`,
      { headers: { "Accept": "application/json" }, signal: ctl.signal }
    );
    clearTimeout(t);
    if (r.ok) {
      const j = await r.json();
      const a = j?.address || {};
      address =
        [a.suburb || a.neighbourhood || a.road, a.city || a.town || a.village, a.state]
          .filter(Boolean).join(", ") || j?.display_name || undefined;
    }
  } catch { /* best-effort only — coords alone are enough */ }
  return { ok: true, lat, lng, address };
}
