/**
 * Integration test for LeaveType.adminOnly — the restricted-admin
 * gate added on top of the existing `applicable` flag.
 *
 * Verifies (against the real DB, using the same `canApplyRestrictedLeave`
 * predicate the route imports):
 *
 *   • The column exists with the expected default (false).
 *   • Flipping adminOnly = true keeps applicable independent.
 *   • The role gate accepts CEO / role=hr_manager / isDeveloper only.
 *   • It explicitly REJECTS special_access and role=admin (the two
 *     `isHRAdmin` includes that the user excluded by hand).
 *   • Plain employees / managers / HoDs are rejected.
 *   • The "Carry Over Leave" data migration applied (if such a row
 *     exists in this DB — soft-asserts; doesn't fail when absent).
 *
 *   npx tsx scripts/_test-leave-admin-only.ts
 */
process.env.EMAIL_DRY_RUN = "true";

import { PrismaClient } from "@prisma/client";
import { canApplyRestrictedLeave } from "../src/lib/access";

const prisma = new PrismaClient();
const TEST_PREFIX = "audit-test+admin-only-";
const TEST_DOMAIN = "@local.test";

type Status = "PASS" | "FAIL";
const results: { name: string; status: Status; evidence: string }[] = [];
const expect = (cond: boolean): Status => (cond ? "PASS" : "FAIL");
function record(name: string, status: Status, evidence: string) {
  results.push({ name, status, evidence });
}

async function teardown() {
  await prisma.$executeRawUnsafe(
    `DELETE FROM "LeaveType" WHERE code LIKE 'TST_AO%'`,
  );
}

async function main() {
  console.log(`╔═══════════════════════════════════════════════════════════════════╗`);
  console.log(`║ Integration test: LeaveType.adminOnly + restricted-role gate       ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════╝`);

  await teardown();

  try {
    // 1. Column exists with the expected default (false) — insert a
    //    row without setting adminOnly and read it back.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "LeaveType" (name, code, "daysPerYear", "isPaid", "isActive", "applicable")
       VALUES ('Admin-Only Test (default)', 'TST_AO_A', 0, true, true, true)`,
    );
    const a = (await prisma.$queryRawUnsafe<Array<{ applicable: boolean; adminOnly: boolean }>>(
      `SELECT "applicable", "adminOnly" FROM "LeaveType" WHERE code = 'TST_AO_A'`,
    ))[0];
    record(
      "adminOnly column exists with default FALSE",
      expect(a?.applicable === true && a?.adminOnly === false),
      `applicable=${a?.applicable} adminOnly=${a?.adminOnly}`,
    );

    // 2. Insert a row with adminOnly=true + applicable=true (the
    //    Carry-Over-Leave shape).
    await prisma.$executeRawUnsafe(
      `INSERT INTO "LeaveType" (name, code, "daysPerYear", "isPaid", "isActive", "applicable", "adminOnly")
       VALUES ('Admin-Only Test (restricted)', 'TST_AO_B', 0, true, true, true, true)`,
    );
    const b = (await prisma.$queryRawUnsafe<Array<{ applicable: boolean; adminOnly: boolean }>>(
      `SELECT "applicable", "adminOnly" FROM "LeaveType" WHERE code = 'TST_AO_B'`,
    ))[0];
    record(
      "adminOnly + applicable can coexist",
      expect(b?.applicable === true && b?.adminOnly === true),
      `applicable=${b?.applicable} adminOnly=${b?.adminOnly}`,
    );

    // 3. Role-gate matrix. The same predicate the API route uses.
    const cases: Array<{ label: string; user: any; expected: boolean }> = [
      { label: "CEO",                       user: { orgLevel: "ceo" },                                  expected: true  },
      { label: "Developer (isDeveloper)",   user: { orgLevel: "member", isDeveloper: true },            expected: true  },
      { label: "HR Manager (role=hr_manager)", user: { orgLevel: "hr_manager", role: "hr_manager" },    expected: true  },
      // Explicitly NOT allowed — the two `isHRAdmin` covers that the user
      // wanted excluded for this gate.
      { label: "special_access",            user: { orgLevel: "special_access" },                       expected: false },
      { label: "role=admin (non-HR)",       user: { orgLevel: "member", role: "admin" },                expected: false },
      // Broader HR tier — orgLevel hr_manager only (NOT role hr_manager)
      // is the "HR Member" tier — should NOT be able to apply restricted.
      { label: "HR Member (orgLevel only)", user: { orgLevel: "hr_manager" },                           expected: false },
      // Regular org tiers — should all be rejected.
      { label: "manager",                   user: { orgLevel: "manager" },                              expected: false },
      { label: "hod",                       user: { orgLevel: "hod" },                                  expected: false },
      { label: "member",                    user: { orgLevel: "member" },                               expected: false },
      { label: "null user",                 user: null,                                                 expected: false },
    ];
    for (const c of cases) {
      const got = canApplyRestrictedLeave(c.user);
      record(
        `canApplyRestrictedLeave(${c.label}) === ${c.expected}`,
        expect(got === c.expected),
        `got=${got} expected=${c.expected}`,
      );
    }

    // 4. Carry Over Leave data migration soft-check. The migration
    //    flips that row's applicable + adminOnly to TRUE if it exists.
    const co = await prisma.$queryRawUnsafe<Array<{ applicable: boolean; adminOnly: boolean }>>(
      `SELECT "applicable", "adminOnly" FROM "LeaveType"
        WHERE LOWER(name) IN ('carry over leave','carryover leave','carry-over leave')`,
    );
    if (co.length === 0) {
      record(
        "Carry Over Leave row: not present in this DB (soft-skip)",
        "PASS",
        "no row matched — nothing to assert against",
      );
    } else {
      record(
        "Carry Over Leave row: applicable=true + adminOnly=true after migration",
        expect(co[0].applicable === true && co[0].adminOnly === true),
        `applicable=${co[0].applicable} adminOnly=${co[0].adminOnly}`,
      );
    }
  } finally {
    await teardown();
    console.log(`\nTest data cleaned up.`);
  }

  console.log(``);
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
}

main()
  .catch(async (e) => { console.error(e); try { await teardown(); } catch {} process.exit(1); })
  .finally(() => prisma.$disconnect());
