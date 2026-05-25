// Shared date-rule helpers for leave-style request forms (Leave / WFH /
// On Duty / Half Day / Comp Off).
//
// Rule: regular employees can't pick past dates — past-dated leave goes
// through Regularization instead. CEO / role=hr_manager / isDeveloper
// (the `canApplyRestrictedLeave` tier) CAN back-date because HR often
// needs to file a request on someone's behalf for a missed day.
//
// Both pieces live here so the form `min` attribute and the server
// validator stay in lock-step.

import { canApplyRestrictedLeave } from "@/lib/access";

/**
 * IST-anchored "today" as a YYYY-MM-DD string. Safe to use as the
 * `min` attribute on a native <input type="date"> or as a comparison
 * floor server-side.
 */
export function istTodayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/**
 * Returns the `min` value the date picker should enforce for THIS user.
 * Regular employees get today (no past picks); restricted-admin tier
 * (CEO / role=hr_manager / isDeveloper) gets `undefined` so they can
 * file back-dated requests on someone's behalf.
 */
export function leaveMinDate(user: any): string | undefined {
  return canApplyRestrictedLeave(user) ? undefined : istTodayIso();
}

/**
 * Server-side guard. Returns null when the date is allowed, otherwise
 * an error message string. The caller maps that to a 400 response.
 *
 *   const err = checkPastDateAllowed(body.fromDate, sessionUser);
 *   if (err) return NextResponse.json({ error: err }, { status: 400 });
 *
 * Accepts strings, Date objects, or null. A nullish dateInput returns
 * null (the caller's other validators handle "required" errors).
 */
export function checkPastDateAllowed(
  dateInput: string | Date | null | undefined,
  user: any,
): string | null {
  if (!dateInput) return null;
  if (canApplyRestrictedLeave(user)) return null;
  const istToday = istTodayIso();
  const iso = typeof dateInput === "string"
    ? dateInput.slice(0, 10)
    : new Date(dateInput).toISOString().slice(0, 10);
  if (iso < istToday) {
    return "Past dates can't be selected. If you missed a day, please file a Regularization request — or ask HR to back-date on your behalf.";
  }
  return null;
}
