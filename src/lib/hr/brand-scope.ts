// Brand-scope helper for HR endpoints that join to EmployeeProfile.
//
// Most HR admin endpoints have the shape:
//   SELECT ... FROM "User" u
//   LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
//   WHERE ...
// and need to filter to the caller's businessUnit unless the caller
// is allowlisted (developers + VIEW_ALL_BRANDS permission holders —
// granted via the RBAC designation UI; see canViewAllBrands).
//
// Usage:
//   const scope = getBrandScope(session?.user);
//   const where = scope.allBrands
//     ? "WHERE u.\"isActive\" = true"
//     : `WHERE u."isActive" = true AND ep."businessUnit" = $${nextParam}`;
//   const params = scope.allBrands ? [] : [scope.brand];

import { canViewAllBrands } from "@/lib/access";

export type BrandScope =
  | { allBrands: true;  brand: null; reason: "developer" | "allowlisted" }
  | { allBrands: false; brand: string; reason: "own_brand" }
  | { allBrands: false; brand: null;   reason: "no_brand"  };  // fail-closed

export function getBrandScope(user: any): BrandScope {
  if (!user) return { allBrands: false, brand: null, reason: "no_brand" };
  if (user.isDeveloper === true) {
    return { allBrands: true, brand: null, reason: "developer" };
  }
  if (canViewAllBrands(user)) {
    return { allBrands: true, brand: null, reason: "allowlisted" };
  }
  const bu = user.businessUnit;
  if (bu === "NB Media" || bu === "YT Labs") {
    return { allBrands: false, brand: bu, reason: "own_brand" };
  }
  // Caller has no businessUnit set on their profile and isn't an
  // allowlisted cross-brand viewer. Don't fail open — return a
  // sentinel the caller can detect and respond with [] / 403.
  return { allBrands: false, brand: null, reason: "no_brand" };
}

/** Normalise a `?brand=` query value to a canonical brand name, or null
 *  if it doesn't name a known brand. Accepts the full names the payroll
 *  UI sends ("NB Media" / "YT Labs") as well as the slug forms used
 *  elsewhere ("nb-media" / "yt-labs" / "nb" / "yt"). */
export function normaliseBrandParam(raw: string | null | undefined): "NB Media" | "YT Labs" | null {
  const v = (raw || "").trim().toLowerCase();
  if (v === "yt labs" || v === "yt-labs" || v === "yt")  return "YT Labs";
  if (v === "nb media" || v === "nb-media" || v === "nb") return "NB Media";
  return null;
}

/**
 * Brand scope for endpoints that expose a brand toggle (e.g. the Run
 * Payroll steps). Starts from the caller's own scope, then lets an
 * all-brands caller (developer / cross-brand allowlist) NARROW the view
 * to a single brand chosen in the UI via `?brand=`.
 *
 * A single-brand caller can never widen or switch brands: a mismatching
 * `?brand=` is ignored and their own brand is kept (fail-closed). This
 * keeps the toggle purely a convenience for the founder / cross-brand HR
 * while preserving hard isolation for everyone else.
 */
export function resolveBrandScope(user: any, requestedRaw: string | null | undefined): BrandScope {
  const base = getBrandScope(user);
  const requested = normaliseBrandParam(requestedRaw);
  // Only all-brands callers can be narrowed. Single-brand / no_brand
  // callers keep their own (already-safe) scope regardless of the param.
  if (!base.allBrands || !requested) return base;
  return { allBrands: false, brand: requested, reason: "own_brand" };
}

/** Convenience: builds a SQL fragment + param array for the
 *  `ep."businessUnit"` filter. Caller decides where to splice it
 *  into their WHERE clause. Returns null if the caller is in the
 *  "no_brand" fail-closed bucket — caller should return [] / 403
 *  at that point instead of running the query. */
export function brandWhereClause(
  user: any,
  paramIndex: number,
): { clause: string; params: any[] } | null {
  const scope = getBrandScope(user);
  if (scope.allBrands) return { clause: "", params: [] };
  if (scope.brand) return {
    clause: `ep."businessUnit" = $${paramIndex}`,
    params: [scope.brand],
  };
  // no_brand → fail closed
  return null;
}
