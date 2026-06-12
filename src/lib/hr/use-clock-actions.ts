"use client";

import { useCallback, useRef, useState } from "react";
import { mutate as globalMutate } from "swr";
import { captureClockInGeo } from "@/lib/attendance-location";
import { desktopBypassHeader, withDesktopBypassParam } from "@/lib/desktop-bypass";

// Shared clock-in / clock-out hook used by both the HR Attendance page
// and the HR Home page. Hardens against the three failure modes that
// previously made users click 3-4 times before anything happened:
//
//   1. Uncaught network errors — `fetch(...)` could throw (transient
//      drop, gateway 502, server reload mid-request, Postgres pool
//      exhaustion). The old handlers had no try/catch around the
//      fetch, so the exception propagated silently and the only
//      visible effect was the spinner resetting. We now wrap every
//      fetch + json parse and surface the failure as a sticky error
//      message instead of an `alert()` that users dismiss without
//      reading.
//
//   2. Concurrent re-entry — users double-click the button. The
//      previous code relied on `setClockingIn(true)` flipping React
//      state, which has a render-cycle delay; in that gap a second
//      onClick could race. A `useRef` busy flag fences entry
//      synchronously so only one request flies at a time.
//
//   3. Transient 5xx / network blips — one automatic retry with a
//      short backoff covers the "I clicked once and got nothing"
//      case without making the user wonder whether their first click
//      registered. The retry only fires for `fetch` rejections and
//      5xx responses; auth, geolocation and 4xx responses (e.g.
//      "already clocked in", "desktop only") aren't retried because
//      they'd just fail again.
//
// The hook owns: `clockIn`, `clockOut`, busy flags, and an `error`
// banner object. The pages render the banner near the button.

export type ClockBannerSeverity = "error" | "info";

export interface ClockBanner {
  message: string;
  severity: ClockBannerSeverity;
}

export interface UseClockActionsOptions {
  /**
   * SWR keys to refresh after a successful clock-in / clock-out so the
   * Today / Sessions UI updates without a manual refresh. The hook
   * iterates and `globalMutate`s each one.
   */
  mutateKeys: string[];
  /**
   * Optional callback fired after a successful clock-out with the
   * server's updated Attendance row — lets the page flash a "Day
   * Complete" toast when totalMinutes crosses the 9h target.
   */
  onClockOutSuccess?: (record: { totalMinutes?: number | null } | null) => void;
}

export interface PulseGate {
  /** "Submit this week's Pulse before clocking out." — straight from the API. */
  message: string;
  /** Deep-link to the pulse form — usually "/dashboard/hr/pulse". */
  pulseUrl: string;
}

export interface UseClockActionsReturn {
  clockIn: () => Promise<void>;
  clockOut: () => Promise<void>;
  clockingIn: boolean;
  clockingOut: boolean;
  error: ClockBanner | null;
  clearError: () => void;
  /**
   * Set when a clock-out 403'd with `reason: "pulse_required"`. UI
   * should render a blocking modal that funnels the user to `pulseUrl`.
   * Null at all other times (including normal errors).
   */
  pulseGate: PulseGate | null;
  dismissPulseGate: () => void;
}

/** Sleep helper — used for the single auto-retry backoff. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch wrapper that:
 *   • Always returns a parsed body (or throws ClockApiError).
 *   • Retries ONCE on transient failures (fetch rejection / 5xx).
 *   • Throws a typed error otherwise so the caller can render a
 *     specific message.
 */
class ClockApiError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
    readonly status?: number,
    /**
     * Server-side enum on 4xx rejections — e.g. "pulse_required" when
     * the Friday Weekly Pulse gate fires. Lets the caller render a
     * specific UX (e.g. modal) instead of a generic error banner.
     */
    readonly reason?: string,
    /**
     * Caller-actionable URL paired with `reason`. For pulse_required
     * it's "/dashboard/hr/pulse" so we can "Take Pulse Now" the user
     * straight into the form.
     */
    readonly actionUrl?: string,
  ) {
    super(message);
  }
}

async function postOnce(url: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(withDesktopBypassParam(url), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...desktopBypassHeader() },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

async function postWithRetry(url: string, body?: unknown): Promise<any> {
  try {
    const first = await postOnce(url, body);
    if (first.ok) return first.data;
    if (first.status >= 500) {
      // 5xx → one retry
      await sleep(600);
      const second = await postOnce(url, body);
      if (second.ok) return second.data;
      throw new ClockApiError(
        second.data?.error || `Server error (${second.status}). Please try again in a moment.`,
        true,
        second.status,
      );
    }
    // 4xx — return the server-provided error directly, no retry.
    throw new ClockApiError(
      first.data?.error || `Request rejected (${first.status}).`,
      false,
      first.status,
      first.data?.reason,
      first.data?.pulseUrl,
    );
  } catch (e: any) {
    if (e instanceof ClockApiError) throw e;
    // Network-level failure (no response at all). Retry once.
    await sleep(600);
    try {
      const retry = await postOnce(url, body);
      if (retry.ok) return retry.data;
      throw new ClockApiError(
        retry.data?.error || `Network problem. Please check your connection and try again.`,
        true,
        retry.status,
      );
    } catch (e2: any) {
      if (e2 instanceof ClockApiError) throw e2;
      throw new ClockApiError(
        `Network problem. Please check your connection and try again.`,
        true,
      );
    }
  }
}

export function useClockActions({ mutateKeys, onClockOutSuccess }: UseClockActionsOptions): UseClockActionsReturn {
  const [clockingIn, setClockingIn] = useState(false);
  const [clockingOut, setClockingOut] = useState(false);
  const [error, setError] = useState<ClockBanner | null>(null);
  const [pulseGate, setPulseGate] = useState<PulseGate | null>(null);
  // Synchronous re-entry guards. React state is async (set, then
  // re-render); a `useRef` flag flips immediately so the next onClick
  // in the same event loop tick is a no-op.
  const inFlightIn = useRef(false);
  const inFlightOut = useRef(false);

  const refreshAfter = useCallback(() => {
    for (const k of mutateKeys) {
      try { globalMutate(k); } catch { /* swallow — refresh is best-effort */ }
    }
  }, [mutateKeys]);

  const clockIn = useCallback(async () => {
    if (inFlightIn.current) return;
    inFlightIn.current = true;
    setClockingIn(true);
    setError(null);
    try {
      const geo = await captureClockInGeo();
      if (!geo.ok) {
        setError({
          message: geo.message || "Could not get your location. Please allow Location for this site and try again.",
          severity: "error",
        });
        console.warn("[clock-in] geo failed:", geo.reason, geo.message);
        return;
      }
      await postWithRetry("/api/hr/attendance/clock-in", {
        lat: geo.lat, lng: geo.lng, address: geo.address,
      });
      refreshAfter();
    } catch (e: any) {
      const msg = e instanceof ClockApiError ? e.message : "Clock-in failed. Please try again.";
      setError({ message: msg, severity: "error" });
      console.warn("[clock-in] failed:", e);
    } finally {
      inFlightIn.current = false;
      setClockingIn(false);
    }
  }, [refreshAfter]);

  const clockOut = useCallback(async () => {
    if (inFlightOut.current) return;
    inFlightOut.current = true;
    setClockingOut(true);
    setError(null);
    setPulseGate(null);
    try {
      const data = await postWithRetry("/api/hr/attendance/clock-out");
      refreshAfter();
      onClockOutSuccess?.(data);
    } catch (e: any) {
      // Weekly Pulse gate — show a blocking modal instead of the
      // generic banner so the user lands on the form in one click.
      if (e instanceof ClockApiError && e.reason === "pulse_required" && e.actionUrl) {
        setPulseGate({ message: e.message, pulseUrl: e.actionUrl });
      } else {
        const msg = e instanceof ClockApiError ? e.message : "Clock-out failed. Please try again.";
        setError({ message: msg, severity: "error" });
      }
      console.warn("[clock-out] failed:", e);
    } finally {
      inFlightOut.current = false;
      setClockingOut(false);
    }
  }, [refreshAfter, onClockOutSuccess]);

  const clearError = useCallback(() => setError(null), []);
  const dismissPulseGate = useCallback(() => setPulseGate(null), []);

  return { clockIn, clockOut, clockingIn, clockingOut, error, clearError, pulseGate, dismissPulseGate };
}
