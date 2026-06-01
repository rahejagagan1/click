// Render the offer letter by filling in placeholders directly inside
// the .docx template. No coordinate math, no overlay edge cases —
// pure string substitution on the document's XML. Text reflows
// naturally because Word/Google Docs handles layout when the
// candidate opens the file.
//
// Approach:
//   1. Load public/templates/offer-letter-template.docx as a zip.
//   2. Read word/document.xml — the doc's content as Office XML.
//   3. Find/replace each placeholder string in the XML. We verified
//      via scripts/_inspect-docx-runs.ts that every placeholder is
//      intact in a single <w:t> run, so plain regex replacement is
//      enough — no need to merge split runs.
//   4. Re-zip and return the modified .docx bytes.
//
// "10th January 2024" appears twice (letter date + application date).
// Replaced in order: first match = letter date, second = application
// date. The other placeholders all map 1:1 to a single value.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import PizZip from "pizzip";

const TEMPLATE_PATH = resolve(process.cwd(), "public", "templates", "offer-letter-template.docx");

export type DocxOfferArgs = {
  candidateName:       string;
  jobRole:             string;
  letterDate?:         Date | string | null;
  applicationDate?:    Date | string | null;
  joiningDate?:        Date | string | null;
  acceptanceDeadline?: Date | string | null;
  annualCtcINR?:       number | null;
  hrContactName?:      string;
};

// ── Date helpers ────────────────────────────────────────────────────
function fmtLongDate(d: Date | string | null | undefined, fallback = "DD/MM/YYYY"): string {
  if (!d) return fallback;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return fallback;
  const day   = dt.getDate();
  const month = dt.toLocaleString("en-IN", { month: "long" });
  const year  = dt.getFullYear();
  const suffix = (day % 10 === 1 && day !== 11) ? "st"
               : (day % 10 === 2 && day !== 12) ? "nd"
               : (day % 10 === 3 && day !== 13) ? "rd" : "th";
  return `${day}${suffix} ${month} ${year}`;
}

function fmtSlashDate(d: Date | string | null | undefined, fallback = "DD/MM/YYYY"): string {
  if (!d) return fallback;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return fallback;
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${dt.getFullYear()}`;
}

function ctcToLpa(annualCtcINR: number | null | undefined): string {
  if (!annualCtcINR || annualCtcINR <= 0) return "XX";
  return (annualCtcINR / 100_000).toFixed(2).replace(/\.00$/, "");
}

/** XML-escape a value before injecting it into the docx's XML. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Replace the Nth occurrence of `needle` in `haystack` with
 *  `replacement`. Both `needle` and `replacement` are PLAIN text;
 *  replacement is xml-escaped first. */
function replaceNth(haystack: string, needle: string, replacement: string, n: number): string {
  let idx = -1;
  for (let i = 0; i <= n; i++) {
    idx = haystack.indexOf(needle, idx + 1);
    if (idx === -1) return haystack;
  }
  return haystack.slice(0, idx) + xmlEscape(replacement) + haystack.slice(idx + needle.length);
}

/** Replace EVERY occurrence of `needle` with `replacement`. */
function replaceAll(haystack: string, needle: string, replacement: string): string {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return haystack.replace(new RegExp(escaped, "g"), xmlEscape(replacement));
}

/** Fill the template and return the modified .docx bytes. */
export async function renderOfferLetterDocx(args: DocxOfferArgs): Promise<Buffer> {
  const templateBytes = await readFile(TEMPLATE_PATH);
  const zip = new PizZip(templateBytes);
  const xmlFile = zip.file("word/document.xml");
  if (!xmlFile) throw new Error("word/document.xml not found in template");
  let xml = xmlFile.asText();

  // Resolve values.
  const letterDate         = fmtLongDate(args.letterDate ?? new Date());
  const candidateName      = (args.candidateName || "Candidate Name").trim();
  const applicationDate    = fmtLongDate(args.applicationDate ?? null, "—");
  const jobRole            = (args.jobRole || "Job Role").trim();
  const joiningDate        = fmtSlashDate(args.joiningDate ?? null);
  const acceptanceDeadline = fmtSlashDate(args.acceptanceDeadline ?? null);
  const annualLPA          = ctcToLpa(args.annualCtcINR);
  const hrContactName      = (args.hrContactName ?? "Vanshika").trim();

  // ── 1. "10th January 2024" appears TWICE — letter date first,
  // application date second. Replace in order so they don't get the
  // same value.
  xml = replaceNth(xml, "10th January 2024", letterDate,      0);
  xml = replaceNth(xml, "10th January 2024", applicationDate, 0);  // n=0 because we already consumed the first

  // ── 2. Everywhere-the-same substitutions.
  xml = replaceAll(xml, "Candidate Name", candidateName);
  xml = replaceAll(xml, "Job Role",       jobRole);
  xml = replaceAll(xml, "DD/MM/YYYY",     joiningDate);
  xml = replaceAll(xml, "dd/mm/yyyy",     acceptanceDeadline);

  // ── 3. Annexure A annual LPA: replace bare "XX" with the LPA value
  // (don't replace "XX" inside other words; we know it only appears
  // as `"XX"` per the inspect-runs probe so this is safe).
  xml = replaceAll(xml, "XX", annualLPA);

  // ── 4. HR contact at the bottom — Tanvi → Vanshika (or whoever).
  xml = replaceAll(xml, "Tanvi", hrContactName);

  zip.file("word/document.xml", xml);
  const out = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
  return out;
}

// ── Adapter for the email-send flow ────────────────────────────────
// Pipeline:
//   1. Fill the .docx template via XML find/replace (above).
//   2. Convert filled .docx → PDF (LibreOffice on VPS, Word COM on
//      Windows dev). Conversion preserves the template's formatting
//      exactly because we're letting Word/LO render the doc.
//   3. Email attaches the PDF.
//
// If PDF conversion fails (no LibreOffice + non-Windows), we fall
// back to attaching the .docx so the candidate still gets the offer —
// just in editable form.
export async function renderOfferLetterDocxAttachment(args: DocxOfferArgs): Promise<{
  pdf: Buffer; filename: string; mime: string;
}> {
  const safeName = args.candidateName.replace(/[\r\n"\/\\]/g, "").slice(0, 80) || "Candidate";
  const docxBytes = await renderOfferLetterDocx(args);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { docxToPdf } = require("./docx-to-pdf") as typeof import("./docx-to-pdf");
  try {
    const pdfBytes = await docxToPdf(docxBytes);
    return {
      pdf:      pdfBytes,
      filename: `Offer Letter - ${safeName}.pdf`,
      mime:     "application/pdf",
    };
  } catch (e: any) {
    console.error("[offer-letter] docx→pdf conversion failed; attaching docx instead:", e?.message ?? e);
    return {
      pdf:      docxBytes,
      filename: `Offer Letter - ${safeName}.docx`,
      mime:     "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }
}
