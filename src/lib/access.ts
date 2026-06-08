// Single source of truth for admin-tier access checks on the client.
// Anywhere in the app that needs "is this user an admin?" should import
// from here instead of inlining the same predicate — when the rules
// change, they change once.

import { can, hasResolvedPermissions } from "./permissions/can";

type ClientUser = {
  orgLevel?: string | null;
  role?: string | null;
  isDeveloper?: boolean | null;
  email?: string | null;
  businessUnit?: string | null;
  // True when the user's designation has at least one per-owner report grant
  // (DesignationReportAccess). Set on the session in the auth callback.
  hasReportGrants?: boolean | null;
} | null | undefined;

/**
 * Top-tier admin. Sees every tab, every CRUD button, every admin-only
 * page. Mirrors the sidebar's `isAdmin` and the server-side
 * `hasProtectedRole` in src/lib/permissions/resolve.ts.
 */
export function isAdmin(user: ClientUser): boolean {
  if (!user) return false;
  if (hasResolvedPermissions(user)) return can(user, "SYSTEM_ADMIN");
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
  if (hasResolvedPermissions(user)) return can(user, "MANAGE_HR");
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
  if (hasResolvedPermissions(user)) return can(user, "VIEW_SALARY");
  return (
    user.orgLevel === "ceo" ||
    user.orgLevel === "hr_manager" ||
    isSalaryDeveloper(user)
  );
}

/**
 * Tighter gate than `isHRAdmin` — only CEO, role=hr_manager, and
 * isDeveloper. Deliberately excludes special_access and role=admin.
 *
 * Used for restricted-admin leave types (LeaveType.adminOnly), where
 * even broader admin tiers shouldn't be able to apply on someone's
 * behalf. The classic case is Carry Over Leave — sensitive enough that
 * only the actual HR Manager / CEO / a developer should be able to
 * draw it down.
 */
export function canApplyRestrictedLeave(user: ClientUser): boolean {
  if (!user) return false;
  if (hasResolvedPermissions(user)) return can(user, "APPLY_RESTRICTED_LEAVE");
  return (
    user.orgLevel === "ceo" ||
    user.isDeveloper === true ||
    user.role === "hr_manager"
  );
}

/**
 * "Can see reports / scores" tier — admin tier + managers + HoDs + HR
 * managers. Mirrors `canSeeReports` in the sidebar.
 */
export function canSeeReports(user: ClientUser): boolean {
  // A designation with per-owner report grants (but no blanket VIEW_REPORTS)
  // still opens the hub — the hub then filters to just the granted owners.
  if (user?.hasReportGrants === true) return true;
  if (hasResolvedPermissions(user)) return can(user, "VIEW_REPORTS");
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
 * Tabs / rail links inside the HR Dashboard that a *normal HR Member*
 * (orgLevel="hr_manager" but NOT role="hr_manager") is allowed to see.
 * Full admins (developer / CEO / special_access / role=admin) and the
 * actual HR Manager (role="hr_manager") see everything via
 * `isFullHRAdmin`; this whitelist applies only to the broader HR-Member
 * tier so they get a curated subset.
 *
 * Includes "approvals" so HR Members can act on the org-wide approvals
 * queue alongside the HR Manager — the server-side gate in
 * /api/hr/approvals already accepts orgLevel="hr_manager", so this was
 * just a client-side visibility flip.
 *
 * Includes "payroll" so the HR Manager (orgLevel="hr_manager") sees the
 * Payroll tab — the actual salary gate is the second-stage canViewSalary
 * check in admin/page.tsx, which keeps HR Members without salary rights
 * out. Listing it here just stops the first-stage filter from stripping
 * it before that check runs.
 *
 * Excludes (intentionally): Leave Types, Shift Templates, Tab
 * Permissions — those are policy / org-wide configuration and stay
 * admin-only.
 */
export const HR_MANAGER_ALLOWED_TABS = new Set<string>([
  "attendance-dashboard",
  "approvals",
  "leaves",
  "holidays",
  "assets",
  "departments",
  "payroll",
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
  if (hasResolvedPermissions(user)) return can(user, "MANAGE_TAB_PERMISSIONS");
  return isAdmin(user) || user?.role === "hr_manager";
}

/**
 * Feedback (the org-wide /dashboard/feedback form + its API) is an
 * NB Media program. YT Labs employees — including the YT Labs CEO —
 * shouldn't see the tab or be able to submit. Gate the sidebar nav
 * item, the page-level useEffect redirect, AND the POST /api/feedback
 * server check on this so all three stay in sync (see auto-memory
 * note "Access gates must stay in sync").
 */
export function canUseFeedback(user: ClientUser): boolean {
  if (!user) return false;
  return user.businessUnit !== "YT Labs";
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
