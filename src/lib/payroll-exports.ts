// Shared loader + helpers for the 4 post-lock payroll exports:
//   1. BatchPayment_Monthly_Statement  (per-bank transfer file)
//   2. PT Monthly Statement            (Professional Tax filing)
//   3. EmployerECR                     (EPFO Electronic Challan-cum-Return)
//   4. Keka PayRegister                (master pay register with components)
//
// Each format mirrors the customer's existing Keka exports byte-for-byte
// (same headers, casing, column order, even the "Aganist" typo). Don't
// add columns, don't reformat dates, don't insert totals rows that aren't
// in the source — the bank / EPFO / accountants downstream parse these by
// position and will reject anything different.

import prisma from "@/lib/prisma";
import { decryptPII } from "@/lib/pii-crypto";

// Standard EPFO statutory ceilings — used to compute EPF/EPS wages.
export const EPF_CEILING = 15_000;       // monthly basic+DA cap for EPF
export const EDLI_CEILING = 15_000;      // EDLI wages always at ceiling

// Map a 0-indexed month to short / "Mon-YYYY" / "Mon YYYY" strings.
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"] as const;
export function monShort(month0: number): string { return MONTH_SHORT[month0]; }
export function monYearDash(month0: number, year: number): string { return `${MONTH_SHORT[month0]}-${year}`; }
export function monYearSpace(month0: number, year: number): string { return `${MONTH_SHORT[month0]} ${year}`; }
export function monYearUnderscore(month0: number, year: number): string { return `${MONTH_SHORT[month0]}_${year}`; }

// Strict number coerce (Prisma returns Decimal as a string-like).
export function num(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

// Each row carries everything any of the 4 files might need so we only
// load it once per export. Bank / IFSC / UAN come back already decrypted.
export type ExportRow = {
  userId: number;
  name: string;
  employeeId: string | null;
  department: string | null;
  designation: string | null;
  employmentType: string | null;
  joiningDate: Date | null;
  // Brand / entity — used to split the exports per brand (NB Media vs YT Labs).
  businessUnit: string | null;
  legalEntity: string | null;
  // Bank
  bankName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  // PF
  uanNumber: string | null;
  pfEligible: boolean;
  // Salary structure (annual amounts; divide by 12 for monthly)
  salaryType: string;
  ctcAnnual: number;
  basicAnnual: number;
  hraAnnual: number;
  daAnnual: number;
  conveyanceAnnual: number;
  medicalAnnual: number;
  specialAnnual: number;
  pfEmployeeAnnual: number;
  // Payslip (this cycle)
  payslipId: number;
  workingDays: number;
  presentDays: number;
  lopDays: number;
  grossEarnings: number;
  totalDeductions: number;
  netPay: number;
  bonus: number;
  pfEmployee: number;
  professionalTax: number;
  additionalTax: number;
  tds: number;
  status: string;
  // Adhoc line items for this cycle, summed by kind+typeLabel
  adhocPayByType: Record<string, number>;
  adhocDedByType: Record<string, number>;
};

// Single source-of-truth loader for the 4 export endpoints. Pulls
// everything in 2 queries (payslips + adhoc) and decrypts PII inline.
// Throws if the run is missing.
export async function loadExportRows(runId: number): Promise<{
  run: { id: number; month: number; year: number; status: string };
  rows: ExportRow[];
}> {
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    select: { id: true, month: true, year: true, status: true },
  });
  if (!run) throw new Error(`PayrollRun ${runId} not found`);

  // Hydrate the payslip with user + profile + structure. EmployeeProfile
  // fields are encrypted on disk; we decrypt on the way out.
  const payslips = await prisma.payslip.findMany({
    where: { payrollRunId: runId },
    include: {
      user: { select: { id: true, name: true } },
      salaryStructure: true,
    },
  });

  // Pull EmployeeProfile in a second query (Prisma include from Payslip
  // doesn't reach through to it) and key by userId for the merge below.
  const userIds = payslips.map(p => p.userId);
  const profiles = await prisma.employeeProfile.findMany({
    where: { userId: { in: userIds } },
    select: {
      userId: true,
      employeeId: true,
      department: true,
      designation: true,
      employmentType: true,
      joiningDate: true,
      bankName: true,
      bankAccountNumber: true,
      bankIfsc: true,
      uanNumber: true,
      businessUnit: true,
      legalEntity: true,
    },
  });
  const profileByUserId = new Map(profiles.map(p => [p.userId, p]));

  // AdhocLineItem rows for the cycle — used by PayRegister to populate
  // Referral Bonus / Business Expense Reimbursement / etc. Bucket by
  // userId then by the line's free-text `type` so the per-column lookup
  // is a hash lookup.
  const adhocRows = await prisma.$queryRawUnsafe<{
    userId: number; kind: string; type: string | null; amount: string;
  }[]>(
    `SELECT "userId", kind, type, SUM(amount)::text AS amount
       FROM "AdhocLineItem"
      WHERE month = $1 AND year = $2
      GROUP BY "userId", kind, type`,
    run.month, run.year,
  );
  const payByUser  = new Map<number, Record<string, number>>();
  const dedByUser  = new Map<number, Record<string, number>>();
  for (const a of adhocRows) {
    const target = a.kind === "deduction" ? dedByUser : payByUser;
    const bucket = target.get(a.userId) ?? {};
    bucket[a.type || "Other"] = (bucket[a.type || "Other"] ?? 0) + num(a.amount);
    target.set(a.userId, bucket);
  }

  const rows: ExportRow[] = payslips.map(p => {
    const prof = profileByUserId.get(p.userId);
    const s = p.salaryStructure;
    return {
      userId: p.userId,
      name: p.user.name,
      employeeId: prof?.employeeId ?? null,
      department: prof?.department ?? null,
      designation: prof?.designation ?? null,
      employmentType: prof?.employmentType ?? null,
      joiningDate: prof?.joiningDate ?? null,
      businessUnit: prof?.businessUnit ?? null,
      legalEntity: prof?.legalEntity ?? null,
      bankName: prof?.bankName ?? null,
      // Bank account / IFSC / UAN are encrypted at rest. Decrypt for the
      // file — finance / banks / EPFO need the cleartext values.
      bankAccountNumber: prof?.bankAccountNumber ? decryptPII(prof.bankAccountNumber) : null,
      bankIfsc: prof?.bankIfsc ? decryptPII(prof.bankIfsc) : null,
      uanNumber: prof?.uanNumber ? decryptPII(prof.uanNumber) : null,
      pfEligible: s.pfEligible,
      salaryType: s.salaryType,
      ctcAnnual: num(s.ctc),
      basicAnnual: num(s.basic),
      hraAnnual: num(s.hra),
      daAnnual: num(s.dearnessAllowance),
      conveyanceAnnual: num(s.conveyanceAllowance),
      medicalAnnual: num(s.medicalAllowance),
      specialAnnual: num(s.specialAllowance),
      pfEmployeeAnnual: num(s.pfEmployee),
      payslipId: p.id,
      workingDays: num(p.workingDays),
      presentDays: num(p.presentDays),
      lopDays: num(p.lopDays),
      grossEarnings: num(p.grossEarnings),
      totalDeductions: num(p.totalDeductions),
      netPay: num(p.netPay),
      bonus: num(p.bonus),
      pfEmployee: num(p.pfEmployee),
      professionalTax: num(p.professionalTax),
      additionalTax: num((p as any).additionalTax),
      tds: num(p.tds),
      status: p.status,
      adhocPayByType: payByUser.get(p.userId) ?? {},
      adhocDedByType: dedByUser.get(p.userId) ?? {},
    };
  });

  return { run, rows };
}

// Excel sheet names cap at 31 chars; truncate without ellipsis since the
// cap is hard. Banks like "kotak mahindra bank limited" (27 chars) fit
// but a long name could go over.
export function safeSheetName(name: string): string {
  return name.slice(0, 31);
}

// ── Brand split ───────────────────────────────────────────────────────
// Each brand's payroll exports as a separate file with its own legal
// entity. brandOf mirrors the app convention: YT Labs is exact, NB Media
// is everything else (incl. null / legacy) so nobody is silently dropped.
export type PayrollBrand = "NB Media" | "YT Labs";

export function brandOf(businessUnit: string | null | undefined): PayrollBrand {
  return businessUnit === "YT Labs" ? "YT Labs" : "NB Media";
}

// Legal entity / company name printed on each brand's exports.
// NB Media keeps its existing Keka label verbatim (bookkeepers reconcile
// against it). Replace the YT Labs value with its exact registered name.
export const COMPANY_BY_BRAND: Record<PayrollBrand, string> = {
  "NB Media": "YT Money Productions Pvt. Ltd (NB Media)",
  "YT Labs":  "YT Labs",
};

// Short slug used in non-Keka filenames so a YT Labs file never overwrites
// the NB Media one when both are downloaded for the same month.
export const BRAND_SLUG: Record<PayrollBrand, string> = {
  "NB Media": "NB-Media",
  "YT Labs":  "YT-Labs",
};

// Parse + validate the ?brand= query param. null => no filter (all employees,
// the legacy behaviour) so existing links keep working.
export function brandParam(req: Request): PayrollBrand | null {
  const b = new URL(req.url).searchParams.get("brand");
  return b === "NB Media" || b === "YT Labs" ? b : null;
}

export function filterRowsByBrand(rows: ExportRow[], brand: PayrollBrand | null): ExportRow[] {
  return brand ? rows.filter(r => brandOf(r.businessUnit) === brand) : rows;
}

// "Aganist" typo deliberately preserved — Keka's existing exports use
// this misspelling and downstream systems may grep for it.
export const HEADERS_PAY_REGISTER = [
  "Employee Number", "Employee Name", "Job Title", "Date Of Joining",
  "Department", "Worker Type", "Payroll Month", "Payroll Type",
  "Status", "Status Description",
  "Actual Payable days", "Working days", "Loss of Pay Days",
  "Days Payable", "Payable Units", "Remuneration Amount",
  "Basic", "HRA", "Medical Allowance", "Conveyance Allowance",
  "Special Allowance", "Dearness Allowance",
  "Stipend", "Referral Bonus", "Business Expense Reimbursement",
  "Gross(A)", "PF Employee", "Total Contributions(B)",
  "Professional Tax", "Total Deductions(C)", "Net Pay(A-B-C)",
  "Cash Advance(D)", "Settlement Aganist Advance(E)",
  "Total Reimbursements(F)", "Total Net Pay(A-B-C+D+E+F)",
];
