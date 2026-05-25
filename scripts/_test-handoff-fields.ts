/**
 * Integration test for the company-standard "Handoff Details" fields
 * added to every leave-style request (Leave / WFH / On-Duty / Comp-Off).
 *
 *   • Past-date gate (`checkPastDateAllowed`) — pure-function matrix:
 *       - Regular users / special_access / role=admin → past dates rejected.
 *       - CEO / role=hr_manager / isDeveloper       → past dates allowed.
 *   • Schema columns exist on all four request tables.
 *   • Persistence: pocUserId + workStatus + (WFH-only) unavailability
 *     round-trip through raw SQL inserts and selects.
 *   • FK behaviour: deleting the POC user nulls out pocUserId on every
 *     row (ON DELETE SET NULL) — historical leave records survive.
 *
 *   npx tsx scripts/_test-handoff-fields.ts
 */
process.env.EMAIL_DRY_RUN = "true";

import { PrismaClient } from "@prisma/client";
import { checkPastDateAllowed, istTodayIso } from "../src/lib/hr/leave-date-rules";

const prisma = new PrismaClient();
const TEST_PREFIX = "audit-test+handoff-";
const TEST_DOMAIN = "@local.test";

type Status = "PASS" | "FAIL";
const results: { name: string; status: Status; evidence: string }[] = [];
const expect = (cond: boolean): Status => (cond ? "PASS" : "FAIL");
function record(name: string, status: Status, evidence: string) {
  results.push({ name, status, evidence });
}

/**
 * The remote Postgres at 69.62.79.231 is currently flaky — connections
 * intermittently fail (P1001). Retry up to 5 times with a short
 * backoff so a transient blip doesn't kill the test run.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e: any) {
      if (i === attempts - 1) throw e;
      const isP1001 = e?.code === "P1001" || String(e?.message || "").includes("Can't reach database");
      if (!isP1001) throw e;
      const wait = 1000 * (i + 1);
      console.log(`  ↻ ${label} hit P1001, retrying in ${wait}ms…`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw new Error("unreachable");
}

async function teardown() {
  // Explicit cleanup — even though User has onDelete:Cascade on the
  // primary userId FK of every request table, the test creates rows
  // where the SAME test user appears as `pocUserId` on others. The POC
  // FK is SetNull (not Cascade), but if a prior run was interrupted
  // mid-flight we may have rows lingering that need clearing first.
  const ids = (await prisma.user.findMany({
    where: { email: { startsWith: TEST_PREFIX } },
    select: { id: true },
  })).map(u => u.id);
  if (ids.length === 0) return;
  // Typed client may not yet know about pocUserId (Windows DLL lock
  // blocks regen on the dev box) — cast the where clause to `any`.
  await prisma.leaveApplication.deleteMany({ where: ({ OR: [{ userId: { in: ids } }, { pocUserId: { in: ids } }] } as any) });
  await prisma.wFHRequest.deleteMany({       where: ({ OR: [{ userId: { in: ids } }, { pocUserId: { in: ids } }] } as any) });
  await prisma.onDutyRequest.deleteMany({    where: ({ OR: [{ userId: { in: ids } }, { pocUserId: { in: ids } }] } as any) });
  await prisma.compOffRequest.deleteMany({   where: ({ OR: [{ userId: { in: ids } }, { pocUserId: { in: ids } }] } as any) });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  console.log(`╔═══════════════════════════════════════════════════════════════════╗`);
  console.log(`║ Integration test: Handoff Details + date rules                    ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════╝`);

  await teardown();

  try {
    const today = istTodayIso();
    const yesterday = (() => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    const tomorrow = (() => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    })();

    // ── 1. Past-date gate matrix ───────────────────────────────────
    const cases: Array<{ label: string; user: any; date: string; expectBlocked: boolean }> = [
      // Regular user — past blocked, today + future allowed.
      { label: "member + past",             user: { orgLevel: "member" },                                   date: yesterday, expectBlocked: true  },
      { label: "member + today",            user: { orgLevel: "member" },                                   date: today,     expectBlocked: false },
      { label: "member + future",           user: { orgLevel: "member" },                                   date: tomorrow,  expectBlocked: false },
      // Restricted-admin tier — past ALWAYS allowed.
      { label: "CEO + past",                user: { orgLevel: "ceo" },                                      date: yesterday, expectBlocked: false },
      { label: "isDeveloper + past",        user: { orgLevel: "member", isDeveloper: true },                date: yesterday, expectBlocked: false },
      { label: "role=hr_manager + past",    user: { orgLevel: "hr_manager", role: "hr_manager" },           date: yesterday, expectBlocked: false },
      // Explicitly NOT in the restricted-admin tier.
      { label: "special_access + past",     user: { orgLevel: "special_access" },                           date: yesterday, expectBlocked: true  },
      { label: "role=admin + past",         user: { orgLevel: "member", role: "admin" },                    date: yesterday, expectBlocked: true  },
      { label: "HR Member orgLevel + past", user: { orgLevel: "hr_manager" },                               date: yesterday, expectBlocked: true  },
      // Edge: null/empty inputs.
      { label: "null date + member",        user: { orgLevel: "member" },                                   date: "",        expectBlocked: false },
    ];
    for (const c of cases) {
      const err = checkPastDateAllowed(c.date || null, c.user);
      const blocked = err !== null;
      record(
        `checkPastDateAllowed(${c.label}) → ${c.expectBlocked ? "BLOCKED" : "ALLOWED"}`,
        expect(blocked === c.expectBlocked),
        `blocked=${blocked} expected=${c.expectBlocked} err="${err ?? ""}"`,
      );
    }

    // ── 2. Schema columns exist on all four tables ────────────────
    type ColRow = { column_name: string };
    async function cols(table: string): Promise<Set<string>> {
      const rows = await prisma.$queryRawUnsafe<ColRow[]>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
        table,
      );
      return new Set(rows.map(r => r.column_name));
    }
    const leaveCols = await cols("LeaveApplication");
    record(
      "LeaveApplication has pocUserId + workStatus columns",
      expect(leaveCols.has("pocUserId") && leaveCols.has("workStatus")),
      `pocUserId=${leaveCols.has("pocUserId")} workStatus=${leaveCols.has("workStatus")}`,
    );
    const wfhCols = await cols("WFHRequest");
    record(
      "WFHRequest has pocUserId + workStatus + unavailability columns",
      expect(wfhCols.has("pocUserId") && wfhCols.has("workStatus") && wfhCols.has("unavailability")),
      `pocUserId=${wfhCols.has("pocUserId")} workStatus=${wfhCols.has("workStatus")} unavailability=${wfhCols.has("unavailability")}`,
    );
    const odCols = await cols("OnDutyRequest");
    record(
      "OnDutyRequest has pocUserId + workStatus columns",
      expect(odCols.has("pocUserId") && odCols.has("workStatus")),
      `pocUserId=${odCols.has("pocUserId")} workStatus=${odCols.has("workStatus")}`,
    );
    const coCols = await cols("CompOffRequest");
    record(
      "CompOffRequest has pocUserId + workStatus columns",
      expect(coCols.has("pocUserId") && coCols.has("workStatus")),
      `pocUserId=${coCols.has("pocUserId")} workStatus=${coCols.has("workStatus")}`,
    );

    // ── 3. Persistence round-trip ─────────────────────────────────
    // Two users — one is the applicant, the other is their POC.
    const applicant = await prisma.user.create({
      data: {
        name: "Test Applicant", email: `${TEST_PREFIX}applicant${TEST_DOMAIN}`,
        role: "member", orgLevel: "member",
        clickupUserId: BigInt(9_900_900_000 + Date.now()),
        isActive: true,
      },
    });
    const poc = await prisma.user.create({
      data: {
        name: "Test POC", email: `${TEST_PREFIX}poc${TEST_DOMAIN}`,
        role: "member", orgLevel: "member",
        clickupUserId: BigInt(9_900_900_500 + Date.now()),
        isActive: true,
      },
    });

    // Need a leave type for the LeaveApplication insert. Use first
    // applicable one in the DB — every dev env seeds at least Casual.
    const leaveType = await prisma.leaveType.findFirst({ where: { isActive: true, applicable: true } });
    if (!leaveType) {
      throw new Error("Need at least one applicable LeaveType to run this test.");
    }

    // Leave — explicit ::date casts because Prisma's raw queries pass
    // every string as TEXT by default and Postgres won't auto-coerce
    // into the DATE column.
    const lvId = (await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `INSERT INTO "LeaveApplication"
         ("userId", "leaveTypeId", "fromDate", "toDate", "totalDays", reason,
          "pocUserId", "workStatus", "updatedAt")
       VALUES ($1, $2, $3::date, $4::date, 1, 'Test leave', $5, 'Pending tasks: A, B, C', now())
       RETURNING id`,
      applicant.id, leaveType.id, tomorrow, tomorrow, poc.id,
    ))[0].id;
    const lv = (await prisma.$queryRawUnsafe<Array<{ pocUserId: number; workStatus: string }>>(
      `SELECT "pocUserId", "workStatus" FROM "LeaveApplication" WHERE id = $1`, lvId,
    ))[0];
    record(
      "Leave: pocUserId + workStatus round-trip",
      expect(lv.pocUserId === poc.id && lv.workStatus === "Pending tasks: A, B, C"),
      `pocUserId=${lv.pocUserId} workStatus="${lv.workStatus}"`,
    );

    // WFH
    const wfhId = (await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `INSERT INTO "WFHRequest"
         ("userId", date, reason, "pocUserId", "workStatus", "unavailability", "updatedAt")
       VALUES ($1, $2::date, 'Plumber visit', $3, 'Brand video edit 80%', '2-4 PM for pickup', now())
       RETURNING id`,
      applicant.id, today, poc.id,
    ))[0].id;
    const wfh = (await prisma.$queryRawUnsafe<Array<{ pocUserId: number; workStatus: string; unavailability: string }>>(
      `SELECT "pocUserId", "workStatus", "unavailability" FROM "WFHRequest" WHERE id = $1`, wfhId,
    ))[0];
    record(
      "WFH: pocUserId + workStatus + unavailability round-trip",
      expect(wfh.pocUserId === poc.id && wfh.workStatus.startsWith("Brand") && wfh.unavailability === "2-4 PM for pickup"),
      `pocUserId=${wfh.pocUserId} workStatus="${wfh.workStatus}" unavailability="${wfh.unavailability}"`,
    );

    // OnDuty
    const odId = (await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `INSERT INTO "OnDutyRequest"
         ("userId", date, purpose, "pocUserId", "workStatus", "updatedAt")
       VALUES ($1, $2::date, 'Client meeting', $3, 'KPI deck draft', now())
       RETURNING id`,
      applicant.id, today, poc.id,
    ))[0].id;
    const od = (await prisma.$queryRawUnsafe<Array<{ pocUserId: number; workStatus: string }>>(
      `SELECT "pocUserId", "workStatus" FROM "OnDutyRequest" WHERE id = $1`, odId,
    ))[0];
    record(
      "OnDuty: pocUserId + workStatus round-trip",
      expect(od.pocUserId === poc.id && od.workStatus === "KPI deck draft"),
      `pocUserId=${od.pocUserId} workStatus="${od.workStatus}"`,
    );

    // CompOff
    const coId = (await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `INSERT INTO "CompOffRequest"
         ("userId", "workedDate", reason, "pocUserId", "workStatus", "updatedAt")
       VALUES ($1, $2::date, 'Saturday on-call', $3, 'Bug-fix work', now())
       RETURNING id`,
      applicant.id, yesterday, poc.id,
    ))[0].id;
    const co = (await prisma.$queryRawUnsafe<Array<{ pocUserId: number; workStatus: string }>>(
      `SELECT "pocUserId", "workStatus" FROM "CompOffRequest" WHERE id = $1`, coId,
    ))[0];
    record(
      "CompOff: pocUserId + workStatus round-trip",
      expect(co.pocUserId === poc.id && co.workStatus === "Bug-fix work"),
      `pocUserId=${co.pocUserId} workStatus="${co.workStatus}"`,
    );

    // ── 4. FK ON DELETE SET NULL ─────────────────────────────────
    // Deleting the POC user must NOT cascade-delete the requests.
    // pocUserId on each existing row should drop to NULL.
    await prisma.user.delete({ where: { id: poc.id } });
    const after = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ pocUserId: number | null }>>(`SELECT "pocUserId" FROM "LeaveApplication" WHERE id = $1`, lvId),
      prisma.$queryRawUnsafe<Array<{ pocUserId: number | null }>>(`SELECT "pocUserId" FROM "WFHRequest"        WHERE id = $1`, wfhId),
      prisma.$queryRawUnsafe<Array<{ pocUserId: number | null }>>(`SELECT "pocUserId" FROM "OnDutyRequest"     WHERE id = $1`, odId),
      prisma.$queryRawUnsafe<Array<{ pocUserId: number | null }>>(`SELECT "pocUserId" FROM "CompOffRequest"    WHERE id = $1`, coId),
    ]);
    const allNull = after.every(rows => rows[0]?.pocUserId === null);
    record(
      "Deleting POC user → pocUserId NULLED on every existing row (SET NULL)",
      expect(allNull),
      `Leave=${after[0][0]?.pocUserId} WFH=${after[1][0]?.pocUserId} OD=${after[2][0]?.pocUserId} CompOff=${after[3][0]?.pocUserId}`,
    );
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
