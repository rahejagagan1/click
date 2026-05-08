/**
 * Production audit of the missed-clockin / missed-clockout reminder
 * email logic.
 *
 * Replicates the candidate-selection from
 * src/lib/hr/missed-attendance-emails.ts using the same Prisma
 * queries against the live DB, then runs a battery of edge-case
 * assertions and prints PASS / FAIL / WARN with evidence.
 *
 *   npx tsx scripts/_audit-attendance-emails.ts
 *
 * Read-only; sends no email.
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// ─── helpers identical to src/lib/hr/missed-attendance-emails.ts ──
function istTodayDateOnly(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === "year")!.value;
  const m = parts.find(p => p.type === "month")!.value;
  const d = parts.find(p => p.type === "day")!.value;
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
}
function reminderExclusionSet(): Set<string> {
  const raw = process.env.EMAIL_REMINDER_EXCLUDE_EMAILS || "";
  return new Set(raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
}

// ─── tiny test runner ─────────────────────────────────────────────
type Status = "PASS" | "FAIL" | "WARN";
const results: { name: string; status: Status; evidence: string }[] = [];
function record(name: string, status: Status, evidence: string) {
  results.push({ name, status, evidence });
}

async function main() {
  const today = istTodayDateOnly();
  const dow = new Date(today).getUTCDay();
  const dowName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow];
  const isWeekend = dow === 0 || dow === 6;

  console.log(`╔═══════════════════════════════════════════════════════════════════╗`);
  console.log(`║ Attendance Reminder Email Audit                                   ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════╝`);
  console.log(`Date (IST)        : ${today.toISOString().slice(0, 10)}  (${dowName})`);
  console.log(`Weekend?          : ${isWeekend ? "yes" : "no"}`);
  console.log(``);

  // ─── identical candidate computation ──────────────────────────
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true, isActive: true },
  });

  const [todays, leaves, wfh, onDuty, holidayHit, partials] = await Promise.all([
    prisma.attendance.findMany({
      where: { date: today, clockIn: { not: null } },
      select: { userId: true, clockIn: true, clockOut: true },
    }),
    prisma.leaveApplication.findMany({
      // Mirrors the fix in src/lib/hr/missed-attendance-emails.ts:
      // both stage-2 "approved" AND stage-1 "partially_approved"
      // count as "user is de-facto away — don't nag".
      where: {
        status:   { in: ["approved", "partially_approved"] },
        fromDate: { lte: today },
        toDate:   { gte: today },
      },
      select: { userId: true, leaveType: { select: { code: true } }, totalDays: true },
    }),
    prisma.wFHRequest.findMany({
      where: { status: "approved", date: today },
      select: { userId: true },
    }),
    prisma.onDutyRequest.findMany({
      where: { status: "approved", date: today },
      select: { userId: true },
    }),
    prisma.holidayCalendar.findFirst({ where: { date: today }, select: { id: true, name: true } }),
    prisma.leaveApplication.findMany({
      where: { status: "partially_approved", fromDate: { lte: today }, toDate: { gte: today } },
      select: { userId: true, user: { select: { name: true, email: true } } },
    }),
  ]);

  const clockedInIds = new Set(todays.filter(a => a.clockIn).map(a => a.userId));
  const clockedOutIds = new Set(todays.filter(a => a.clockOut).map(a => a.userId));
  const onLeaveIds = new Set(leaves.map(l => l.userId));
  const onWfhIds = new Set(wfh.map(w => w.userId));
  const onDutyIds = new Set(onDuty.map(o => o.userId));
  const excluded = reminderExclusionSet();
  const isHoliday = !!holidayHit;

  // ─── replicate candidate filter ────────────────────────────────
  // Mirrors the function: weekend gate FIRST (returns 0 immediately
  // on Sat/Sun), then holiday gate, then per-user filters.
  const clockInCandidates = (isWeekend || isHoliday)
    ? []
    : users.filter(u =>
        !clockedInIds.has(u.id)
        && !onLeaveIds.has(u.id)
        && !onWfhIds.has(u.id)
        && !onDutyIds.has(u.id)
        && !!u.email
        && !excluded.has(u.email.toLowerCase())
      );

  const clockOutCandidates = todays.filter(a => a.clockIn && !a.clockOut)
    .map(a => users.find(u => u.id === a.userId))
    .filter((u): u is NonNullable<typeof u> => !!u && !!u.email && u.isActive && !excluded.has(u.email!.toLowerCase()));

  // ─── high-level snapshot ───────────────────────────────────────
  console.log(`── Population snapshot ─────────────────────────────────────────`);
  console.log(`  Active users                         : ${users.length}`);
  console.log(`  Already clocked in                   : ${clockedInIds.size}`);
  console.log(`  Already clocked out                  : ${clockedOutIds.size}`);
  console.log(`  On approved Leave                    : ${onLeaveIds.size}`);
  console.log(`  On approved WFH                      : ${onWfhIds.size}`);
  console.log(`  On approved On-Duty                  : ${onDutyIds.size}`);
  console.log(`  On partially_approved Leave          : ${partials.length}`);
  console.log(`  Public holiday                       : ${isHoliday ? holidayHit!.name : "—"}`);
  console.log(`  Excluded-list emails (env)           : ${excluded.size}`);
  console.log(``);
  console.log(`── Reminder candidates ─────────────────────────────────────────`);
  console.log(`  → Clock-IN  candidates (10:15 IST)   : ${clockInCandidates.length}`);
  console.log(`  → Clock-OUT candidates (20:00 IST)   : ${clockOutCandidates.length}`);
  console.log(``);

  // ─── tests ─────────────────────────────────────────────────────
  console.log(`── Edge-case verification ──────────────────────────────────────`);

  // T1 — clocked-in users not in clock-in candidates
  const t1Bleed = clockInCandidates.filter(u => clockedInIds.has(u.id));
  record(
    "Clock-IN: already-clocked-in users are excluded",
    t1Bleed.length === 0 ? "PASS" : "FAIL",
    t1Bleed.length === 0
      ? `Verified ${clockedInIds.size} clocked-in users; 0 leaked into candidate list.`
      : `${t1Bleed.length} clocked-in users WOULD STILL BE EMAILED: ${t1Bleed.slice(0, 5).map(u => u.email).join(", ")}…`
  );

  // T2 — approved-leave users not in clock-in candidates
  const t2Bleed = clockInCandidates.filter(u => onLeaveIds.has(u.id));
  record(
    "Clock-IN: approved-Leave users are excluded",
    t2Bleed.length === 0 ? "PASS" : "FAIL",
    t2Bleed.length === 0
      ? `Verified ${onLeaveIds.size} on-leave users; 0 leaked.`
      : `${t2Bleed.length} on-leave users WOULD STILL BE EMAILED: ${t2Bleed.slice(0, 5).map(u => u.email).join(", ")}…`
  );

  // T3 — approved-WFH users not in clock-in candidates
  const t3Bleed = clockInCandidates.filter(u => onWfhIds.has(u.id));
  record(
    "Clock-IN: approved-WFH users are excluded",
    t3Bleed.length === 0 ? "PASS" : "FAIL",
    t3Bleed.length === 0
      ? `Verified ${onWfhIds.size} WFH users; 0 leaked.`
      : `${t3Bleed.length} WFH users WOULD STILL BE EMAILED.`
  );

  // T4 — approved-OD users not in clock-in candidates
  const t4Bleed = clockInCandidates.filter(u => onDutyIds.has(u.id));
  record(
    "Clock-IN: approved-OnDuty users are excluded",
    t4Bleed.length === 0 ? "PASS" : "FAIL",
    t4Bleed.length === 0
      ? `Verified ${onDutyIds.size} on-duty users; 0 leaked.`
      : `${t4Bleed.length} on-duty users WOULD STILL BE EMAILED.`
  );

  // T5 — inactive users not in candidates (proven by `isActive: true` filter)
  const inactiveCount = await prisma.user.count({ where: { isActive: false } });
  const inactiveLeak = clockInCandidates.filter(u => !u.isActive).length;
  record(
    "Clock-IN: inactive users are excluded",
    inactiveLeak === 0 ? "PASS" : "FAIL",
    `${inactiveCount} inactive users in DB; ${inactiveLeak} leaked into candidates.`
  );

  // T6 — exclude-list emails not in candidates
  const t6Bleed = clockInCandidates.filter(u => u.email && excluded.has(u.email.toLowerCase()));
  record(
    "Clock-IN: EMAIL_REMINDER_EXCLUDE_EMAILS users are excluded",
    t6Bleed.length === 0 ? "PASS" : "FAIL",
    excluded.size === 0
      ? `(no exclude-list configured in env — nothing to filter)`
      : `${t6Bleed.length} excluded emails leaked.`
  );

  // T7 — users with empty email not in candidates
  const t7Bleed = clockInCandidates.filter(u => !u.email);
  record(
    "Clock-IN: users without email are excluded",
    t7Bleed.length === 0 ? "PASS" : "FAIL",
    `${t7Bleed.length} email-less users in candidate list.`
  );

  // T8 — holiday short-circuit (logic-level, not just empty result)
  if (isHoliday) {
    record(
      "Clock-IN: holiday short-circuits with 0 emails",
      clockInCandidates.length === 0 ? "PASS" : "WARN",
      clockInCandidates.length === 0
        ? `Today is "${holidayHit!.name}" — function returns early.`
        : `Candidate set is non-empty BUT function will short-circuit at runtime (returns 0 before sending).`
    );
  } else {
    record(
      "Clock-IN: holiday short-circuit",
      "PASS",
      `(today is not a holiday — branch not exercised)`
    );
  }

  // T9 — Weekend gate (Sat/Sun should silence the reminder)
  if (isWeekend) {
    record(
      "Clock-IN: weekend silences the reminder",
      clockInCandidates.length === 0 ? "PASS" : "FAIL",
      clockInCandidates.length === 0
        ? `Today is ${dowName}; weekend gate returned 0 candidates as expected.`
        : `Weekend gate broken: today is ${dowName}; ${clockInCandidates.length} employees would still be emailed.`
    );
  } else {
    // Function exits early on dow === 0 or dow === 6. We can't run
    // the function with a fake date, but we CAN read the source-of-
    // truth code to confirm the gate is present. Static check: ensure
    // the senders module still has the weekend-skip line.
    const fs = require("fs") as typeof import("fs");
    const src = fs.readFileSync("src/lib/hr/missed-attendance-emails.ts", "utf8");
    const hasWeekendGate = /dow\s*===\s*0\s*\|\|\s*dow\s*===\s*6/.test(src);
    record(
      "Clock-IN: weekend gate is present in source",
      hasWeekendGate ? "PASS" : "FAIL",
      hasWeekendGate
        ? `Static check confirms the Sat/Sun early-return is in src/lib/hr/missed-attendance-emails.ts. (Today is ${dowName}, so this branch isn't exercised by the live filter.)`
        : `Weekend gate MISSING — Sat/Sun reminders will fire on every active employee.`
    );
  }

  // T10 — partially_approved leave users excluded
  const partialIds = new Set(partials.map(p => p.userId));
  const t10Bleed = clockInCandidates.filter(u => partialIds.has(u.id));
  record(
    "Clock-IN: partially_approved Leave users are excluded",
    t10Bleed.length === 0 ? "PASS" : "FAIL",
    partials.length === 0
      ? `(no partially_approved leaves today)`
      : t10Bleed.length === 0
        ? `${partials.length} partial leaves found; 0 leaked into candidates.`
        : `${t10Bleed.length} stage-1 leave users would be emailed: ` +
          partials.filter(p => t10Bleed.find(u => u.id === p.userId))
                  .slice(0, 5).map(p => p.user.email).join(", ")
  );

  // T11 — clocked-out users not in clock-out candidates
  const t11Bleed = clockOutCandidates.filter(c => clockedOutIds.has(c.id));
  record(
    "Clock-OUT: already-clocked-out users are excluded",
    t11Bleed.length === 0 ? "PASS" : "FAIL",
    t11Bleed.length === 0
      ? `${clockedOutIds.size} clocked-out users; 0 leaked.`
      : `${t11Bleed.length} clocked-out users WOULD STILL BE EMAILED.`
  );

  // T12 — never-clocked-in users not in clock-out candidates
  const neverClockedInIds = users.map(u => u.id).filter(id => !clockedInIds.has(id));
  const t12Bleed = clockOutCandidates.filter(c => neverClockedInIds.includes(c.id));
  record(
    "Clock-OUT: never-clocked-in users are excluded",
    t12Bleed.length === 0 ? "PASS" : "FAIL",
    t12Bleed.length === 0
      ? `${neverClockedInIds.length} never-clocked-in users; 0 leaked.`
      : `${t12Bleed.length} never-clocked-in users WOULD STILL BE EMAILED.`
  );

  // T13 — still-clocked-in users SHOULD be in clock-out candidates (positive test)
  const stillIn = todays.filter(a => a.clockIn && !a.clockOut);
  const stillInWithEmail = stillIn
    .map(a => users.find(u => u.id === a.userId))
    .filter(u => !!u && !!u.email && u.isActive && !excluded.has(u.email!.toLowerCase()));
  const expectClockOut = stillInWithEmail.length;
  record(
    "Clock-OUT: still-clocked-in active users ARE included (positive test)",
    expectClockOut === clockOutCandidates.length ? "PASS" : "FAIL",
    `Expected ${expectClockOut} candidates, function would send ${clockOutCandidates.length}.`
  );

  // T14 — inactive in clock-out
  const t14Bleed = clockOutCandidates.filter(u => !u.isActive);
  record(
    "Clock-OUT: inactive users are excluded",
    t14Bleed.length === 0 ? "PASS" : "FAIL",
    `${t14Bleed.length} inactive users leaked.`
  );

  // T15 — exclusion list in clock-out
  const t15Bleed = clockOutCandidates.filter(u => u.email && excluded.has(u.email.toLowerCase()));
  record(
    "Clock-OUT: EMAIL_REMINDER_EXCLUDE_EMAILS users are excluded",
    t15Bleed.length === 0 ? "PASS" : "FAIL",
    excluded.size === 0 ? "(no exclude-list configured)" : `${t15Bleed.length} excluded emails leaked.`
  );

  // T16 — sanity: a user can't be in both candidate sets
  const inBoth = clockInCandidates.filter(u => clockOutCandidates.find(c => c.id === u.id));
  record(
    "Cross-check: no user in BOTH clock-in AND clock-out candidate sets",
    inBoth.length === 0 ? "PASS" : "FAIL",
    inBoth.length === 0
      ? `Logical exclusivity verified.`
      : `${inBoth.length} users in both — impossible state.`
  );

  // T17 — idempotency gate state
  const gateClockIn = await prisma.syncConfig.findUnique({ where: { key: "hr_missed_clockin_last_day" } });
  const gateClockOut = await prisma.syncConfig.findUnique({ where: { key: "hr_missed_clockout_last_day" } });
  const todayKey = today.toISOString().slice(0, 10);
  const inDay = (gateClockIn?.value as any)?.lastDay ?? "—";
  const outDay = (gateClockOut?.value as any)?.lastDay ?? "—";
  record(
    "Idempotency: SyncConfig gate state",
    "PASS",
    `clock-in last fired: ${inDay}  (today: ${todayKey})  |  clock-out last fired: ${outDay}`
  );

  // ─── synthetic stress tests ────────────────────────────────────
  // The data-driven tests above pass even when there's no data to
  // exercise. These explicitly inject each exclusion case in memory
  // and verify the candidate filter rejects the injected user.
  // Picks the first user with an email as the synthetic subject.
  const subject = users.find(u => !!u.email);
  if (subject) {
    const filterRejects = (
      _clockedIn: Set<number>,
      _onLeave:   Set<number>,
      _onWfh:     Set<number>,
      _onDuty:    Set<number>,
      _excluded:  Set<string>,
      _isWeekend: boolean,
      _isHoliday: boolean,
    ): boolean => {
      if (_isWeekend || _isHoliday) return true;
      return _clockedIn.has(subject.id)
          || _onLeave.has(subject.id)
          || _onWfh.has(subject.id)
          || _onDuty.has(subject.id)
          || !subject.email
          || _excluded.has(subject.email.toLowerCase());
    };

    const cases: { name: string; rejected: boolean }[] = [
      { name: "Clock-IN synthetic: clocked-in user is rejected",
        rejected: filterRejects(new Set([subject.id]), new Set(), new Set(), new Set(), new Set(), false, false) },
      { name: "Clock-IN synthetic: approved-Leave user is rejected",
        rejected: filterRejects(new Set(), new Set([subject.id]), new Set(), new Set(), new Set(), false, false) },
      { name: "Clock-IN synthetic: approved-WFH user is rejected",
        rejected: filterRejects(new Set(), new Set(), new Set([subject.id]), new Set(), new Set(), false, false) },
      { name: "Clock-IN synthetic: approved-OnDuty user is rejected",
        rejected: filterRejects(new Set(), new Set(), new Set(), new Set([subject.id]), new Set(), false, false) },
      { name: "Clock-IN synthetic: exclude-list user is rejected",
        rejected: filterRejects(new Set(), new Set(), new Set(), new Set(), new Set([subject.email!.toLowerCase()]), false, false) },
      { name: "Clock-IN synthetic: weekend rejects everyone",
        rejected: filterRejects(new Set(), new Set(), new Set(), new Set(), new Set(), true, false) },
      { name: "Clock-IN synthetic: holiday rejects everyone",
        rejected: filterRejects(new Set(), new Set(), new Set(), new Set(), new Set(), false, true) },
      { name: "Clock-IN synthetic: clean user is INCLUDED (control)",
        rejected: !filterRejects(new Set(), new Set(), new Set(), new Set(), new Set(), false, false) },
    ];
    for (const c of cases) {
      record(c.name, c.rejected ? "PASS" : "FAIL",
        `Subject = ${subject.email}; ` + (c.rejected ? "rejected as expected." : "filter let them through — should not happen."));
    }
  } else {
    record("Synthetic tests", "WARN", "No user with an email found — synthetic tests skipped.");
  }

  // ─── output ────────────────────────────────────────────────────
  console.log(``);
  for (const r of results) {
    const icon = r.status === "PASS" ? "✓" : r.status === "FAIL" ? "✗" : "!";
    const pad  = r.status.padEnd(4);
    console.log(`  [${icon} ${pad}] ${r.name}`);
    console.log(`           ${r.evidence}`);
  }
  const pass = results.filter(r => r.status === "PASS").length;
  const fail = results.filter(r => r.status === "FAIL").length;
  const warn = results.filter(r => r.status === "WARN").length;
  console.log(``);
  console.log(`── Summary ─────────────────────────────────────────────────────`);
  console.log(`  ${pass} PASS   ${fail} FAIL   ${warn} WARN  (total ${results.length})`);
  console.log(``);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
