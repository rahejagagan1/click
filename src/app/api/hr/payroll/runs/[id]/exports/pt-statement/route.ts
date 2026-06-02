// PT Monthly Statement_{Mon YYYY}.xlsx
//
// Single-sheet Professional Tax filing. Company name on R1 (title case
// with brand in parens), summary line on R2, headers on R3, data from R4.
// Six columns: Employee Number / Employee Name / State / Registered
// Location / Gross Amount / Tax Amount. State + Registered Location are
// company-level constants for NB Media (Punjab / Mohali) — they reflect
// where the entity is PT-registered, not where the employee lives.

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";
import { loadExportRows, monYearSpace } from "@/lib/payroll-exports";

export const dynamic = "force-dynamic";

// NB Media PT registration. Hardcoded for now — the entity selector +
// per-entity config table is a follow-up.
const NB_MEDIA = {
  companyName: "YT Money Productions Pvt. Ltd (NB Media)",
  ptState: "Punjab",
  ptRegisteredLocation: "Mohali",
} as const;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canViewSalary(session!.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    const runId = parseInt(id);
    if (!Number.isFinite(runId)) return NextResponse.json({ error: "Bad runId" }, { status: 400 });

    const { run, rows } = await loadExportRows(runId);
    if (run.status !== "locked" && run.status !== "paid") {
      return NextResponse.json({ error: `Lock the run first — currently '${run.status}'` }, { status: 409 });
    }

    // PT is per-payslip — skip on-hold rows (no salary processed)
    // but keep rows even where PT is 0 (waived due to LOP > 5) so the
    // filing shows everyone the company accounted for this cycle.
    const payable = rows.filter(r => r.status !== "on_hold");

    const monthLabel = monYearSpace(run.month, run.year);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("PT Monthly Statement");

    ws.mergeCells("A1:F1");
    ws.getCell("A1").value = NB_MEDIA.companyName;
    ws.getCell("A1").font = { bold: true };
    ws.mergeCells("A2:F2");
    ws.getCell("A2").value = `Professional Tax Summary - ${monthLabel}`;
    ws.getCell("A2").font = { bold: true };

    const headers = ["Employee Number", "Employee Name", "State", "Registered Location", "Gross Amount", "Tax Amount"];
    headers.forEach((h, i) => {
      const cell = ws.getCell(3, i + 1);
      cell.value = h;
      cell.font = { bold: true };
    });

    payable.forEach((r, idx) => {
      const row = idx + 4;
      ws.getCell(row, 1).value = r.employeeId ?? "";
      ws.getCell(row, 2).value = r.name;
      ws.getCell(row, 3).value = NB_MEDIA.ptState;
      ws.getCell(row, 4).value = NB_MEDIA.ptRegisteredLocation;
      ws.getCell(row, 5).value = Math.round(r.grossEarnings);
      ws.getCell(row, 6).value = Math.round(r.professionalTax);
    });

    ws.getColumn(1).width = 16;
    ws.getColumn(2).width = 28;
    ws.getColumn(3).width = 14;
    ws.getColumn(4).width = 20;
    ws.getColumn(5).width = 14;
    ws.getColumn(6).width = 12;

    const buf = await wb.xlsx.writeBuffer();
    const filename = `PT Monthly Statement_${monthLabel}.xlsx`;
    return new NextResponse(buf as any, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) { return serverError(e, "GET /api/hr/payroll/runs/[id]/exports/pt-statement"); }
}
