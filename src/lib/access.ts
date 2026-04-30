// Single source of truth for admin-tier access checks on the client.
// Anywhere in the app that needs "is this user an admin?" should import
// from here instead of inlining the same predicate — when the rules
// change, they change once.

type ClientUser = {
  orgLevel?: string | null;
  role?: string | null;
  isDeveloper?: boolean | null;
} | null | undefined;

/**
 * Top-tier admin. Sees every tab, every CRUD button, every admin-only
 * page. Mirrors the sidebar's `isAdmin` and the server-side
 * `hasProtectedRole` in src/lib/permissions/resolve.ts.
 */
export function isAdmin(user: ClientUser): boolean {
  if (!user) return false;
  return (
    user.orgLevel === "ceo" ||
    user.isDeveloper === true ||
    user.orgLevel === "special_access" ||
    user.role === "admin"
  );
}

/**
 * HR-admin tier — top-tier admin OR HR manager. Used for HR-specific
 * pages (HR Dashboard, employee directory edits, ticket management,
 * approvals, etc.).
 */
export function isHRAdmin(user: ClientUser): boolean {
  return isAdmin(user) || user?.orgLevel === "hr_manager";
}

/**
 * "Can see reports / scores" tier — admin tier + managers + heads of
 * department. Mirrors `canSeeReports` in the sidebar.
 */
export function canSeeReports(user: ClientUser): boolean {
  return (
    isAdmin(user) ||
    user?.orgLevel === "manager" ||
    user?.orgLevel === "hod"
  );
}

/**
 * Tabs / rail links inside the HR Dashboard that a *normal HR Manager*
 * (not a full admin) is allowed to see. Full admins (developer / CEO /
 * special_access / role=admin) see everything; this whitelist only
 * applies when the viewer is hr_manager-only.
 *
 * Excludes: Approvals, Leave Types, Shift Templates, Departments,
 * Tab Permissions — those are policy / org-wide configuration and stay
 * admin-only.
 */
export const HR_MANAGER_ALLOWED_TABS = new Set<string>([
  "attendance-dashboard",
  "leaves",
  "holidays",
  "assets",
]);

export const HR_MANAGER_ALLOWED_RAIL_LINKS = new Set<string>([
  "onboard",
  "offboard",
  "hiring",
]);

/**
 * True when the viewer should see ALL HR Dashboard tabs (no whitelist).
 * Reserved for the top admin tier — hr_manager users get the curated
 * subset above instead.
 */
export function isFullHRAdmin(user: ClientUser): boolean {
  return isAdmin(user);
}
