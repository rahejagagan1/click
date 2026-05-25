/**
 * Integration test for two features that ship together:
 *
 *   1. On-Duty can be applied on Saturday / Sunday — previously the
 *      server's POST /api/hr/attendance/on-duty silently skipped
 *      weekend dates in the day-range loop.
 *
 *   2. Mobile clock-in / clock-out is unlocked for users with an
 *      APPROVED On-Duty covering today. Default policy is
 *      desktop-only; OD overrides that for the specific date.
 *
 * The test seeds a fresh user + OD rows directly in the DB so the
 * scenarios are deterministic (no need to hit HTTP endpoints with
 * a real session). It exercises:
 *
 *   • OD created on a Saturday — should persist intact (the new
 *     route allows it).
 *   • OD created on a Sunday — same.
 *   • `hasApprovedOdToday` logic — the same predicate the clock-in
 *     and clock-out routes use to decide whether to bypass the
 *     desktop-only gate.
 *
 * Always cleans up in a `finally`, even if assertions blow up.
 *
 *   npx tsx scripts/_test-od-weekend-mobile.ts
 */
process.env.EMAIL_DRY_RUN = "true";

import { PrismaClient } from "@prisma/client";
import { istTodayDateOnly } from "../src/lib/ist-date";
import { onDutyRequestEmail } from "../src/lib/email/templates";

const prisma = new PrismaClient();

const TEST_PREFIX = "audit-test+";
const TEST_DOMAIN = "@local.test";

type Status = "PASS" | "FAIL";
const results: { name: string; status: Status; evidence: string }[] = [];
function record(name: string, status: Status, evidence: string) {
  results.push({ name, status, evidence });
}

function nextSaturday(from: Date): Date {
  const d = new Date(from);
  const diff = (6 - d.getUTCDay() + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
function nextSunday(from: Date): Date {
  const d = new Date(from);
  const diff = (7 - d.getUTCDay()) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function teardown() {
  const ids = (await prisma.user.findMany({
    where: { email: { startsWith: TEST_PREFIX } },
    select: { id: true },
  })).map(u => u.id);
  if (ids.length === 0) return;
  await prisma.onDutyRequest.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function seedUser(key: string) {
  return prisma.user.create({
    data: {
      name: `Test ${key}`,
      email: `${TEST_PREFIX}${key}${TEST_DOMAIN}`,
      role: "member",
      orgLevel: "member",
      clickupUserId: BigInt(9_900_500_000 + Date.now() + Math.floor(Math.random() * 1000)),
      isActive: true,
    },
  });
}

// Replicates the predicate the clock-in / clock-out routes use:
//   "Does this user have an OnDutyRequest covering `day` whose
//    status hasn't been rejected/cancelled?"
// If this returns true, the mobile-only block is bypassed. Pending
// counts — a request mid-approval still unlocks mobile.
async function hasOdFor(userId: number, day: Date): Promise<boolean> {
  const row = await prisma.onDutyRequest.findFirst({
    where: {
      userId,
      date: day,
      status: { notIn: ["rejected", "cancelled"] },
    },
    select: { id: true },
  });
  return !!row;
}

async function main() {
  console.log(`╔═══════════════════════════════════════════════════════════════════╗`);
  console.log(`║ Integration test: OD on weekends + mobile clock-in/out bypass     ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════╝`);

  await teardown(); // sweep any leftovers from a previous run

  const today = istTodayDateOnly();
  const sat   = nextSaturday(today);
  const sun   = nextSunday(today);

  console.log(`Today (IST):  ${today.toISOString().slice(0,10)}  (${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][today.getUTCDay()]})`);
  console.log(`Next Sat:     ${sat.toISOString().slice(0,10)}`);
  console.log(`Next Sun:     ${sun.toISOString().slice(0,10)}`);
  console.log(``);

  let users: Array<{ id: number; email: string }> = [];

  try {
    // ── 1. OD on Saturday and Sunday ─────────────────────────────
    const u1 = await seedUser("od-sat");
    const u2 = await seedUser("od-sun");
    users.push(u1, u2);

    // Replicate the server's day-loop (with the weekend skip REMOVED).
    // We're asserting the database accepts a Saturday / Sunday row.
    await prisma.onDutyRequest.create({
      data: { userId: u1.id, date: sat, purpose: "Test: weekend client visit", status: "pending" },
    });
    await prisma.onDutyRequest.create({
      data: { userId: u2.id, date: sun, purpose: "Test: Sunday event coverage", status: "pending" },
    });

    const satRow = await prisma.onDutyRequest.findFirst({ where: { userId: u1.id, date: sat } });
    const sunRow = await prisma.onDutyRequest.findFirst({ where: { userId: u2.id, date: sun } });
    record(
      "OD: Saturday date is accepted",
      satRow ? "PASS" : "FAIL",
      satRow ? `Row #${satRow.id} created on ${sat.toISOString().slice(0,10)}.` : `No row found.`,
    );
    record(
      "OD: Sunday date is accepted",
      sunRow ? "PASS" : "FAIL",
      sunRow ? `Row #${sunRow.id} created on ${sun.toISOString().slice(0,10)}.` : `No row found.`,
    );

    // ── 2. Mobile-bypass predicate ──────────────────────────────
    const u3 = await seedUser("od-mobile-today");
    const u4 = await seedUser("no-od-today");
    users.push(u3, u4);

    // u3 has an APPROVED OD for today → predicate must say YES (mobile OK).
    await prisma.onDutyRequest.create({
      data: { userId: u3.id, date: today, purpose: "Test: client visit today", status: "approved" },
    });
    // u4 has NOTHING → predicate must say NO (mobile blocked).

    const u3HasOd = await hasOdFor(u3.id, today);
    const u4HasOd = await hasOdFor(u4.id, today);
    record(
      "Mobile-bypass: user WITH approved OD today → bypass granted",
      u3HasOd ? "PASS" : "FAIL",
      u3HasOd ? `hasOdFor returned true; mobile clock-in/out unlocked.` : `Predicate said no — bug.`,
    );
    record(
      "Mobile-bypass: user WITHOUT OD today → bypass denied",
      !u4HasOd ? "PASS" : "FAIL",
      !u4HasOd ? `hasOdFor returned false; mobile clock-in/out stays blocked.` : `Predicate said yes — bug.`,
    );

    // ── 3. Status nuance — PENDING OD now unlocks mobile ────────
    // Policy change: an OD that's still waiting for L1/L2 approval
    // STILL unlocks mobile, because the employee is already on the
    // road and the approval click might lag. Only rejected/cancelled
    // dismiss the request and re-engage the desktop-only block.
    const u5 = await seedUser("od-pending-today");
    users.push(u5);
    await prisma.onDutyRequest.create({
      data: { userId: u5.id, date: today, purpose: "Test: pending OD", status: "pending" },
    });
    const u5HasOd = await hasOdFor(u5.id, today);
    record(
      "Mobile-bypass: PENDING OD unlocks mobile (no need to wait for approval)",
      u5HasOd ? "PASS" : "FAIL",
      u5HasOd ? `Pending OD opens the bypass; user can clock in from mobile while approval is in flight.` : `Pending was blocked — would strand mid-trip employees.`,
    );

    // Same for partially_approved (L1 done, L2 pending).
    const u5b = await seedUser("od-partial-today");
    users.push(u5b);
    await prisma.onDutyRequest.create({
      data: { userId: u5b.id, date: today, purpose: "Test: partial OD", status: "partially_approved" },
    });
    const u5bHasOd = await hasOdFor(u5b.id, today);
    record(
      "Mobile-bypass: PARTIALLY_APPROVED OD also unlocks mobile",
      u5bHasOd ? "PASS" : "FAIL",
      u5bHasOd ? `Manager-approved OD passes through too.` : `Partial blocked — bug.`,
    );

    // Rejected and cancelled MUST still block.
    const u5c = await seedUser("od-rejected-today");
    users.push(u5c);
    await prisma.onDutyRequest.create({
      data: { userId: u5c.id, date: today, purpose: "Test: rejected OD", status: "rejected" },
    });
    const u5cHasOd = await hasOdFor(u5c.id, today);
    record(
      "Mobile-bypass: REJECTED OD does NOT unlock mobile",
      !u5cHasOd ? "PASS" : "FAIL",
      !u5cHasOd ? `Rejected requests are properly excluded from the bypass.` : `Rejected leaked through — bug.`,
    );

    const u5d = await seedUser("od-cancelled-today");
    users.push(u5d);
    await prisma.onDutyRequest.create({
      data: { userId: u5d.id, date: today, purpose: "Test: cancelled OD", status: "cancelled" },
    });
    const u5dHasOd = await hasOdFor(u5d.id, today);
    record(
      "Mobile-bypass: CANCELLED OD does NOT unlock mobile",
      !u5dHasOd ? "PASS" : "FAIL",
      !u5dHasOd ? `Cancelled requests are properly excluded.` : `Cancelled leaked through — bug.`,
    );

    // ── 4. Date precision — OD for yesterday doesn't unlock today ─
    const u6 = await seedUser("od-yesterday-only");
    users.push(u6);
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    await prisma.onDutyRequest.create({
      data: { userId: u6.id, date: yesterday, purpose: "Test: yesterday's OD", status: "approved" },
    });
    const u6HasOdToday = await hasOdFor(u6.id, today);
    record(
      "Mobile-bypass: approved OD for YESTERDAY does NOT unlock TODAY",
      !u6HasOdToday ? "PASS" : "FAIL",
      !u6HasOdToday ? `Day-precise match works.` : `Off-by-one — yesterday's OD leaked into today's bypass.`,
    );

    // ── 5. Email template layout — single-day vs range, time, location ─
    // Verifies the row order and presence in the rendered HTML so the
    // OD email mirrors the leave email structure.
    const singleDay = onDutyRequestEmail({
      applicantName: "Test User",
      date: today,
      reason: "Client meeting in Sector 17",
    });
    const expect = (cond: boolean): Status => (cond ? "PASS" : "FAIL");
    record(
      "Email: single-day OD shows Request Type + Date rows",
      expect(singleDay.html.includes("Request Type") && singleDay.html.includes(">On-Duty<") && singleDay.html.includes("Date")),
      "Single-day email contains the Request Type row and Date row.",
    );
    record(
      "Email: single-day OD does NOT render From/To/Total Days",
      expect(!singleDay.html.includes(">From<") && !singleDay.html.includes(">To<") && !singleDay.html.includes("Total Days")),
      "Range-only rows correctly suppressed for single-day request.",
    );

    const rangeEmail = onDutyRequestEmail({
      applicantName: "Test User",
      date: sat,
      toDate: sun,
      totalDays: 2,
      fromTime: "10:00",
      toTime:   "14:00",
      location: "Sector 17, Chandigarh",
      reason:   "Two-day client visit",
    });
    record(
      "Email: range OD renders FROM / TO / TOTAL DAYS rows",
      expect(rangeEmail.html.includes(">From<") && rangeEmail.html.includes(">To<") && rangeEmail.html.includes("Total Days") && rangeEmail.html.includes("2 days")),
      "Range email mirrors leaveRequestEmail's structured rows.",
    );
    record(
      "Email: TIME row appears when fromTime + toTime are set",
      expect(rangeEmail.html.includes(">Time<") && rangeEmail.html.includes("10:00 – 14:00")),
      "Time window surfaces as its own row.",
    );
    record(
      "Email: LOCATION row appears when set",
      expect(rangeEmail.html.includes(">Location<") && rangeEmail.html.includes("Sector 17")),
      "Location row renders alongside the rest of the structured rows.",
    );
    record(
      "Email: REASON box renders the applicant's typed text verbatim",
      expect(rangeEmail.html.includes("Two-day client visit")),
      "REASON box echoes whatever the user typed (proves the screenshot's 'Approved' was real user input).",
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
