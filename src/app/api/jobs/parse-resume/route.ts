// Smart resume parser. Accepts a PDF / DOC / DOCX upload, extracts the
// raw text, and uses regex heuristics to surface the candidate's basic
// profile. The candidate-facing form calls this BEFORE submission so it
// can pre-fill name / email / phone / LinkedIn — saving them ~30 seconds
// of typing and reducing transcription errors.
//
// Public route (no auth): the apply form is itself public. The 5MB +
// extension whitelist mirrors the apply endpoint so we can't be used as
// a generic file-upload bucket.

import { NextRequest, NextResponse } from "next/server";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
// Generous whitelist — any common resume / text format is OK. If we
// can't extract text we just return empty parsed + a warning, never
// a hard error, so the candidate can still proceed manually.
const ALLOWED_EXTS = new Set([
  ".pdf", ".doc", ".docx",
  ".rtf", ".odt", ".pages",
  ".txt", ".md", ".html", ".htm",
]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

// Strip all non-printable bytes from a buffer — good-enough for legacy
// .doc, .rtf, .odt etc. when we don't have a dedicated parser.
function asciiStrip(buf: Buffer): string {
  return buf.toString("utf8").replace(/[^\x20-\x7e\n]+/g, " ");
}

async function extractText(file: File): Promise<string> {
  const ext = extOf(file.name);
  const buf = Buffer.from(await file.arrayBuffer());

  if (ext === ".pdf") {
    // Use pdfjs-dist directly. In Next.js's chunked dev/prod build, the
    // automatic "fake worker" loader can't find the worker source — so
    // we resolve the absolute path to the worker file in node_modules
    // ourselves and feed it as a file:// URL. Done before getDocument()
    // and only on first call.
    const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      try {
        const req = createRequire(import.meta.url);
        const workerPath = req.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
      } catch {
        // Fallback: assume the standard install path under cwd.
        const fallback = path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(fallback).href;
      }
    }
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buf),
      isEvalSupported: false,
      useSystemFonts: false,
    });
    const doc = await loadingTask.promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // Reconstruct line breaks from Y-position changes between text
      // items. pdfjs returns text in reading order with a transform
      // matrix `[a,b,c,d,e,f]` where `f` is the y-coordinate; a change
      // in `f` (or an explicit `hasEOL` flag) means a new line.
      type PdfItem = { str?: string; hasEOL?: boolean; transform?: number[] };
      const items = content.items as PdfItem[];
      let lastY: number | null = null;
      let buf = "";
      for (const it of items) {
        const y = it.transform?.[5];
        if (it.hasEOL || (lastY != null && y != null && Math.abs(y - lastY) > 2)) {
          buf += "\n";
        } else if (buf && !buf.endsWith(" ") && !buf.endsWith("\n")) {
          buf += " ";
        }
        buf += it.str ?? "";
        if (y != null) lastY = y;
      }
      pages.push(buf);
      page.cleanup();
    }
    await doc.destroy();
    return pages.join("\n");
  }
  if (ext === ".docx") {
    const mammoth = await import("mammoth");
    const out = await mammoth.extractRawText({ buffer: buf });
    return out.value || "";
  }
  if (ext === ".html" || ext === ".htm") {
    // Strip tags + entity-decode the basic ones. Good enough for the
    // contact-info regexes that drive auto-fill.
    return buf.toString("utf8")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  }
  if (ext === ".txt" || ext === ".md") {
    return buf.toString("utf8");
  }
  // Legacy .doc / .rtf / .odt / .pages and any other binary-ish format —
  // fall back to ASCII-strip. Catches contact info even when formatting
  // is lost. Never throws.
  return asciiStrip(buf);
}

/// Pull the most likely "first non-empty line that looks like a name"
/// from the top of the resume. Skips lines that are obviously contact
/// info, addresses, or section headers. Accepts both Title Case
/// ("Jane Doe") and ALL CAPS ("JANE DOE") since both are common.
function guessName(text: string): string | null {
  const head = text.slice(0, 2000).split(/\r?\n/);
  const isHeading = (t: string) =>
    /\b(curriculum vitae|curriculum|resume|profile|summary|objective|contact|education|experience|skills?|projects?|certifications?|languages?|hobbies)\b/i.test(t);
  const looksLikeName = (s: string) => {
    const t = s.trim();
    if (t.length < 3 || t.length > 60) return false;
    if (/[@\d/]/.test(t))             return false;        // skip emails / numbers / dates
    if (/^https?:\/\//i.test(t))      return false;
    if (isHeading(t))                  return false;
    const words = t.split(/\s+/);
    if (words.length < 2 || words.length > 5) return false;
    // Each word must be either Title Case (Jane), ALL CAPS (JANE), or
    // a hyphenated/apostrophed variant ("O'Neill", "Smith-Jones").
    return words.every(w =>
      /^[A-Z][A-Za-z'-]+$/.test(w) ||                  // Title Case
      /^[A-Z]{2,}(?:[-'][A-Z]+)*$/.test(w),            // ALL CAPS
    );
  };
  for (const line of head) {
    if (looksLikeName(line)) {
      // Normalise ALL-CAPS to Title-Case so the form's text-case looks
      // natural when populated.
      const t = line.trim();
      const isAllCaps = !/[a-z]/.test(t);
      return isAllCaps
        ? t.split(/\s+/).map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(" ")
        : t;
    }
  }
  return null;
}

/// Fallback when guessName fails: derive the candidate's first name
/// from the uploaded filename. Strips the extension, common suffixes
/// like "-CV", and converts to Title Case. e.g. "Kashish.CV.pdf" →
/// "Kashish".
function nameFromFilename(filename: string): string | null {
  let base = filename.replace(/\.[^.]+$/, "")             // strip .pdf
                     .replace(/[._-]+/g, " ")             // separators
                     .replace(/\b(cv|resume|curriculum|vitae|profile)\b/gi, " ")
                     .replace(/\s+/g, " ")
                     .trim();
  if (!base) return null;
  // Title Case
  base = base.split(" ")
             .filter(Boolean)
             .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
             .join(" ");
  // Bail if all-numeric or too short.
  if (!/[A-Za-z]/.test(base) || base.length < 2) return null;
  return base;
}

function splitName(full: string): { first: string; middle: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", middle: "", last: "" };
  if (parts.length === 1) return { first: parts[0], middle: "", last: "" };
  if (parts.length === 2) return { first: parts[0], middle: "", last: parts[1] };
  return { first: parts[0], middle: parts.slice(1, -1).join(" "), last: parts[parts.length - 1] };
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("resume");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "Resume must be 5 MB or smaller" }, { status: 400 });
    }
    const ext = extOf(file.name);
    if (!ALLOWED_EXTS.has(ext)) {
      // Soft-fail: don't 400 on unfamiliar extensions. The candidate's
      // resume is still uploaded separately by the apply endpoint —
      // here we only auto-fill, so an unknown extension just means we
      // skip parsing instead of blocking the whole flow.
      return NextResponse.json({
        parsed: {},
        warning: `We couldn't auto-fill from a "${ext || "unknown"}" file — please fill in the form manually.`,
      });
    }

    let text = "";
    try { text = await extractText(file); }
    catch (e: any) {
      // Log the full stack server-side AND surface a hint to the client
      // so silent parse failures don't leave the candidate confused.
      console.error("[parse-resume] text extraction failed:", e);
      const detail = e?.message ? ` (${String(e.message).slice(0, 140)})` : "";
      return NextResponse.json({
        parsed: {},
        warning: `Could not read this resume${detail} — please fill in the form manually.`,
      });
    }
    if (!text || text.trim().length < 20) {
      // Extracted but unusable (image-only PDF, scanned doc, etc.).
      return NextResponse.json({
        parsed: {},
        warning: "This resume appears to be a scanned image — please fill in the form manually.",
      });
    }

    // ── Regex extraction ───────────────────────────────────────────────
    // Email: standard RFC-loose pattern. Take the first match.
    const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/i);
    const email = emailMatch?.[0] ?? null;

    // Phone: matches "+91 98xxxxxxx", "+1-555-555-1234", "9876543210", etc.
    // Strips formatting then keeps any 10+ digit run with optional country code.
    const phoneMatch =
      text.match(/(\+?\d{1,3}[\s.-]?)?(\(?\d{2,4}\)?[\s.-]?)?\d{3}[\s.-]?\d{3,4}[\s.-]?\d{0,4}/g) || [];
    let phoneRaw: string | null = null;
    for (const candidate of phoneMatch) {
      const digits = candidate.replace(/\D/g, "");
      if (digits.length >= 10 && digits.length <= 15) { phoneRaw = candidate.trim(); break; }
    }
    let mobileCountryCode: string | null = null;
    let phone: string | null = null;
    if (phoneRaw) {
      const m = phoneRaw.match(/^(\+\d{1,3})\s*(.+)$/);
      if (m) { mobileCountryCode = m[1]; phone = m[2].replace(/\s+/g, " ").trim(); }
      else   { phone = phoneRaw; }
    }

    // LinkedIn URL: linkedin.com/in/<handle>
    const linkedinMatch = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i);
    const linkedinUrl = linkedinMatch?.[0]
      ? (linkedinMatch[0].startsWith("http") ? linkedinMatch[0] : "https://" + linkedinMatch[0])
      : null;

    // Portfolio URL — first non-LinkedIn http(s) link.
    const urlMatch = text.match(/https?:\/\/[^\s,;)]+/gi) || [];
    const portfolioUrl = urlMatch
      .filter(u => !/linkedin\.com/i.test(u))
      .filter(u => !u.endsWith(".pdf") && !u.endsWith(".doc") && !u.endsWith(".docx"))[0] ?? null;

    // Name — best-effort first-line guess, then fall back to the
    // uploaded filename (e.g. "Kashish.CV.pdf" → "Kashish") so the
    // First Name field at least gets a sensible default.
    const fullName = guessName(text) || nameFromFilename(file.name);
    const { first, middle, last } = fullName ? splitName(fullName) : { first: "", middle: "", last: "" };

    // Years of experience — look for "X years" near the word "experience".
    const yearsMatch = text.match(/(\d{1,2})\+?\s*(?:yrs?|years?)\s+(?:of\s+)?experience/i);
    const experienceYears = yearsMatch ? Math.min(60, parseInt(yearsMatch[1], 10)) : null;

    return NextResponse.json({
      parsed: {
        firstName:  first  || null,
        middleName: middle || null,
        lastName:   last   || null,
        fullName,
        email,
        phone,
        mobileCountryCode,
        linkedinUrl,
        portfolioUrl,
        experienceYears,
      },
    });
  } catch (e: any) {
    // Top-level safety net: never 500 on the parse path. The candidate
    // can still submit the form — auto-fill is just a convenience.
    console.error("[/api/jobs/parse-resume] failed:", e);
    const detail = e?.message ? ` (${String(e.message).slice(0, 140)})` : "";
    return NextResponse.json({
      parsed: {},
      warning: `Could not auto-fill from this resume${detail} — please fill in the form manually.`,
    });
  }
}
