// Single source of truth for the tab-permission system. Every tab the
// HR admin can toggle lives here, plus:
//   • which URL prefix it covers (used by middleware / sidebar)
//   • the default for a brand-new employee (true = on, false = off)
//
// To add a new tab: append a row here — it automatically shows up in the
// permissions UI, the sidebar filter, and the middleware gate.

export type TabKey =
  | "dashboard"
  | "cases"
  | "company"
  | "scores"
  | "youtube"
  | "feedback"
  | "tools"
  | "hr_home"
  | "hr_me"
  | "hr_my_team"
  | "hr_admin"
  | "hr_people"
  | "reports"
  | "departments"
  | "violations";

export type TabDef = {
  key: TabKey;
  label: string;
  description: string;
  /** URL prefix(es) this tab controls. Middleware uses these to block. */
  pathPrefixes: string[];
  /** Default for a freshly-onboarded employee with no explicit row. */
  defaultForNewUser: boolean;
};

// Ordered to match the real sidebar top-to-bottom.
export const TAB_CATALOG: TabDef[] = [
  { key: "dashboard",   label: "Dashboard",     description: "CEO cases/ratings dashboard",        pathPrefixes: ["/dashboard$"],                          defaultForNewUser: false },
  { key: "cases",       label: "Cases",         description: "All cases list + detail",            pathPrefixes: ["/cases"],                               defaultForNewUser: false },
  { key: "company",     label: "Company",       description: "Company health / org metrics",       pathPrefixes: ["/dashboard/company"],                   defaultForNewUser: false },
  { key: "scores",      label: "Scores",        description: "Team scorecards + ratings",          pathPrefixes: ["/dashboard/scores"],                    defaultForNewUser: false },
  { key: "youtube",     label: "YouTube",       description: "YouTube dashboard",                  pathPrefixes: ["/dashboard/youtube"],                   defaultForNewUser: true  },
  { key: "feedback",    label: "Feedback",      description: "Feedback form + (HR) inbox",         pathPrefixes: ["/dashboard/feedback"],                  defaultForNewUser: true  },
  { key: "tools",       label: "Tools",         description: "General-purpose tools page",         pathPrefixes: ["/dashboard/tools"],                     defaultForNewUser: true  },
  // `admin` is deliberately OFF this catalog — super-admin access is
  // governed by orgLevel/isDeveloper only. Keeping it out of the
  // permissions UI prevents admins from accidentally toggling each
  // other out of the control panel.
  { key: "hr_home",     label: "HR Home",       description: "Personal HR analytics / home",       pathPrefixes: ["/dashboard/hr/home"],              defaultForNewUser: true  },
  { key: "hr_me",       label: "Me",            description: "My Profile, Attendance, Leaves…",    pathPrefixes: ["/dashboard/hr/profile","/dashboard/hr/attendance","/dashboard/hr/leaves","/dashboard/hr/payroll","/dashboard/hr/goals","/dashboard/hr/documents","/dashboard/hr/tickets"],
                                                                                                                                                            defaultForNewUser: true  },
  { key: "hr_my_team",  label: "My Team",       description: "Team overview + inbox (managers)",   pathPrefixes: ["/dashboard/hr/my-team","/dashboard/hr/inbox"], defaultForNewUser: false },
  { key: "hr_admin",    label: "HR Dashboard",  description: "HR-admin: approvals, shifts, etc.",  pathPrefixes: ["/dashboard/hr/admin","/dashboard/hr/assets"], defaultForNewUser: false },
  { key: "hr_people",   label: "People",        description: "Employee directory + onboard",       pathPrefixes: ["/dashboard/hr/people","/dashboard/hr/onboard"], defaultForNewUser: false },
  { key: "reports",     label: "Reports",       description: "Manager weekly / monthly reports",   pathPrefixes: ["/dashboard/reports"],                   defaultForNewUser: false },
  { key: "departments", label: "Departments",   description: "Department pages",                   pathPrefixes: ["/dashboard/department"],                defaultForNewUser: false },
  { key: "violations",  label: "Violation Log", description: "Attendance / policy violations",     pathPrefixes: ["/dashboard/violations"],                defaultForNewUser: false },
];

export const TAB_CATALOG_BY_KEY: Record<TabKey, TabDef> = Object.fromEntries(
  TAB_CATALOG.map((t) => [t.key, t])
) as Record<TabKey, TabDef>;

/** Default permission map for a newly-onboarded employee.
 *  If `orgLevel` is supplied, returns the role-aware defaults — matches
 *  the access-map in the admin audit:
 *
 *    ceo / special_access → everything on
 *    hod                  → 4 basics + My Team + Scores + Reports
 *    hr_manager           → 4 basics + My Team + HR Dashboard
 *    manager              → 4 basics + Scores + Reports
 *    lead / sub_lead / production_team / member → 4 basics only
 *
 *  Without `orgLevel` we fall back to the catalog's static defaults.
 */
export type OrgLevel =
  | "ceo" | "special_access" | "hod" | "hr_manager" | "manager"
  | "lead" | "sub_lead" | "production_team" | "member";

// Role-aware tab defaults — mirrors the sidebar's access logic:
//   isAdmin           = ceo || isDeveloper            → adminOnly items (Cases, Company)
//   isCeo             = ceo || isDeveloper            → ceoOnly items (Dashboard)
//   isHRAdmin         = isAdmin || hr_manager         → HR Admin / People
//   canSeeReports     = isAdmin || manager || hod     → Scores, Reports
//   canSeeViolationLog= isAdmin || special_access || role==='hr_manager' → Violations
// My Team is shown to any HR admin / manager-tier role.
const ROLE_TAB_OVERRIDES: Partial<Record<OrgLevel, Partial<Record<TabKey, boolean>>>> = {
  ceo: {
    dashboard:true, cases:true, company:true, scores:true,
    hr_my_team:true, hr_admin:true, hr_people:true,
    reports:true, departments:true, violations:true,
  },
  special_access: {
    // Like Palak — not an admin, not a manager. Gets a tiny bump (violations)
    // via canSeeViolationLog, nothing else beyond the basic 4 tabs.
    violations: true,
  },
  hod: {
    hr_my_team: true, scores: true, reports: true,
  },
  hr_manager: {
    hr_my_team: true, hr_admin: true, hr_people: true,
    // role='hr_manager' → canSeeViolationLog → violations visible.
    violations: true,
  },
  manager: {
    scores: true, reports: true,
  },
  // leads / sub-leads / production team / members use the base 4-tab defaults.
};

export function defaultTabPermissions(orgLevel?: OrgLevel | string | null): Record<TabKey, boolean> {
  const base = Object.fromEntries(
    TAB_CATALOG.map((t) => [t.key, t.defaultForNewUser])
  ) as Record<TabKey, boolean>;
  if (!orgLevel) return base;
  const overrides = ROLE_TAB_OVERRIDES[orgLevel as OrgLevel];
  if (!overrides) return base;
  return { ...base, ...overrides };
}

/**
 * Match a URL path to the tab key that controls it. Returns null if the
 * path doesn't belong to any gated tab (e.g. /login, /api/auth/*).
 * Uses longest-prefix-wins so specific paths (e.g. hr/admin) beat broader
 * ones (hr).
 */
export function tabKeyForPath(pathname: string): TabKey | null {
  // Special-case exact /dashboard to "dashboard" tab only — otherwise
  // /dashboard/* would always match.
  if (pathname === "/dashboard") return "dashboard";

  let bestMatch: { key: TabKey; len: number } | null = null;
  for (const t of TAB_CATALOG) {
    for (const prefix of t.pathPrefixes) {
      // Treat "$"-suffixed prefix as exact-match ("/dashboard$" handled above).
      if (prefix.endsWith("$")) continue;
      if (pathname === prefix || pathname.startsWith(prefix + "/")) {
        if (!bestMatch || prefix.length > bestMatch.len) {
          bestMatch = { key: t.key, len: prefix.length };
        }
      }
    }
  }
  return bestMatch?.key ?? null;
}
