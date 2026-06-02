// EmployerECR_{Mon-YYYY}.xlsx — EPFO Electronic Challan-cum-Return.
//
// Standard EPFO upload format: single sheet, no title rows, headers on
// R1 only, then one data row per PF-eligible employee. EPS split is
// disabled for now (everyone gets EPS=0 and the full 12% employer share
// goes to EPF) — HR will introduce the per-employee toggle later.

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireAuth, canViewSalary, serverError } from "@/lib/api-auth";
import { loadExportRows, monYearDash, EPF_CEILING, EDLI_CEILING } from "@/lib/payroll-exports";

export const dynamic = "force-dynamic";

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

    // ECR only covers PF members; skip non-eligible employees and any
    // on-hold payslips (no contribution to remit for those).
    const eligible = rows.filter(r => r.pfEligible && r.status !== "on_hold");

    // EPFO won't accept the file if any row is missing a UAN — block
    // with a 422 + the list so HR can backfill before re-trying.
    const missing = eligible.filter(r => !r.uanNumber);
    if (missing.length > 0) {
      return NextResponse.json({
        error: "Cannot export ECR — UAN missing for some PF-eligible employees",
        missing: missing.map(m => ({ name: m.name, employeeId: m.employeeId })),
      }, { status: 422 });
    }

    const sheetName = `EmployerECR_${monYearDash(run.month, run.year)}`;

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(sheetName);

    const headers = [
      "UAN", "MEMBER NAME", "GROSS WAGES",
      "EPF WAGES", "EPS WAGES", "EDLI WAGES",
      "EE SHARE REMITTED", "EPS CONTRIBUTION REMITTED", "ER SHARE REMITTED",
      "NCP DAYS", "REFUND OF ADVANCE",
    ];
    headers.forEach((h, i) => {
      const cell = ws.getCell(1, i + 1);
      cell.value = h;
      cell.font = { bold: true };
    });

    eligible.forEach((r, idx) => {
      const row = idx + 2;

      // Statutory wages — PF is computed on basic+DA capped at the
      // ceiling. EDLI always sits at the ceiling regardless.
      const monthlyBasicDa = (r.basicAnnual + r.daAnnual) / 12;
      const epfWages = Math.min(monthlyBasicDa, EPF_CEILING);
      const edliWages = EDLI_CEILING;
      // EPS toggle is future — everyone is EPS=0 today.
      const epsWages = 0;
      // EE share = 12% of EPF wages. ER share = same minus EPS contrib.
      // With EPS=0 across the board, ER == EE for now.
      const eeShare = Math.round(epfWages * 0.12);
      const epsContrib = Math.round(epsWages * 0.0833);
      const erShare = eeShare - epsContrib;

      ws.getCell(row, 1).value = r.uanNumber ?? "";
      ws.getCell(row, 2).value = r.name;
      ws.getCell(row, 3).value = Math.round(r.grossEarnings);
      ws.getCell(row, 4).value = Math.round(epfWages);
      ws.getCell(row, 5).value = epsWages;
      ws.getCell(row, 6).value = Math.round(edliWages);
      ws.getCell(row, 7).value = eeShare;
      ws.getCell(row, 8).value = epsContrib;
      ws.getCell(row, 9).value = erShare;
      // EPFO expects NCP as an integer; round up half-days so a 0.5
      // doesn't silently get truncated to 0 in the filing.
      ws.getCell(row, 10).value = Math.ceil(r.lopDays);
      ws.getCell(row, 11).value = 0;
    });

    [12, 22, 12, 12, 12, 12, 18, 22, 18, 10, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    const buf = await wb.xlsx.writeBuffer();
    const filename = `${sheetName}.xlsx`;
    return new NextResponse(buf as any, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) { return serverError(e, "GET /api/hr/payroll/runs/[id]/exports/employer-ecr"); }
}
