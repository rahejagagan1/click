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

/**
 * Browser-only: request geolocation and best-effort reverse-geocode via Nominatim.
 * Never rejects — returns `{}` on denial/failure so clock-in can still proceed.
 */
export async function captureClockInGeo(): Promise<{ lat?: number; lng?: number; address?: string }> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return {};
  const pos = await new Promise<GeolocationPosition | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
  if (!pos) return {};
  const { latitude: lat, longitude: lng } = pos.coords;
  let address: string | undefined;
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`,
      { headers: { "Accept": "application/json" } }
    );
    if (r.ok) {
      const j = await r.json();
      const a = j?.address || {};
      address =
        [a.suburb || a.neighbourhood || a.road, a.city || a.town || a.village, a.state]
          .filter(Boolean).join(", ") || j?.display_name || undefined;
    }
  } catch { /* best-effort only */ }
  return { lat, lng, address };
}
