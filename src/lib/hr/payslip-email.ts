// Emails every employee in a payroll run their own payslip as a PDF
// attachment. Triggered (fire-and-forget) when HR marks a run "paid" — i.e.
// exactly when payslips are released to employees. Best-effort: a single
// failure is logged and skipped, never breaks the others or the caller.
import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email/sender";
import { htmlToPdf } from "@/lib/hr/html-to-pdf";
import { buildPayslipHtml } from "@/lib/hr/payslip-html";
import { decryptPII } from "@/lib/pii-crypto";
import { writeAuditLog } from "@/lib/audit-log";

const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Bank / PAN are stored encrypted; decrypt for the employee's own payslip.
// Falls back to the raw value if it wasn't encrypted (legacy rows).
function safeDecrypt(v: string | null | undefined): string | null {
  if (!v) return null;
  try { return decryptPII(v) ?? v; } catch { return v; }
}

function payslipEmailContent(firstName: string, period: string) {
  const subject = `Payslip for ${period}`;
  const text =
`Dear ${firstName},

Please find enclosed Payslip for the month of ${period}. We suggest that you save it in your personal records for any future reference.

Important:
- Please ensure that you check the entries in your payslip and for any queries or concerns, you may approach your HR Manager or Payroll Admin.

Regards,
NB Media`;
  const html =
`<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;max-width:620px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px">
  <h2 style="text-align:center;font-size:18px;margin:0 0 6px">Payslip for ${period}</h2>
  <hr style="border:none;border-top:2px solid #3b82f6;width:120px;margin:0 auto 22px"/>
  <p style="margin:0 0 16px">Dear ${firstName},</p>
  <p style="margin:0 0 16px;line-height:1.6">Please find enclosed Payslip for the month of ${period}. We suggest that you save it in your personal records for any future reference.</p>
  <p style="margin:0 0 4px;line-height:1.6"><u>Important:</u></p>
  <p style="margin:0 0 22px;line-height:1.6">- Please ensure that you check the entries in your payslip and for any queries or concerns, you may approach your HR Manager or Payroll Admin.</p>
  <p style="margin:0">Regards,<br/>NB Media</p>
</div>`;
  return { subject, html, text };
}

export async function emailPayslipsForRun(runId: number): Promise<{ sent: number; failed: number; skipped: number }> {
  const result = { sent: 0, failed: 0, skipped: 0 };
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) return result;

  const payslips = await prisma.payslip.findMany({
    where: { payrollRunId: runId },
    include: {
      user: { select: { id: true, name: true, email: true, isActive: true } },
      salaryStructure: true,
    },
  });
  const uids = payslips.map((p) => p.userId);

  const profiles = await prisma.employeeProfile.findMany({
    where: { userId: { in: uids } },
    select: {
      userId: true, employeeId: true, firstName: true, middleName: true, lastName: true,
      department: true, designation: true, joiningDate: true, dateOfBirth: true,
      jobLocation: true, city: true, bankName: true, bankIfsc: true,
      bankAccountNumber: true, panNumber: true, legalEntity: true,
    },
  });
  const profMap = new Map(profiles.map((p) => [p.userId, p]));

  const bonusRows = await prisma.employeeBonus.findMany({
    where: { userId: { in: uids } },
    select: { userId: true, bonusType: true, amount: true, effectiveDate: true },
  });
  const bonusMap = new Map<number, any[]>();
  for (const b of bonusRows) {
    const arr = bonusMap.get(b.userId) ?? [];
    arr.push(b);
    bonusMap.set(b.userId, arr);
  }

  const adhocRows = uids.length
    ? await prisma.$queryRawUnsafe<{ userId: number; type: string | null; amount: string }[]>(
        `SELECT "userId", type, SUM(amount)::text AS amount
           FROM "AdhocLineItem"
          WHERE kind = 'payment' AND month = $1 AND year = $2 AND "userId" = ANY($3::int[])
          GROUP BY "userId", type`,
        run.month, run.year, uids,
      )
    : [];
  const adhocMap = new Map<number, { type: string; amount: number }[]>();
  for (const a of adhocRows) {
    const arr = adhocMap.get(a.userId) ?? [];
    arr.push({ type: a.type || "Other", amount: parseFloat(a.amount) });
    adhocMap.set(a.userId, arr);
  }

  const period = `${MON_SHORT[run.month]} ${run.year}`;

  for (const ps of payslips) {
    // On-hold = not paid this cycle; inactive / no-email = can't deliver.
    if (ps.status === "on_hold") { result.skipped++; continue; }
    const email = ps.user?.email;
    if (!ps.user?.isActive || !email) { result.skipped++; continue; }

    try {
      const prof = profMap.get(ps.userId);
      const profile = prof
        ? {
            ...prof,
            bankAccountNumber: safeDecrypt(prof.bankAccountNumber),
            bankIfsc: safeDecrypt(prof.bankIfsc),
            panNumber: safeDecrypt(prof.panNumber),
          }
        : {};
      const pObj = { ...ps, adhocPayments: adhocMap.get(ps.userId) ?? [] };
      const html = buildPayslipHtml(pObj, ps.salaryStructure, profile, bonusMap.get(ps.userId) ?? []);
      const pdf = await htmlToPdf(html);

      const safeName = (ps.user.name || "employee").replace(/[^a-z0-9]+/gi, "_");
      const filename = `Payslip_${MON_SHORT[run.month]}_${run.year}_${safeName}.pdf`;
      const firstName = (prof?.firstName && prof.firstName.trim()) || ps.user.name || "Employee";

      await sendEmail({
        to: email,
        content: payslipEmailContent(firstName, period),
        attachments: [{ filename, contentType: "application/pdf", contentBase64: pdf.toString("base64") }],
      });
      result.sent++;
    } catch (e) {
      console.error(`[payslip-email] failed for user ${ps.userId} (run ${runId}):`, e);
      result.failed++;
    }
  }

  console.log(`[payslip-email] run ${runId} (${period}): sent=${result.sent} failed=${result.failed} skipped=${result.skipped}`);
  await writeAuditLog({
    action: "payroll.run.payslips_emailed",
    entityType: "PayrollRun",
    entityId: runId,
    after: { period, ...result },
  }).catch(() => {});
  return result;
}
