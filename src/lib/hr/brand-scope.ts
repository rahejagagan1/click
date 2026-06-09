// Brand-scope helper for HR endpoints that join to EmployeeProfile.
//
// Most HR admin endpoints have the shape:
//   SELECT ... FROM "User" u
//   LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
//   WHERE ...
// and need to filter to the caller's businessUnit unless the caller
// is allowlisted (developers + CROSS_BRAND_HR_USER_IDS env users).
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
