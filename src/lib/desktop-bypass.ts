// Helper used by every clock-in / clock-out fetch call so the URL
// bypass works end-to-end: when the page URL contains `?desktop=1`,
// the request adds `x-desktop-bypass: 1` and the server-side mobile
// check in src/app/api/hr/attendance/clock-{in,out}/route.ts honors it.
//
// Returns an empty object on the server (SSR) and an empty object
// when the bypass param isn't set, so it's safe to spread into any
// fetch headers blob unconditionally.

export function desktopBypassHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const ok = new URLSearchParams(window.location.search).get("desktop") === "1";
    return ok ? { "x-desktop-bypass": "1" } : {};
  } catch {
    return {};
  }
}

// Server-side check — mirrors the client header. Returns true when the
// caller explicitly opted into the desktop bypass via the header.
export function hasDesktopBypassHeader(headers: Headers | { get(name: string): string | null }): boolean {
  return headers.get("x-desktop-bypass") === "1";
}
