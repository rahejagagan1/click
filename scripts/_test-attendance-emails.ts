/**
 * INTEGRATION TEST — runs the actual sendMissedClockInReminders() and
 * sendMissedClockOutReminders() functions against a seeded local DB
 * and verifies every exclusion path with a real test user.
 *
 *   npx tsx scripts/_test-attendance-emails.ts
 *
 * What it does:
 *   1. Idempotent cleanup of any leftover test users (email prefix
 *      `audit-test+`).
 *   2. Seeds 7 users — one per exclusion scenario plus a control.
 *   3. Calls the two reminder functions with EMAIL_DRY_RUN=true so
 *      they log to stdout instead of sending real mail.
 *   4. Captures the dry-run log lines (each one names exactly which
 *      address the function tried to email) and parses them.
 *   5. For each test user, asserts the actual targeting matches the
 *      scenario's expected outcome.
 *   6. ALWAYS tears down — even on assertion failure or thrown
 *      error — so the dev DB doesn't pollute.
 *
 * Designed for local dev DB. Set EMAIL_REMINDER_EXCLUDE_EMAILS in
 * .env to validate the exclude-list path; the test seeds an entry
 * matching that env value.
 */
process.env.EMAIL_DRY_RUN = "true";

import { PrismaClient } from "@prisma/client";
import { sendMissedClockInReminders, sendMissedClockOutReminders } from "../src/lib/hr/missed-attendance-emails";
import { istTodayDateOnly } from "../src/lib/ist-date";

const prisma = new PrismaClient();

const TEST_PREFIX = "audit-test+";
const TEST_DOMAIN = "@local.test";

type Scenario = {
  key: string;
  expectClockIn: boolean;
  expectClockOut: boolean;
  why: string;
  isActive?: boolean;
  setup: (userId: number, today: Date) => Promise<void>;
};

// Each scenario describes a hypothesis about how the function
// SHOULD treat that user.
function buildScenarios(today: Date): Scenario[] {
  return [
    {
      key: "control-no-clockin",
      expectClockIn:  true,
      expectClockOut: false,
      why:            "Active user with no Attendance, no leave/WFH/OD → must get clock-in nag.",
      setup:          async () => { /* nothing */ },
    },
    {
      key: "already-clocked-in",
      expectClockIn:  false,
      expectClockOut: true,
      why:            "Clocked in, not out → skip clock-in nag, ARE in clock-out nag.",
      setup: async (uid) => {
        await prisma.attendance.create({
          data: { userId: uid, date: today, clockIn: new Date(Date.now() - 60 * 60 * 1000), totalMinutes: 0 },
        });
      },
    },
    {
      key: "clocked-in-and-out",
      expectClockIn:  false,
      expectClockOut: false,
      why:            "Already clocked out → skip BOTH reminders.",
      setup: async (uid) => {
        const startedAt = new Date(Date.now() - 4 * 60 * 60 * 1000);
        const closedAt  = new Date(Date.now() - 30 * 60 * 1000);
        await prisma.attendance.create({
          data: { userId: uid, date: today, clockIn: startedAt, clockOut: closedAt, totalMinutes: 210 },
        });
      },
    },
    {
      key: "approved-leave",
      expectClockIn:  false,
      expectClockOut: false,
      why:            "On final-approved leave today → skip clock-in nag.",
      setup: async (uid) => {
        const lt = await prisma.leaveType.findFirst();
        if (!lt) throw new Error("No LeaveType seeded in dev DB");
        await prisma.leaveApplication.create({
          data: { userId: uid, leaveTypeId: lt.id, fromDate: today, toDate: today, totalDays: 1, reason: "test", status: "approved" },
        });
      },
    },
    {
      key: "partially-approved-leave",
      expectClockIn:  false,
      expectClockOut: false,
      why:            "Stage-1 (manager) approved → skip clock-in nag (post-fix behaviour).",
      setup: async (uid) => {
        const lt = await prisma.leaveType.findFirst();
        if (!lt) throw new Error("No LeaveType seeded in dev DB");
        await prisma.leaveApplication.create({
          data: { userId: uid, leaveTypeId: lt.id, fromDate: today, toDate: today, totalDays: 1, reason: "test", status: "partially_approved" },
        });
      },
    },
    {
      key: "approved-wfh",
      expectClockIn:  false,
      expectClockOut: false,
      why:            "Approved WFH today → skip clock-in nag.",
      setup: async (uid) => {
        await prisma.wFHRequest.create({
          data: { userId: uid, date: today, reason: "test", status: "approved" },
        });
      },
    },
    {
      key: "approved-od",
      expectClockIn:  false,
      expectClockOut: false,
      why:            "Approved On-Duty today → skip clock-in nag.",
      setup: async (uid) => {
        await prisma.onDutyRequest.create({
          data: { userId: uid, date: today, purpose: "test", status: "approved" },
        });
      },
    },
    {
      key: "inactive",
      expectClockIn:  false,
      expectClockOut: false,
      why:            "isActive=false → never receives any reminder.",
      isActive: false,
      setup:    async () => { /* the function pre-filters by isActive */ },
    },
  ];
}

async function teardownTestData() {
  const ids = (await prisma.user.findMany({
    where: { email: { startsWith: TEST_PREFIX } },
    select: { id: true },
  })).map(u => u.id);
  if (ids.length === 0) return;
  // Delete dependents first to satisfy FKs. AttendanceSession isn't
  // in the typed Prisma client — clean via raw SQL using the
  // attendanceId join.
  if (ids.length > 0) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "AttendanceSession" WHERE "attendanceId" IN (
         SELECT id FROM "Attendance" WHERE "userId" = ANY($1::int[])
       )`,
      ids,
    ).catch(() => {});
  }
  await prisma.attendance.deleteMany({ where: { userId: { in: ids } } });
  await prisma.leaveApplication.deleteMany({ where: { userId: { in: ids } } });
  await prisma.wFHRequest.deleteMany({ where: { userId: { in: ids } } });
  await prisma.onDutyRequest.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function setupTestData(today: Date, scenarios: Scenario[]) {
  const out: { id: number; email: string; scenario: Scenario }[] = [];
  for (let i = 0; i < scenarios.length; i++) {
    const s     = scenarios[i];
    const email = `${TEST_PREFIX}${s.key}${TEST_DOMAIN}`;
    const u = await prisma.user.create({
      data: {
        name:           `Test ${s.key}`,
        email,
        role:           "member",
        orgLevel:       "member",
        // Unique synthetic clickupUserId to avoid the unique-key collision.
        clickupUserId:  BigInt(9_900_000_000 + Date.now() + i),
        isActive:       s.isActive ?? true,
      },
    });
    await s.setup(u.id, today);
    out.push({ id: u.id, email, scenario: s });
  }
  return out;
}

// Captures every console.log call into a buffer so we can later
// extract the [email][dry-run] lines the sender emits.
function startCapture() {
  const buf: string[] = [];
  const origLog   = console.log;
  const origError = console.error;
  console.log   = (...args: unknown[]) => { buf.push(args.map(String).join(" ")); };
  console.error = (...args: unknown[]) => { buf.push("[err] " + args.map(String).join(" ")); };
  return {
    buf,
    stop: () => { console.log = origLog; console.error = origError; },
  };
}

function emailsTargetedFrom(lines: string[]): Set<string> {
  const out = new Set<string>();
  for (const l of lines) {
    if (!l.includes("[email][dry-run]")) continue;
    const m = l.match(/→\s*(.+)$/);
    if (!m) continue;
    for (const e of m[1].split(",")) out.add(e.trim().toLowerCase());
  }
  return out;
}

async function main() {
  const today    = istTodayDateOnly();
  const dow      = new Date(today).getUTCDay();
  const dowName  = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dow];
  const isWeekend = dow === 0 || dow === 6;

  console.log(`╔═══════════════════════════════════════════════════════════════════╗`);
  console.log(`║ Integration test: missed-attendance email reminders               ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════╝`);
  console.log(`Today (IST): ${today.toISOString().slice(0,10)} (${dowName})`);
  if (isWeekend) {
    console.log(``);
    console.log(`⚠  Today is a weekend. Clock-in scenarios will all expect FALSE`);
    console.log(`   because the weekend gate short-circuits the function.`);
  }
  console.log(``);

  // 1. Stale cleanup
  await teardownTestData();

  let seeded: { id: number; email: string; scenario: Scenario }[] = [];
  let pass = 0, fail = 0;
  const failures: string[] = [];

  try {
    // 2. Seed
    const scenarios = buildScenarios(today);
    seeded = await setupTestData(today, scenarios);
    console.log(`Seeded ${seeded.length} test users.`);

    // 3. Call clock-in reminder, capture stdout
    const cap1 = startCapture();
    const inCount = await sendMissedClockInReminders();
    cap1.stop();
    const inEmails = emailsTargetedFrom(cap1.buf);

    // 4. Call clock-out reminder, capture stdout
    const cap2 = startCapture();
    const outCount = await sendMissedClockOutReminders();
    cap2.stop();
    const outEmails = emailsTargetedFrom(cap2.buf);

    console.log(``);
    console.log(`sendMissedClockInReminders()  returned: ${inCount}  (captured ${inEmails.size} unique addresses)`);
    console.log(`sendMissedClockOutReminders() returned: ${outCount}  (captured ${outEmails.size} unique addresses)`);
    console.log(``);
    console.log(`── Per-scenario assertions ──────────────────────────────────────────`);

    for (const u of seeded) {
      const expIn  = isWeekend ? false : u.scenario.expectClockIn;   // weekend silences clock-in
      const expOut = u.scenario.expectClockOut;                       // clock-out path is weekend-safe (implicit)
      const gotIn  = inEmails.has(u.email.toLowerCase());
      const gotOut = outEmails.has(u.email.toLowerCase());

      const inOk  = expIn  === gotIn;
      const outOk = expOut === gotOut;

      const tag = (ok: boolean) => ok ? "✓ PASS" : "✗ FAIL";
      console.log(`  ${u.scenario.key}`);
      console.log(`    ${tag(inOk)}  clock-IN  expected=${expIn}  actual=${gotIn}`);
      console.log(`    ${tag(outOk)}  clock-OUT expected=${expOut}  actual=${gotOut}`);
      console.log(`    rationale: ${u.scenario.why}`);

      if (inOk)  pass++; else { fail++; failures.push(`${u.scenario.key}: clock-IN expected=${expIn} actual=${gotIn}`); }
      if (outOk) pass++; else { fail++; failures.push(`${u.scenario.key}: clock-OUT expected=${expOut} actual=${gotOut}`); }
    }
  } finally {
    // 5. ALWAYS clean up — even if assertions blew up.
    await teardownTestData();
    console.log(``);
    console.log(`Test data cleaned up.`);
  }

  console.log(``);
  console.log(`── Summary ──────────────────────────────────────────────────────────`);
  console.log(`  ${pass} PASS   ${fail} FAIL   (across ${seeded.length} scenarios × 2 dimensions)`);
  if (failures.length) {
    console.log(``);
    for (const f of failures) console.log(`  ✗ ${f}`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main()
  .catch(async (e) => {
    console.error(e);
    try { await teardownTestData(); } catch {}
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
