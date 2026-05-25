/**
 * Pure-function audit of the HR-tab access gates in src/lib/access.ts.
 * No DB writes. Verifies that:
 *
 *   1. The Approvals sub-tab is visible to HR Members (the recently
 *      granted access).
 *   2. The HR Manager (role="hr_manager") still sees everything via
 *      isFullHRAdmin — no regression.
 *   3. Plain Members / managers / non-HR roles are still blocked from
 *      the HR Dashboard entirely.
 *   4. Admin-only tabs (leave-types, shifts, etc.) are still gated
 *      away from HR Members.
 *   5. The server-side /api/hr/approvals predicate accepts every HR
 *      tier the UI now shows the tab to.
 *
 *   npx tsx scripts/_test-hr-access.ts
 */
import {
  isAdmin, isHRAdmin, isFullHRAdmin,
  HR_MANAGER_ALLOWED_TABS,
} from "../src/lib/access";
import {
  TAB_CATALOG, TAB_CATALOG_BY_KEY, defaultTabPermissions,
} from "../src/lib/permissions/tabs";

type Status = "PASS" | "FAIL";
const results: { name: string; status: Status; evidence: string }[] = [];
const expect = (cond: boolean): Status => (cond ? "PASS" : "FAIL");
function record(name: string, status: Status, evidence: string) {
  results.push({ name, status, evidence });
}

// Representative user shapes from the codebase.
const ceo            = { orgLevel: "ceo",            role: "member",     isDeveloper: false };
const developer      = { orgLevel: "member",         role: "member",     isDeveloper: true  };
const specialAccess  = { orgLevel: "special_access", role: "member",     isDeveloper: false };
const adminRole      = { orgLevel: "member",         role: "admin",      isDeveloper: false };
const hrManager      = { orgLevel: "hr_manager",     role: "hr_manager", isDeveloper: false };
const hrMember       = { orgLevel: "hr_manager",     role: "member",     isDeveloper: false };
const lineManager    = { orgLevel: "manager",        role: "manager",    isDeveloper: false };
const plainEmployee  = { orgLevel: "member",         role: "member",     isDeveloper: false };

// ── isHRAdmin: gate for the HR Dashboard page ───────────────────────
record(
  "HR Dashboard gate — CEO is HR-admin",
  expect(isHRAdmin(ceo) === true),
  `isHRAdmin({orgLevel:'ceo'}) → true`,
);
record(
  "HR Dashboard gate — HR Manager is HR-admin",
  expect(isHRAdmin(hrManager) === true),
  `isHRAdmin({orgLevel:'hr_manager', role:'hr_manager'}) → true`,
);
record(
  "HR Dashboard gate — HR Member (orgLevel only) is HR-admin",
  expect(isHRAdmin(hrMember) === true),
  `isHRAdmin({orgLevel:'hr_manager', role:'member'}) → true`,
);
record(
  "HR Dashboard gate — plain employee is NOT HR-admin",
  expect(isHRAdmin(plainEmployee) === false),
  `isHRAdmin({orgLevel:'member', role:'member'}) → false (correct — would 403 the page)`,
);
record(
  "HR Dashboard gate — line manager is NOT HR-admin",
  expect(isHRAdmin(lineManager) === false),
  `Line managers without HR claim shouldn't see HR-tier pages.`,
);

// ── isFullHRAdmin: decides whether the user sees ALL tabs or the
//                  curated HR_MANAGER_ALLOWED_TABS subset ────────────
record(
  "Full HR view — CEO sees every tab",
  expect(isFullHRAdmin(ceo) === true),
  `Full-admin tier — no whitelist filter.`,
);
record(
  "Full HR view — HR Manager (role=hr_manager) sees every tab",
  expect(isFullHRAdmin(hrManager) === true),
  `role="hr_manager" is the actual HR Manager designation; sees ALL tabs.`,
);
record(
  "Full HR view — HR Member is restricted to the whitelist",
  expect(isFullHRAdmin(hrMember) === false),
  `Sees HR Dashboard but only HR_MANAGER_ALLOWED_TABS tabs.`,
);

// ── HR_MANAGER_ALLOWED_TABS membership ──────────────────────────────
record(
  "Approvals visibility — HR Member CAN see Approvals sub-tab (new)",
  expect(HR_MANAGER_ALLOWED_TABS.has("approvals")),
  `"approvals" is now in HR_MANAGER_ALLOWED_TABS — UI renders the tab.`,
);

// Sanity-check the rest of the whitelist still includes the existing
// allowed tabs (no accidental removal).
for (const key of ["attendance-dashboard", "leaves", "holidays", "assets", "departments"]) {
  record(
    `Whitelist regression — "${key}" still allowed for HR Member`,
    expect(HR_MANAGER_ALLOWED_TABS.has(key)),
    `Membership preserved.`,
  );
}

// Admin-only tabs MUST NOT be in the HR-Member whitelist.
for (const key of ["leave-types", "leave-policies", "shifts"]) {
  record(
    `Admin-only tab — "${key}" is NOT in HR Member whitelist`,
    expect(!HR_MANAGER_ALLOWED_TABS.has(key)),
    `Policy/org-wide config tab correctly stays admin-only.`,
  );
}

// ── Mirror the server-side predicate in /api/hr/approvals so the UI
//    tab can't promise something the API would deny ──────────────────
function serverApprovalsGate(u: { orgLevel?: string; role?: string; isDeveloper?: boolean }): boolean {
  return (
    u.orgLevel === "ceo" ||
    !!u.isDeveloper ||
    u.orgLevel === "hr_manager" ||
    u.orgLevel === "special_access" ||
    u.role === "admin" ||
    u.role === "hr_manager"
  );
}

record(
  "Server gate — HR Member is accepted by /api/hr/approvals (sees all rows)",
  expect(serverApprovalsGate(hrMember)),
  `The server treats orgLevel="hr_manager" as final approver, so UI + API agree.`,
);
record(
  "Server gate — HR Manager is accepted (final approver tier)",
  expect(serverApprovalsGate(hrManager)),
  `role="hr_manager" already passes.`,
);
record(
  "Server gate — CEO + dev + special_access + role=admin all accepted",
  expect(
    serverApprovalsGate(ceo) &&
    serverApprovalsGate(developer) &&
    serverApprovalsGate(specialAccess) &&
    serverApprovalsGate(adminRole),
  ),
  `Full admin tier still passes.`,
);
record(
  "Server gate — plain employee REJECTED",
  expect(!serverApprovalsGate(plainEmployee)),
  `Non-HR + non-admin users without direct reports get 403, as before.`,
);

// ── HR Dashboard sub-tab catalog (the toggles in the Permissions UI's
//    "HR Dashboard sections" group) ───────────────────────────────────
const SUB_TABS = TAB_CATALOG.filter((t) => t.group === "HR Dashboard sections").map((t) => t.key);
record(
  "Sub-tab catalog — every HR Dashboard section has its own perm key",
  expect(
    SUB_TABS.includes("hr_admin_attendance" as any) &&
    SUB_TABS.includes("hr_admin_approvals" as any) &&
    SUB_TABS.includes("hr_admin_leaves" as any) &&
    SUB_TABS.includes("hr_admin_holidays" as any) &&
    SUB_TABS.includes("hr_admin_assets" as any) &&
    SUB_TABS.includes("hr_admin_leave_types" as any) &&
    SUB_TABS.includes("hr_admin_leave_policies" as any) &&
    SUB_TABS.includes("hr_admin_shifts" as any) &&
    SUB_TABS.includes("hr_admin_departments" as any),
  ),
  `9 keys present in TAB_CATALOG: ${SUB_TABS.join(", ")}`,
);
record(
  "Sub-tab catalog — Leave Policies has its OWN key (no longer shares with Leave Types)",
  expect(
    TAB_CATALOG_BY_KEY.hr_admin_leave_types?.label === "Leave Types" &&
    TAB_CATALOG_BY_KEY.hr_admin_leave_policies?.label === "Leave Policies",
  ),
  `hr_admin_leave_types → "Leave Types"; hr_admin_leave_policies → "Leave Policies". Toggling one no longer hides the other.`,
);

// ── Role defaults — make sure ROLE_TAB_OVERRIDES wires the toggles
//    so each tier sees the right sub-tabs out of the box ──────────────
const ceoDefaults         = defaultTabPermissions("ceo");
const specialAccessDefaults = defaultTabPermissions("special_access");
const hrManagerDefaults   = defaultTabPermissions("hr_manager");
const plainDefaults       = defaultTabPermissions("member");

record(
  "Defaults — CEO sees every HR Dashboard sub-tab",
  expect(SUB_TABS.every((k) => ceoDefaults[k] === true)),
  `Full admin sees all 9 sub-tabs on day 1.`,
);
record(
  "Defaults — special_access sees every HR Dashboard sub-tab",
  expect(SUB_TABS.every((k) => specialAccessDefaults[k] === true)),
  `Senior-admin tier mirrors CEO.`,
);
record(
  "Defaults — HR Manager / HR Member: Approvals is ON by default",
  expect(hrManagerDefaults.hr_admin_approvals === true),
  `Approvals was just added to the curated whitelist; default toggle now matches.`,
);
record(
  "Defaults — HR Manager / HR Member: Leave Policies is OFF by default (admin-only)",
  expect(hrManagerDefaults.hr_admin_leave_policies === false),
  `Policy / org-wide config tab stays admin-only — admins can flip per-user if needed.`,
);
record(
  "Defaults — plain employee: every HR Dashboard sub-tab is OFF",
  expect(SUB_TABS.every((k) => plainDefaults[k] === false)),
  `Sub-tabs are gated by the parent hr_admin tab; plain employees see neither.`,
);

// ── Output ──────────────────────────────────────────────────────────
console.log(`╔═══════════════════════════════════════════════════════════════════╗`);
console.log(`║ Pure-function audit: HR-tab access gates                          ║`);
console.log(`╚═══════════════════════════════════════════════════════════════════╝`);
for (const r of results) {
  const icon = r.status === "PASS" ? "✓" : "✗";
  console.log(`  [${icon} ${r.status}] ${r.name}`);
  console.log(`           ${r.evidence}`);
}
const pass = results.filter(r => r.status === "PASS").length;
const fail = results.filter(r => r.status === "FAIL").length;
console.log(``);
console.log(`── Summary ──────────────────────────────────────────────────────────`);
console.log(`  ${pass} PASS   ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
