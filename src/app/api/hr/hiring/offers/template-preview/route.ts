// Render the offer letter template with the given inputs and return
// the resulting body as plain text. The Offer modal's "Generate"
// button calls this so the in-app preview shows EXACTLY what the
// candidate will see in the final PDF (no hardcoded
// approximation that drifts from the real .docx template).
//
// Pipeline:
//   1. Fill placeholders in the .docx (same code path the email
//      attachment uses).
//   2. Extract raw text via mammoth.
//   3. Return as JSON.
//
// HR-admin only — same gate as the rest of the offer flow.

import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { renderOfferLetterDocx } from "@/lib/offer-letter-from-docx";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const docxBytes = await renderOfferLetterDocx({
      candidateName:      String(body?.candidateName ?? "").trim(),
      jobRole:            String(body?.jobRole ?? "").trim(),
      letterDate:         body?.letterDate         ?? new Date().toISOString(),
      applicationDate:    body?.applicationDate    ?? null,
      joiningDate:        body?.joiningDate        ?? null,
      acceptanceDeadline: body?.acceptanceDeadline ?? null,
      annualCtcINR:       body?.annualCtcINR != null ? Number(body.annualCtcINR) : null,
      hrContactName:      body?.hrContactName ? String(body.hrContactName) : undefined,
    });

    // Convert the filled docx to raw text. mammoth.extractRawText
    // accepts a Buffer via `buffer` (not `path`), avoiding a
    // round-trip through disk.
    const result = await mammoth.extractRawText({ buffer: docxBytes });
    // Mammoth output uses LF line endings — normalise paragraph
    // spacing so the textarea preview reads cleanly.
    const text = result.value
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return NextResponse.json({ text });
  } catch (e) {
    return serverError(e, "POST /api/hr/hiring/offers/template-preview");
  }
}
