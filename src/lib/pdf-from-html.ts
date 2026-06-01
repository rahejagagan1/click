// Server-side HTML → PDF renderer. Uses headless Chrome (via puppeteer)
// so the offer letter PDF matches the HTML preview pixel-for-pixel —
// no need to re-implement the layout in a programmatic PDF library.
//
// Used by the offer-send flow:
//   1. buildOfferLetterHTML(args)  → multi-page HTML
//   2. renderHtmlToPdf(html)       → PDF bytes
//   3. attached to the email; the email body itself becomes a short
//      cover note rather than the full letter text.
//
// Puppeteer ships its own Chromium binary (~170 MB on disk, downloaded
// once on `npm install`). On the VPS, this is a one-time cost. The
// browser instance is launched per-request and disposed in `finally`
// so a crash in PDF generation can't leak a long-lived Chromium.

import puppeteer from "puppeteer";
import { buildOfferLetterHTML } from "./offer-letter";

// Helper for the offer-send flow — builds the multi-page HTML from the
// stored OfferLetter row + the original JobApplication context, then
// renders it to PDF bytes. Returns { pdf, filename, mime } ready to be
// passed straight to sendEmail's attachments array.
export async function renderOfferLetterPdf(args: {
  candidateName: string;
  jobRole: string;
  annualCtcINR: number | null;
  joiningDate?: Date | string | null;
  acceptanceDeadline?: Date | string | null;
  /** Optional: HR's edited body (overrides the auto-generated one). */
  editedBody?: string | null;
  hrContactEmail?: string;
}): Promise<{ pdf: Buffer; filename: string; mime: string }> {
  const html = buildOfferLetterHTML({
    candidateName:      args.candidateName,
    jobRole:            args.jobRole,
    annualCtcINR:       args.annualCtcINR,
    joiningDate:        args.joiningDate ?? null,
    acceptanceDeadline: args.acceptanceDeadline ?? null,
    editedBody:         args.editedBody ?? undefined,
    hrContactEmail:     args.hrContactEmail,
  });
  const pdf = await renderHtmlToPdf(html);
  // Safe filename for email attachment headers.
  const safeName = args.candidateName.replace(/[\r\n"\/\\]/g, "").slice(0, 80) || "Candidate";
  return {
    pdf,
    filename: `Offer Letter - ${safeName}.pdf`,
    mime:     "application/pdf",
  };
}

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    // Args required to run as root on Linux without --sandbox warnings.
    // Safe to pass everywhere — Windows / macOS ignore unknown flags.
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    // setContent with a self-contained HTML doc — `buildOfferLetterHTML`
    // already inlines its own <style>, so no external assets to wait
    // for. waitUntil:"load" is enough; "networkidle0" would deadlock
    // because there's never any network traffic to settle.
    await page.setContent(html, { waitUntil: "load" });
    // Emulate print media so @media print rules in the HTML's <style>
    // (page breaks, hidden hints, etc.) actually apply.
    await page.emulateMediaType("print");
    const pdfBytes = await page.pdf({
      format: "A4",
      // 0 margins because `buildOfferLetterHTML` declares its own
      // @page rule with mm-based margins.
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      printBackground: true,
      preferCSSPageSize: true,
    });
    // page.pdf returns Uint8Array in puppeteer v22+; convert to Buffer
    // so nodemailer's attachments[] accepts it without extra coercion.
    return Buffer.from(pdfBytes);
  } finally {
    await browser.close();
  }
}
