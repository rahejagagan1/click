// Helper used by every clock-in / clock-out fetch so the `?desktop=11` override
// works end-to-end on mobile.
//
// When the user opens ANY page with `?desktop=11`, we remember it for the rest
// of the browser session (sessionStorage) and forward it to the clock-in/out
// API in TWO ways:
//   • the `x-desktop-bypass: 11` request header, and
//   • a `?desktop=11` query param on the request URL.
// Belt-and-suspenders so the override survives BOTH client-side navigation
// (which drops the page's query string before you click clock-in) AND any
// reverse proxy that strips custom `x-` headers. The server honours either.
//
// Not a secret — it's a soft override for when a laptop isn't available; pair
// with a regularization request if used.

const STORAGE_KEY = "desktop-bypass";

/**
 * True when the desktop bypass is active for this session: `?desktop=11` is in
 * the current URL, OR it was set earlier in the session. Reading it from the
 * URL also persists it so later navigations (which drop the query string)
 * keep the override alive.
 */
export function isDesktopBypassActive(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("desktop") === "11") {
      try { window.sessionStorage.setItem(STORAGE_KEY, "1"); } catch {}
      return true;
    }
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Headers blob to spread into a clock-in/out fetch. Empty unless active. */
export function desktopBypassHeader(): Record<string, string> {
  return isDesktopBypassActive() ? { "x-desktop-bypass": "11" } : {};
}

/**
 * Append `?desktop=11` to an API URL when the bypass is active. Query strings
 * are always forwarded — even by proxies that strip custom headers — so this
 * is the reliable signal the server can count on.
 */
export function withDesktopBypassParam(url: string): string {
  if (!isDesktopBypassActive()) return url;
  return url + (url.includes("?") ? "&" : "?") + "desktop=11";
}

/**
 * Server-side check — true when the caller opted into the desktop bypass via
 * the `x-desktop-bypass` header. Routes ALSO check `?desktop=11` on the request
 * URL (query params survive header-stripping proxies); see the clock-in /
 * clock-out handlers.
 */
export function hasDesktopBypassHeader(headers: Headers | { get(name: string): string | null }): boolean {
  return headers.get("x-desktop-bypass") === "11";
}
