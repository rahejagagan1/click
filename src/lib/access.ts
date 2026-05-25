// Single source of truth for admin-tier access checks on the client.
// Anywhere in the app that needs "is this user an admin?" should import
// from here instead of inlining the same predicate — when the rules
// change, they change once.

type ClientUser = {
  orgLevel?: string | null;
  role?: string | null;
  isDeveloper?: boolean | null;
  email?: string | null;
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
 * The one developer who is trusted with salary data. Other developers
 * (e.g. anyone else in DEVELOPER_EMAILS) pass `isDeveloper` for every
 * other dev-only surface but NOT for compensation. Must stay in sync
 * with SALARY_DEV_EMAIL in src/lib/api-auth.ts.
 */
export const SALARY_DEV_EMAIL = "rahejagagan1@gmail.com";

/** True when this user is the salary-trusted developer (gagan only). */
export function isSalaryDeveloper(user: ClientUser): boolean {
  if (!user) return false;
  return (
    user.isDeveloper === true &&
    typeof user.email === "string" &&
    user.email.toLowerCase() === SALARY_DEV_EMAIL
  );
}

/**
 * Narrower gate dedicated to salary / payroll visibility on the client.
 * Mirrors `canViewSalary` in src/lib/api-auth.ts. Per explicit policy
 * (2026-05-25): only HR Manager, CEO, and the salary-trusted developer
 * (gagan — see SALARY_DEV_EMAIL) may see salary, payslips, payroll runs,
 * the Finances tab, the Compensation section in Edit Profile, and the
 * Payroll tab in HR Admin. `special_access`, `role=admin`, and OTHER
 * developers are excluded — they still pass `isHRAdmin` / `isDeveloper`
 * elsewhere but NOT for compensation data.
 */
export function canViewSalary(user: ClientUser): boolean {
  if (!user) return false;
  return (
    user.orgLevel === "ceo" ||
    user.orgLevel === "hr_manager" ||
    isSalaryDeveloper(user)
  );
}

/**
 * "Can see reports / scores" tier — admin tier + managers + HoDs + HR
 * managers. Mirrors `canSeeReports` in the sidebar.
 */
export function canSeeReports(user: ClientUser): boolean {
  return (
    isAdmin(user) ||
    user?.orgLevel === "manager" ||
    user?.orgLevel === "hod" ||
    // Use role=hr_manager (not orgLevel) — see isPickableAsManager
    // for the why: orgLevel=hr_manager is set on every HR employee
    // including plain Members, so gating on it would let HR Members
    // see all reports. role=hr_manager is the actual HR-Manager-only
    // marker (e.g. Tanvi), which matches the rule "only HR Manager
    // sees reports, not normal HR staff".
    user?.role === "hr_manager"
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
  "departments",
]);

export const HR_MANAGER_ALLOWED_RAIL_LINKS = new Set<string>([
  "onboard",
  "offboard",
  "hiring",
]);

/**
 * True when the viewer should see ALL HR Dashboard tabs (no whitelist).
 *
 * Includes:
 *   • Top admin tier (developer / CEO / special_access / role=admin)
 *   • role="hr_manager" — the actual HR Manager designation, distinct
 *     from someone whose only HR claim is `orgLevel="hr_manager"`.
 *
 * "Normal HR" users (orgLevel="hr_manager" without role="hr_manager")
 * still get the HR Dashboard via `isHRAdmin`, but only the curated
 * tabs in HR_MANAGER_ALLOWED_TABS / HR_MANAGER_ALLOWED_RAIL_LINKS.
 */
export function isFullHRAdmin(user: ClientUser): boolean {
  return isAdmin(user) || user?.role === "hr_manager";
}

/**
 * True when this user can be assigned as someone else's Reporting /
 * Inline Manager. Used by:
 *   • The "Manager" dropdown on the Admin → Users table
 *   • /api/managers (Manager Reports sidebar + onboarding form)
 *
 * Mirroring the API filter here keeps the picker UI in sync with the
 * sidebar — a manager who shows up on one list shows up on both.
 *
 * Excluded on purpose: lead / sub_lead orgLevels (they're tagging
 * tiers, not assignment targets), the legacy `production_team`
 * orgLevel, and anyone whose only manager-ish claim is "happens to
 * have a direct report" (Keka imports left lots of stale managerIds).
 */
export function isPickableAsManager(user: ClientUser): boolean {
  if (!user) return false;
  // Report-OWNERS only (people who actually submit reports).
  // CEO / special_access / role=admin / developer can SEE everyone's
  // reports but they don't OWN any, so their names must NOT appear in
  // the manager list / picker / reports sidebar.
  //
  // Subtle gotcha for the HR side: every HR person — including
  // Members — is saved with `orgLevel: hr_manager` (the org-tree
  // dropdown's "HR" option maps to that single orgLevel). So we
  // canNOT use orgLevel=hr_manager as the manager test or every HR
  // employee shows up as a manager. The actual HR-Manager (e.g.
  // Tanvi) is identified by `role === "hr_manager"`; that's what
  // we gate on here.
  if (user.orgLevel === "hod")            return true;
  if (user.orgLevel === "manager")        return true;
  if (user.role === "manager")            return true;
  if (user.role === "production_manager") return true;
  if (user.role === "researcher_manager") return true;
  if (user.role === "hr_manager")         return true;
  return false;
}
