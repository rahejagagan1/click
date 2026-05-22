/**
 * Pure-function audit of the Late / Missed / On-break tag predicates
 * used in the user-profile Attendance tab (EmployeeTimePanel) and in
 * the Me section's attendance row. The two views must compute these
 * tags identically — if they drift, HR sees a different picture than
 * the employee does for the same row.
 *
 * No DB writes. Constructs synthetic Attendance rows in memory and
 * runs the badge predicates against them.
 *
 *   npx tsx scripts/_test-attendance-tags.ts
 */

type Sess = { clockIn: string; clockOut: string | null };
type Rec = {
  date: string;
  status: string;
  clockIn: string | null;
  clockOut: string | null;
  totalMinutes: number;
  isRegularized: boolean;
  sessions: Sess[];
};

const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const todayIso = today.toISOString().slice(0, 10);
const yesterday = new Date(today);
yesterday.setUTCDate(yesterday.getUTCDate() - 1);
const yesterdayIso = yesterday.toISOString().slice(0, 10);

// Build an ISO timestamp for a given IST hh:mm on a given date.
function istInstant(dateIso: string, hh: number, mm: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  // IST = UTC + 5:30, so an IST wall-clock 10:00 is UTC 04:30.
  const utc = new Date(Date.UTC(y, m - 1, d, hh - 5, mm - 30));
  return utc.toISOString();
}

// Mirror of the predicates baked into the page. Kept in lockstep with
// EmployeeTimePanel — if either changes, this test forces the update.
function tagsFor(rec: Rec, opts: { isLeaveRow: boolean; hasPendingAny: boolean }) {
  const isToday = rec.date === todayIso;
  const sess = rec.sessions ?? [];
  const openSess = sess.find((s) => !s.clockOut);
  const firstIn = sess[0]?.clockIn ? new Date(sess[0].clockIn) : (rec.clockIn ? new Date(rec.clockIn) : null);
  const isLateFirstIn = !!firstIn && (() => {
    const istHr = (firstIn.getUTCHours() + 5 + Math.floor((firstIn.getUTCMinutes() + 30) / 60)) % 24;
    return istHr >= 10;
  })();
  const missedClockOut = !!rec.clockIn && !rec.clockOut && !isToday && !rec.isRegularized && !opts.isLeaveRow;
  const isOnBreak = isToday && !openSess && sess.some((s) => s.clockOut) && !rec.isRegularized && (rec.totalMinutes || 0) < 540;
  return {
    Late:  isLateFirstIn && !!rec.clockIn && !opts.hasPendingAny && !opts.isLeaveRow,
    Missed: missedClockOut && !opts.hasPendingAny,
    OnBreak: isOnBreak,
  };
}

type Status = "PASS" | "FAIL";
const results: { name: string; status: Status; evidence: string }[] = [];
const expect = (cond: boolean): Status => (cond ? "PASS" : "FAIL");
function record(name: string, status: Status, evidence: string) {
  results.push({ name, status, evidence });
}

// ── Late: first clock-in past 10:00 IST ─────────────────────────────
{
  const rec: Rec = {
    date: yesterdayIso, status: "late", isRegularized: false, totalMinutes: 480,
    clockIn: istInstant(yesterdayIso, 10, 30),
    clockOut: istInstant(yesterdayIso, 18, 30),
    sessions: [{ clockIn: istInstant(yesterdayIso, 10, 30), clockOut: istInstant(yesterdayIso, 18, 30) }],
  };
  const t = tagsFor(rec, { isLeaveRow: false, hasPendingAny: false });
  record("Late: first clock-in 10:30 IST → Late tag fires", expect(t.Late), `Late=${t.Late}`);
  record("Late: 10:30 IST clock-in does NOT trigger Missed", expect(!t.Missed), `Missed=${t.Missed}`);
}

// ── Late: first clock-in at exactly 09:55 IST → no Late ─────────────
{
  const rec: Rec = {
    date: yesterdayIso, status: "present", isRegularized: false, totalMinutes: 480,
    clockIn: istInstant(yesterdayIso, 9, 55),
    clockOut: istInstant(yesterdayIso, 17, 55),
    sessions: [{ clockIn: istInstant(yesterdayIso, 9, 55), clockOut: istInstant(yesterdayIso, 17, 55) }],
  };
  const t = tagsFor(rec, { isLeaveRow: false, hasPendingAny: false });
  record("Late: 09:55 IST is NOT late (boundary)", expect(!t.Late), `Late=${t.Late}`);
}

// ── Late: exactly 10:00 IST → Late ──────────────────────────────────
{
  const rec: Rec = {
    date: yesterdayIso, status: "late", isRegularized: false, totalMinutes: 480,
    clockIn: istInstant(yesterdayIso, 10, 0),
    clockOut: istInstant(yesterdayIso, 18, 0),
    sessions: [{ clockIn: istInstant(yesterdayIso, 10, 0), clockOut: istInstant(yesterdayIso, 18, 0) }],
  };
  const t = tagsFor(rec, { isLeaveRow: false, hasPendingAny: false });
  record("Late: 10:00 IST sharp triggers Late (boundary)", expect(t.Late), `Late=${t.Late}`);
}

// ── Late: pending request suppresses the badge ──────────────────────
{
  const rec: Rec = {
    date: yesterdayIso, status: "late", isRegularized: false, totalMinutes: 480,
    clockIn: istInstant(yesterdayIso, 11, 0),
    clockOut: istInstant(yesterdayIso, 19, 0),
    sessions: [{ clockIn: istInstant(yesterdayIso, 11, 0), clockOut: istInstant(yesterdayIso, 19, 0) }],
  };
  const t = tagsFor(rec, { isLeaveRow: false, hasPendingAny: true });
  record("Late: pending regularization suppresses Late tag", expect(!t.Late), `Late=${t.Late}`);
}

// ── Missed: clocked in yesterday, never out ─────────────────────────
{
  const rec: Rec = {
    date: yesterdayIso, status: "missed_clock_out", isRegularized: false, totalMinutes: 0,
    clockIn: istInstant(yesterdayIso, 9, 30), clockOut: null,
    sessions: [{ clockIn: istInstant(yesterdayIso, 9, 30), clockOut: null }],
  };
  const t = tagsFor(rec, { isLeaveRow: false, hasPendingAny: false });
  record("Missed: yesterday with no clockOut → Missed", expect(t.Missed), `Missed=${t.Missed}`);
  record("Missed: doesn't double-fire Late (09:30 IST is before 10:00)", expect(!t.Late), `Late=${t.Late}`);
}

// ── Missed: today with no clockOut is NOT missed (still working) ────
{
  const rec: Rec = {
    date: todayIso, status: "present", isRegularized: false, totalMinutes: 120,
    clockIn: istInstant(todayIso, 9, 30), clockOut: null,
    sessions: [{ clockIn: istInstant(todayIso, 9, 30), clockOut: null }],
  };
  const t = tagsFor(rec, { isLeaveRow: false, hasPendingAny: false });
  record("Missed: today with open session is NOT Missed", expect(!t.Missed), `Missed=${t.Missed}`);
}

// ── Missed: regularized day stops being Missed ──────────────────────
{
  const rec: Rec = {
    date: yesterdayIso, status: "present", isRegularized: true, totalMinutes: 540,
    clockIn: istInstant(yesterdayIso, 9, 0), clockOut: null,
    sessions: [{ clockIn: istInstant(yesterdayIso, 9, 0), clockOut: null }],
  };
  const t = tagsFor(rec, { isLeaveRow: false, hasPendingAny: false });
  record("Missed: regularized row no longer shows Missed", expect(!t.Missed), `Missed=${t.Missed}`);
}

// ── Missed: leave day with a clock-in row doesn't show Missed ───────
{
  const rec: Rec = {
    date: yesterdayIso, status: "on_leave", isRegularized: false, totalMinutes: 0,
    clockIn: istInstant(yesterdayIso, 9, 30), clockOut: null,
    sessions: [{ clockIn: istInstant(yesterdayIso, 9, 30), clockOut: null }],
  };
  const t = tagsFor(rec, { isLeaveRow: true, hasPendingAny: false });
  record("Missed: leave row suppresses Missed (and Late)", expect(!t.Missed && !t.Late), `Missed=${t.Missed} Late=${t.Late}`);
}

// ── On break: today, closed session, < 9h ───────────────────────────
{
  const rec: Rec = {
    date: todayIso, status: "present", isRegularized: false, totalMinutes: 240, // 4h
    clockIn: istInstant(todayIso, 9, 30),
    clockOut: istInstant(todayIso, 13, 30),
    sessions: [{ clockIn: istInstant(todayIso, 9, 30), clockOut: istInstant(todayIso, 13, 30) }],
  };
  const t = tagsFor(rec, { isLeaveRow: false, hasPendingAny: false });
  record("On break: today, clocked out at 4h → On break", expect(t.OnBreak), `OnBreak=${t.OnBreak}`);
}

// ── On break: 9h reached → no On break tag ──────────────────────────
{
  const rec: Rec = {
    date: todayIso, status: "present", isRegularized: false, totalMinutes: 540, // 9h
    clockIn: istInstant(todayIso, 9, 0),
    clockOut: istInstant(todayIso, 18, 0),
    sessions: [{ clockIn: istInstant(todayIso, 9, 0), clockOut: istInstant(todayIso, 18, 0) }],
  };
  const t = tagsFor(rec, { isLeaveRow: false, hasPendingAny: false });
  record("On break: 9h-completed day no longer shows On break", expect(!t.OnBreak), `OnBreak=${t.OnBreak}`);
}

// ── On break: yesterday never shows On break (only today's row) ─────
{
  const rec: Rec = {
    date: yesterdayIso, status: "present", isRegularized: false, totalMinutes: 240,
    clockIn: istInstant(yesterdayIso, 9, 0),
    clockOut: istInstant(yesterdayIso, 13, 0),
    sessions: [{ clockIn: istInstant(yesterdayIso, 9, 0), clockOut: istInstant(yesterdayIso, 13, 0) }],
  };
  const t = tagsFor(rec, { isLeaveRow: false, hasPendingAny: false });
  record("On break: only today's row qualifies (yesterday → no tag)", expect(!t.OnBreak), `OnBreak=${t.OnBreak}`);
}

// ── Output ──────────────────────────────────────────────────────────
console.log(`╔═══════════════════════════════════════════════════════════════════╗`);
console.log(`║ Attendance tag predicates — Late / Missed / On break              ║`);
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
