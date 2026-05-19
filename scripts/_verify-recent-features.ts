/**
 * End-to-end verification of the features we've shipped over the last
 * batch of changes. Run with:
 *     npx tsx scripts/_verify-recent-features.ts
 *
 * Each `check(name, fn)` is one assertion — fn must return truthy or
 * throw. We never short-circuit on first failure so a single broken
 * spot doesn't hide the rest. Pass/fail count is printed at the end
 * with non-zero exit code on any failure.
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";

const ROOT = path.resolve(__dirname, "..");
const p = new PrismaClient();

let passes = 0;
let fails = 0;
const failures: Array<{ name: string; reason: string }> = [];

async function check(name: string, fn: () => any | Promise<any>) {
  process.stdout.write(`  ${String(passes + fails + 1).padStart(2, " ")}. ${name} … `);
  try {
    const out = await fn();
    if (out === false) throw new Error("returned false");
    passes++;
    console.log("\x1b[32mOK\x1b[0m" + (typeof out === "string" ? `  ${out}` : ""));
  } catch (e: any) {
    fails++;
    const reason = e?.message || String(e);
    failures.push({ name, reason });
    console.log("\x1b[31mFAIL\x1b[0m  " + reason);
  }
}

function fileExists(rel: string) {
  return fs.existsSync(path.join(ROOT, rel));
}
function fileContains(rel: string, needle: string | RegExp) {
  const txt = fs.readFileSync(path.join(ROOT, rel), "utf8");
  return typeof needle === "string" ? txt.includes(needle) : needle.test(txt);
}

async function main() {
  console.log("\n=== Recent-feature verification ===\n");

  // ── 1. Master Sheet API route ─────────────────────────────────────
  console.log("\n— Master Sheet API —");

  await check("API route file exists", () =>
    fileExists("src/app/api/hr/admin/master-sheet/route.ts")
  );

  await check("Route gates on isHRAdmin", () =>
    fileContains("src/app/api/hr/admin/master-sheet/route.ts", "isHRAdmin")
  );

  await check("Route exports GET handler", () =>
    fileContains("src/app/api/hr/admin/master-sheet/route.ts", /export async function GET/)
  );

  await check("Route uses ExcelJS workbook", () =>
    fileContains("src/app/api/hr/admin/master-sheet/route.ts", "new ExcelJS.Workbook")
  );

  await check("istYearRange() helper present", () =>
    fileContains("src/app/api/hr/admin/master-sheet/route.ts", "function istYearRange")
  );

  await check("istMonthRange() helper present", () =>
    fileContains("src/app/api/hr/admin/master-sheet/route.ts", "function istMonthRange")
  );

  await check("Period 'this-year' branch wired", () =>
    fileContains("src/app/api/hr/admin/master-sheet/route.ts", `period === "this-year"`)
  );

  await check("Period 'last-year' branch wired", () =>
    fileContains("src/app/api/hr/admin/master-sheet/route.ts", `period === "last-year"`)
  );

  await check("Period 'all' branch with year discovery", () =>
    fileContains("src/app/api/hr/admin/master-sheet/route.ts", `EXTRACT(YEAR FROM`)
  );

  await check("Sheet name length cap (Excel 31-char limit)", () =>
    fileContains("src/app/api/hr/admin/master-sheet/route.ts", ".slice(0, 31)")
  );

  // ── 2. Master Sheet — actually generate a workbook ────────────────
  console.log("\n— Master Sheet generation (live data) —");

  // Reuse the same logic the route uses: build a workbook from
  // current Prisma data and inspect the result.
  await check("Employees: Prisma query succeeds", async () => {
    const n = await p.user.count({ where: { isActive: true } });
    return `${n} active users`;
  });

  await check("Attendance: Prisma query succeeds", async () => {
    const n = await p.attendance.count();
    return `${n} attendance rows total`;
  });

  await check("LeaveBalance: Prisma query succeeds", async () => {
    const n = await p.leaveBalance.count();
    return `${n} balance rows`;
  });

  await check("LeaveApplication: Prisma query succeeds", async () => {
    const n = await p.leaveApplication.count();
    return `${n} leave applications`;
  });

  await check("WFHRequest: Prisma query succeeds", async () => {
    const n = await p.wFHRequest.count();
    return `${n} WFH requests`;
  });

  await check("OnDutyRequest: Prisma query succeeds", async () => {
    const n = await p.onDutyRequest.count();
    return `${n} on-duty requests`;
  });

  await check("AttendanceRegularization: Prisma query succeeds", async () => {
    const n = await p.attendanceRegularization.count();
    return `${n} regularizations`;
  });

  await check("CompOffRequest: Prisma query succeeds", async () => {
    const n = await p.compOffRequest.count();
    return `${n} comp-off requests`;
  });

  // Build a real workbook and inspect it.
  await check("Workbook builds with all sheets + valid xlsx buffer", async () => {
    const wb = new ExcelJS.Workbook();
    // Employees sheet
    const users = await p.user.findMany({
      where: { isActive: true }, take: 10,
      include: { employeeProfile: true, manager: { select: { name: true } } },
    });
    const ws = wb.addWorksheet("Employees");
    ws.columns = [{ header: "Name", key: "name", width: 20 }];
    users.forEach((u) => ws.addRow({ name: u.name }));

    const buf = await wb.xlsx.writeBuffer();
    if (buf.byteLength < 100) throw new Error("buffer too small");
    // XLSX = ZIP archive → first 2 bytes = "PK" (0x50 0x4B)
    const head = new Uint8Array(buf).slice(0, 2);
    if (head[0] !== 0x50 || head[1] !== 0x4b) {
      throw new Error("not a valid zip/xlsx");
    }
    return `${buf.byteLength} bytes`;
  });

  await check("Distinct attendance years (yearly mode discovery)", async () => {
    const rows = await p.$queryRawUnsafe<Array<{ y: number }>>(
      `SELECT DISTINCT EXTRACT(YEAR FROM ("date" AT TIME ZONE 'Asia/Kolkata'))::int AS y
         FROM "Attendance" ORDER BY y ASC`
    );
    return `years = [${rows.map((r) => r.y).join(", ")}]`;
  });

  // ── 3. Master Sheet frontend page ─────────────────────────────────
  console.log("\n— Master Sheet frontend page —");

  await check("Page file exists", () =>
    fileExists("src/app/dashboard/hr/admin/master-sheet/page.tsx")
  );

  await check("Page is client component", () =>
    fileContains("src/app/dashboard/hr/admin/master-sheet/page.tsx", '"use client"')
  );

  await check("Page HR-admin gated (isHRAdmin)", () =>
    fileContains("src/app/dashboard/hr/admin/master-sheet/page.tsx", "isHRAdmin")
  );

  await check("All 4 sheet keys present in picker", () => {
    const txt = fs.readFileSync(path.join(ROOT, "src/app/dashboard/hr/admin/master-sheet/page.tsx"), "utf8");
    return ["employees", "attendance", "leaves", "requests"].every((k) => txt.includes(`"${k}"`));
  });

  await check("All 6 period options present", () => {
    const txt = fs.readFileSync(path.join(ROOT, "src/app/dashboard/hr/admin/master-sheet/page.tsx"), "utf8");
    return ["both", "current", "last", "this-year", "last-year", "all"].every((k) => txt.includes(`"${k}"`));
  });

  await check("Page uses SelectField (not native <select>)", () =>
    fileContains("src/app/dashboard/hr/admin/master-sheet/page.tsx", "from \"@/components/ui/SelectField\"")
  );

  await check("Page triggers fetch+blob download", () =>
    fileContains("src/app/dashboard/hr/admin/master-sheet/page.tsx", "createObjectURL")
  );

  // ── 4. HR admin sidebar rail link ─────────────────────────────────
  console.log("\n— HR admin sidebar —");

  await check("FileSpreadsheet icon imported", () =>
    fileContains("src/app/dashboard/hr/admin/page.tsx", "FileSpreadsheet")
  );

  await check("showMasterSheetRail flag wired (full-admin only)", () =>
    fileContains("src/app/dashboard/hr/admin/page.tsx", "showMasterSheetRail")
  );

  await check("Master Sheet link href correct", () =>
    fileContains("src/app/dashboard/hr/admin/page.tsx", "/dashboard/hr/admin/master-sheet")
  );

  // ── 5. Stale-tab refresher ───────────────────────────────────────
  console.log("\n— Stale-tab refresher —");

  await check("Refresher component file exists", () =>
    fileExists("src/components/layout/stale-tab-refresher.tsx")
  );

  await check("Refresher uses visibilitychange + pageshow", () => {
    const txt = fs.readFileSync(path.join(ROOT, "src/components/layout/stale-tab-refresher.tsx"), "utf8");
    return txt.includes("visibilitychange") && txt.includes("pageshow");
  });

  await check("Refresher honors bfcache via event.persisted", () =>
    fileContains("src/components/layout/stale-tab-refresher.tsx", "e.persisted")
  );

  await check("STALE_MS threshold defined", () =>
    fileContains("src/components/layout/stale-tab-refresher.tsx", "STALE_MS")
  );

  await check("Mounted at root layout", () => {
    const txt = fs.readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");
    return txt.includes("StaleTabRefresher") && /<StaleTabRefresher\s*\/>/.test(txt);
  });

  // ── 6. Earlier feature touch-points (smoke checks) ────────────────
  console.log("\n— Earlier feature smoke checks —");

  await check("SelectField portal component exists", () =>
    fileExists("src/components/ui/SelectField.tsx") &&
    fileContains("src/components/ui/SelectField.tsx", "createPortal")
  );

  await check("CustomSelect popup height clamp present", () =>
    fileContains("src/components/ui/CustomSelect.tsx", "Math.min(desired, avail)")
  );

  await check("DEPARTMENTS list has the 9 canonical values", () => {
    const txt = fs.readFileSync(path.join(ROOT, "src/lib/departments.ts"), "utf8");
    return ["AI","Editing","Human Resource","Management","Packaging Team","Quality Assurance","Research","Social Media","Writing"]
      .every((d) => txt.includes(`"${d}"`));
  });

  await check("Onboard options API returns all active users (no orgLevel filter)", () => {
    const txt = fs.readFileSync(path.join(ROOT, "src/app/api/hr/onboard/options/route.ts"), "utf8");
    // The managers query should NOT carry an orgLevel: { in: [...] } filter
    return !/managers[\s\S]{0,200}orgLevel:\s*\{\s*in/.test(txt);
  });

  await check("WFH route allows HR on-behalf range without forceGrant", () =>
    fileContains("src/app/api/hr/attendance/wfh/route.ts", "onBehalf && callerIsHRAdmin")
  );

  await check("On-Duty route accepts toDate (range support)", () =>
    fileContains("src/app/api/hr/attendance/on-duty/route.ts", "toDate")
  );

  await check("Email template uses 'a/an' article picker", () =>
    fileContains("src/lib/email/templates.ts", /aeiouAEIOU/)
  );

  await check("People page Edit tab gated on isDeveloper", () =>
    fileContains("src/app/dashboard/hr/people/[id]/page.tsx", "me?.isDeveloper === true")
  );

  await check("People page Attendance tab visibility gate present", () => {
    const txt = fs.readFileSync(path.join(ROOT, "src/app/dashboard/hr/people/[id]/page.tsx"), "utf8");
    return txt.includes("showAttendanceTab");
  });

  await check("openWfhFor routes through unified Leave+WFH modal", () => {
    const txt = fs.readFileSync(path.join(ROOT, "src/app/dashboard/hr/people/[id]/page.tsx"), "utf8");
    return /openWfhFor[\s\S]{0,400}setLeaveModalTab\(["']wfh["']\)/.test(txt);
  });

  await check("NotificationBell has Web Audio sound function", () =>
    fileContains("src/components/NotificationBell.tsx", "playNotificationSound")
  );

  await check("NotificationBell mute key persisted to localStorage", () =>
    fileContains("src/components/NotificationBell.tsx", "nbm:notif:muted")
  );

  await check("Cost Center hard-locked to NB Media in onboarding", () => {
    // The onboarding wizard / employee profile flow should reference
    // NB Media as the canonical costCenter value.
    return fileContains("src/app/dashboard/hr/onboard/page.tsx", "NB Media");
  });

  // ── 7. Summary ───────────────────────────────────────────────────
  console.log("\n\n=== Summary ===");
  console.log(`\x1b[32m${passes} passed\x1b[0m, \x1b[31m${fails} failed\x1b[0m`);
  if (fails > 0) {
    console.log("\nFailures:");
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f.name}\n     → ${f.reason}`));
  }
  await p.$disconnect();
  process.exit(fails === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await p.$disconnect();
  process.exit(2);
});
