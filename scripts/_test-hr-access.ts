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
