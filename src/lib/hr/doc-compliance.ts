// PAN / Aadhaar / Education compliance cron.
//
// Daily sweep over every active employee whose joiningDate is at least
// 7 days in the past. For each one we compute a 6-piece checklist:
//
//   1. EmployeeProfile.panNumber                — typed
//   2. EmployeeDocument category="pan_card"     — file uploaded
//   3. EmployeeProfile.aadhaarNumber            — typed
//   4. EmployeeDocument category="aadhar"       — file uploaded
//   5. EmployeeProfile.educationDetails         — ≥1 entry with degree + institution
//   6. EmployeeDocument category="education_certificate"  — file uploaded
//
// Missing ANY piece → not compliant. The escalation:
//
//   Day 0  (cron tick when first non-compliant): send warning email
//          to the employee. Stamp docWarningSentAt = NOW.
//   Day 2+ (cron tick 2+ days after the warning): create a Violation
//          row reported by the HR Manager + email the employee, the
//          HR Manager, and the employee's reporting manager. Stamp
//          docViolationCreatedAt = NOW.
//
// When the employee becomes compliant (all 6 pieces present) the cron
// auto-clears both stamps so a future regression triggers a fresh
// cycle.
//
// All writes are no-ops in dry-run (so dev can exercise the path
// safely). Toggle key: "missing_doc_compliance".

import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email/sender";
import { docComplianceWarningEmail, docComplianceViolationEmail } from "@/lib/email/templates";
import { isDryRun } from "@/lib/email/transport";
import { isEmailEnabled, devEmailRecipientsClause } from "@/lib/email/toggles";

const GRACE_DAYS_AFTER_JOINING = 7;
const VIOLATION_DELAY_DAYS     = 2;

// ── Compliance check ────────────────────────────────────────────────
export type ComplianceStatus = {
  panNumber:    boolean;
  panFile:      boolean;
  aadhaarNumber: boolean;
  aadhaarFile:  boolean;
  education:    boolean;  // at least one entry with degree + institution
  educationFile: boolean;
};
export type ComplianceCheck = ComplianceStatus & {
  compliant: boolean;
  missing:   string[];
};

/** Decide whether a single education-entries blob counts as "filled in". */
function hasValidEducation(raw: unknown): boolean {
  if (!raw) return false;
  // Stored as JSON column — Prisma returns the parsed value directly,
  // but legacy migrations may have left strings. Handle both.
  let entries: any[] = [];
  if (Array.isArray(raw)) entries = raw;
  else if (typeof raw === "string") {
    try { const v = JSON.parse(raw); entries = Array.isArray(v) ? v : []; }
    catch { return false; }
  }
  if (entries.length === 0) return false;
  // At least one entry must have a degree + institution. We accept
  // multiple possible field names because the candidate form's shape
  // (course/university) and the simpler form (degree/institution) are
  // both in the wild.
  return entries.some((e) => {
    if (!e || typeof e !== "object") return false;
    const degree      = String(e.degree ?? e.course ?? "").trim();
    const institution = String(e.institution ?? e.university ?? "").trim();
    return degree.length > 0 && institution.length > 0;
  });
}

/** Pure: compute compliance from data already loaded. */
export function checkCompliance(args: {
  panNumber:        string | null | undefined;
  aadhaarNumber:    string | null | undefined;
  educationDetails: unknown;
  docCategories:    Set<string>;     // categories from the user's EmployeeDocument rows
}): ComplianceCheck {
  const status: ComplianceStatus = {
    panNumber:     !!(args.panNumber && args.panNumber.trim()),
    panFile:       args.docCategories.has("pan_card"),
    aadhaarNumber: !!(args.aadhaarNumber && args.aadhaarNumber.trim()),
    aadhaarFile:   args.docCategories.has("aadhar"),
    education:     hasValidEducation(args.educationDetails),
    educationFile: args.docCategories.has("education_certificate"),
  };
  const missing: string[] = [];
  if (!status.panNumber)     missing.push("PAN number");
  if (!status.panFile)       missing.push("PAN card document");
  if (!status.aadhaarNumber) missing.push("Aadhaar number");
  if (!status.aadhaarFile)   missing.push("Aadhaar document");
  if (!status.education)     missing.push("Education details");
  if (!status.educationFile) missing.push("Education certificate");
  return { ...status, compliant: missing.length === 0, missing };
}

// ── Cron entry point ────────────────────────────────────────────────
type Candidate = {
  userId: number;
  userName: string;
  userEmail: string;
  managerId: number | null;
  managerName: string | null;
  managerEmail: string | null;
  joiningDate: Date | null;
  panNumber: string | null;
  aadhaarNumber: string | null;
  educationDetails: any;
  docWarningSentAt: Date | null;
  docViolationCreatedAt: Date | null;
};

export async function sendMissingDocReminders(): Promise<{ warned: number; violated: number; cleared: number }> {
  if (!(await isEmailEnabled("missing_doc_compliance"))) {
    console.log("[doc-compliance] skipped — disabled in admin toggles");
    return { warned: 0, violated: 0, cleared: 0 };
  }

  const graceCutoff = new Date(Date.now() - GRACE_DAYS_AFTER_JOINING * 86400000);

  // Pull every active employee past the grace window. Skip rows
  // without a joiningDate — without one we can't apply the grace
  // rule fairly.
  const rows = await prisma.$queryRawUnsafe<Candidate[]>(
    `SELECT u.id AS "userId",
            u.name  AS "userName",
            u.email AS "userEmail",
            u."managerId",
            m.name  AS "managerName",
            m.email AS "managerEmail",
            ep."joiningDate",
            ep."panNumber",
            ep."aadhaarNumber",
            ep."educationDetails",
            ep."docWarningSentAt",
            ep."docViolationCreatedAt"
       FROM "EmployeeProfile" ep
       JOIN "User" u ON u.id = ep."userId"
  LEFT JOIN "User" m ON m.id = u."managerId"
      WHERE u."isActive" = true
        AND ep."joiningDate" IS NOT NULL
        AND ep."joiningDate" <= $1`,
    graceCutoff,
  );

  // Pull all the doc categories per user in one query.
  const docRows = await prisma.$queryRawUnsafe<{ userId: number; category: string }[]>(
    `SELECT "userId", category FROM "EmployeeDocument"`,
  );
  const docsByUser = new Map<number, Set<string>>();
  for (const d of docRows) {
    if (!docsByUser.has(d.userId)) docsByUser.set(d.userId, new Set());
    docsByUser.get(d.userId)!.add(d.category);
  }

  // Find the HR Manager (Tanvi etc.) — used as the violation reporter
  // and as a recipient on the violation-created email.
  const hrManager = await prisma.user.findFirst({
    where: { isActive: true, role: "hr_manager" },
    select: { id: true, name: true, email: true },
  });

  let warned = 0, violated = 0, cleared = 0;
  const now = new Date();

  for (const row of rows) {
    const docs = docsByUser.get(row.userId) ?? new Set<string>();
    const check = checkCompliance({
      panNumber:        row.panNumber,
      aadhaarNumber:    row.aadhaarNumber,
      educationDetails: row.educationDetails,
      docCategories:    docs,
    });

    // ── Path 1: compliant — clear stale stamps so future regressions
    //    re-arm the warn → escalate cycle cleanly.
    if (check.compliant) {
      if (row.docWarningSentAt || row.docViolationCreatedAt) {
        if (!isDryRun()) {
          await prisma.$executeRawUnsafe(
            `UPDATE "EmployeeProfile"
                SET "docWarningSentAt" = NULL, "docViolationCreatedAt" = NULL
              WHERE "userId" = $1`,
            row.userId,
          );
        }
        cleared++;
      }
      continue;
    }

    // ── Path 2: not compliant. Decide warn vs. violate.
    if (!row.docWarningSentAt) {
      // Day 0 — send the warning email.
      try {
        await sendEmail({
          to: row.userEmail,
          content: docComplianceWarningEmail({
            employeeName: row.userName,
            missing: check.missing,
          }),
        });
        if (!isDryRun()) {
          await prisma.$executeRawUnsafe(
            `UPDATE "EmployeeProfile" SET "docWarningSentAt" = NOW() WHERE "userId" = $1`,
            row.userId,
          );
        }
        warned++;
      } catch (e) {
        console.warn(`[doc-compliance] warning email to ${row.userEmail} failed:`, e);
      }
      continue;
    }

    // Warned already. Has VIOLATION_DELAY_DAYS passed?
    const dueAt = new Date(row.docWarningSentAt.getTime() + VIOLATION_DELAY_DAYS * 86400000);
    if (now < dueAt) continue;
    if (row.docViolationCreatedAt) continue; // already violated

    // ── Day 2+ — create the auto-violation + email all 3 recipients.
    if (!hrManager) {
      console.warn("[doc-compliance] no active hr_manager — skipping violation creation");
      continue;
    }
    let createdViolationId: number | null = null;
    if (!isDryRun()) {
      try {
        const v = await prisma.violation.create({
          data: {
            userId:       row.userId,
            reportedBy:   hrManager.id,
            title:        "Missing compliance documents — PAN / Aadhaar / Education",
            description:  `Auto-generated by the compliance cron. Missing: ${check.missing.join(", ")}.`,
            severity:     "low",
            category:     "compliance",
            status:       "open",
            violationDate: now,
            responsiblePersonId: row.managerId,
          },
        });
        createdViolationId = v.id;
        await prisma.$executeRawUnsafe(
          `UPDATE "EmployeeProfile" SET "docViolationCreatedAt" = NOW() WHERE "userId" = $1`,
          row.userId,
        );
      } catch (e) {
        console.warn(`[doc-compliance] failed to create violation for #${row.userId}:`, e);
        continue;
      }
    }

    // Email all 3 recipients (employee, HR Manager, reporting manager).
    const recipients = new Map<string, { name: string | null; email: string }>();
    recipients.set(row.userEmail.toLowerCase(), { name: row.userName, email: row.userEmail });
    if (hrManager.email) {
      recipients.set(hrManager.email.toLowerCase(), { name: hrManager.name, email: hrManager.email });
    }
    if (row.managerEmail) {
      recipients.set(row.managerEmail.toLowerCase(), { name: row.managerName, email: row.managerEmail });
    }
    // Optional dev observers — same toggle every HR mail respects.
    const devClause = await devEmailRecipientsClause();
    if (devClause.length > 0) {
      const emails = devClause[0]?.email?.in ?? [];
      for (const e of emails) recipients.set(e.toLowerCase(), { name: null, email: e });
    }
    for (const r of recipients.values()) {
      try {
        await sendEmail({
          to: r.email,
          content: docComplianceViolationEmail({
            recipientName:    r.name ?? null,
            employeeName:     row.userName,
            employeeEmail:    row.userEmail,
            missing:          check.missing,
            violationId:      createdViolationId,
            hrManagerName:    hrManager.name,
            reportingManagerName: row.managerName,
          }),
        });
      } catch (e) {
        console.warn(`[doc-compliance] violation email to ${r.email} failed:`, e);
      }
    }
    violated++;
  }

  return { warned, violated, cleared };
}
