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
    // PDF link hyperlinks live in PER-PAGE ANNOTATIONS, not in the
    // text stream. Many designed resumes only show icons (no visible
    // URL text), and even when the URL IS rendered as text, pdfjs
    // often splits it into one-glyph-per-item (causing the LinkedIn /
    // GitHub regex to fail because the dots and slashes land on
    // separate lines after reconstruction). Collect annotation URLs
    // separately and append them at the end — the existing regexes
    // pick them up cleanly.
    const annotUrls = new Set<string>();
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
      // Collect hyperlink annotations — covers icon-only social links
      // and PDFs where the URL text is glyph-shredded by pdfjs. Each
      // annotation looks like { subtype: "Link", url: "https://..." }.
      try {
        const annots = await page.getAnnotations();
        type PdfAnnot = { url?: string; subtype?: string };
        for (const a of annots as PdfAnnot[]) {
          if (a.url) annotUrls.add(a.url);
        }
      } catch {
        // Some PDFs throw on getAnnotations(); ignore + continue.
      }
      page.cleanup();
    }
    await doc.destroy();
    // Append annotation URLs as their own line block so the regexes
    // running against the joined text find them.
    const tail = annotUrls.size > 0
      ? "\n\n" + [...annotUrls].join("\n")
      : "";
    return pages.join("\n") + tail;
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

// ── Section extraction ───────────────────────────────────────────────
// Resumes typically split into named blocks: EDUCATION, SKILLS, etc.
// Find the heading line for a section, then take everything until the
// next heading. Headings are detected by short uppercase-or-titlecase
// lines that match well-known labels. Returns "" when no section.
const SECTION_HEADINGS = [
  // listed roughly in the order they appear so adjacency boundaries work
  "summary", "objective", "profile", "about me",
  "experience", "work experience", "professional experience", "employment",
  "work history", "career history", "career",
  "education", "academic", "qualifications", "academics",
  "skills", "technical skills", "core skills", "key skills", "expertise", "key competencies",
  "languages", "languages known",
  "projects", "personal projects", "key projects",
  "certifications", "certificates", "courses",
  "achievements", "awards", "accomplishments",
  "hobbies", "interests",
  "references", "contact", "personal details",
  "responsibilities", "key responsibilities",
];

function isHeadingLine(line: string): { kind: string | null; raw: string } {
  const t = line.trim().replace(/[:•·\-_=*]+$/g, "").trim();
  if (t.length < 3 || t.length > 40) return { kind: null, raw: line };
  // Heuristic: heading lines are short + don't contain commas/digits/periods
  // and match one of the canonical labels (case-insensitive).
  const norm = t.toLowerCase();
  for (const h of SECTION_HEADINGS) {
    if (norm === h || norm === h.toUpperCase()) return { kind: h, raw: line };
    // Allow "Education:" / "EDUCATION" / "Education -"
    if (norm.replace(/[^\w\s]/g, "").trim() === h) return { kind: h, raw: line };
  }
  return { kind: null, raw: line };
}

function extractSection(text: string, names: string[]): string {
  const lines = text.split(/\r?\n/);
  const wanted = names.map((n) => n.toLowerCase());
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const { kind } = isHeadingLine(lines[i]);
    if (kind && wanted.includes(kind)) { startLine = i + 1; break; }
  }
  if (startLine === -1) return "";
  let endLine = lines.length;
  for (let i = startLine; i < lines.length; i++) {
    const { kind } = isHeadingLine(lines[i]);
    if (kind && !wanted.includes(kind)) { endLine = i; break; }
  }
  return lines.slice(startLine, endLine).join("\n").trim();
}

// ── Education ─────────────────────────────────────────────────────────
// Parse the EDUCATION block into the structured EducationEntry[] shape
// the apply form expects: { course, branch, startOfCourse, endOfCourse,
// university, location }. Heuristics rather than ML — covers the
// common Indian resume shapes (Bachelor / Master / Diploma / MBA / BCA
// + a University/Institute/College name + a year range).
type ExtractedEducation = {
  course: string;
  branch: string;
  startOfCourse: string;
  endOfCourse: string;
  university: string;
  location: string;
};

// Accept common misspellings — "Bachlor" (missing e) shows up on a
// surprising number of real resumes. Same for "Bachelours" / "Masters".
const DEGREE_PATTERNS = [
  /\b(Bach(?:e?l|elo|elor)(?:o?u?r)?s?(?:'s)?(?:\s+of\s+[\w ]+?)?(?:\s+\([A-Z]+\))?)\b/i,
  /\b(Mast(?:e?r|ers?)(?:'s)?(?:\s+of\s+[\w ]+?)?(?:\s+\([A-Z]+\))?)\b/i,
  /\b(MBA|BBA|BCA|MCA|BSc|MSc|B\.?Sc|M\.?Sc|B\.?A|M\.?A|B\.?Com|M\.?Com|B\.?Tech|M\.?Tech|B\.?E|M\.?E|PhD|Doctorate|Diploma|HSC|SSC|XII|X|10\+2|12th|10th|Postgraduate|Undergraduate)\b/i,
];

// Heal pdfjs's fragmentation:
//   • Collapse multiple spaces to one.
//   • Re-glue split years: "202 3" → "2023" (single-digit run inside
//     what should be a 4-digit year).
//   • Re-glue lone-uppercase + lowercase tail: "B usiness" → "Business".
//   • Strip the rogue half-space pdfjs inserts before "%": "84.6 %" → "84.6%".
function healFragmentedText(s: string): string {
  let out = s;
  out = out.replace(/[ \t]+/g, " ");
  // "B usiness" → "Business"  (single capital, space, lowercase word)
  out = out.replace(/\b([A-Z]) ([a-z]{3,})\b/g, "$1$2");
  // Years like "20 23", "202 3", or "2 023" → "2023". A year is
  // exactly 4 digits with optional spaces between any of them; the
  // (19|20) prefix anchors the match so this doesn't grab random
  // 4-digit numeric runs.
  out = out.replace(/\b(19|20)\s?(\d)\s?(\d)\b/g, "$1$2$3");
  // Second pass: covers the variant where pdfjs split the prefix
  // itself ("20 23" instead of "202 3").
  out = out.replace(/\b(1|2)\s+(9|0)\s?(\d)\s?(\d)\b/g, "$1$2$3$4");
  // "84.6 %" → "84.6%"
  out = out.replace(/(\d)\s+%/g, "$1%");
  return out;
}

function parseEducations(section: string): ExtractedEducation[] {
  if (!section.trim()) return [];

  // Step 1 — heal fragmentation PER LINE so newlines (which separate
  // distinct entries inside the section) are preserved. An earlier
  // attempt joined paragraphs with whitespace and ended up gluing
  // three completely separate education entries into one merged
  // university string. Only collapse intra-line spacing here.
  const lines = section
    .split(/\r?\n/)
    .map((l) => healFragmentedText(l.trim()))
    .filter(Boolean);

  // Step 2 — group lines into entries. The robust signal is a
  // UNIVERSITY/INSTITUTE/COLLEGE/SCHOOL line — that always starts a
  // new entry. Degree lines (Bachelor / XII / X) belong to whichever
  // university line came right before them, so they DON'T flush.
  const entries: string[][] = [];
  let cur: string[] = [];
  const flush = () => { if (cur.length) { entries.push(cur); cur = []; } };
  for (const line of lines) {
    const hasUni = /\b(University|Institute|College|Polytechnic|Academy|School)\b/i.test(line);
    if (hasUni && cur.length > 0) flush();
    cur.push(line);
  }
  flush();

  const results: ExtractedEducation[] = [];
  for (const block of entries) {
    const text = block.join(" ");

    // ── Year range ────────────────────────────────────────────────
    // Tolerant of healed-but-still-spaced variants: "2023 – 2026",
    // "2023-2026", "Sept 2020 – May 2024" (years only).
    let startOfCourse = "";
    let endOfCourse   = "";
    const yearRange = text.match(/(19|20)\d{2}\s*(?:[-–—]|to)\s*(?:(?:19|20)\d{2}|present|current)/i);
    if (yearRange) {
      const ys = yearRange[0].match(/(19|20)\d{2}/g) ?? [];
      startOfCourse = ys[0] ?? "";
      endOfCourse   = ys[1] ?? (/present|current/i.test(yearRange[0]) ? "Present" : "");
    } else {
      const single = text.match(/(19|20)\d{2}/);
      if (single) endOfCourse = single[0];
    }

    // ── Degree / course ──────────────────────────────────────────
    // Capture the degree keyword PLUS what follows "of" so we get the
    // full phrase ("Bachelor of Business Administration"). Stop at
    // " — ", "—", "-", "|" or "," — they typically separate the
    // degree from CGPA / honors / institution.
    let course = "";
    let branch = "";
    const courseMatch = text.match(/(Bach(?:e?l|elo|elor)(?:o?u?r)?s?|Mast(?:e?r|ers?))[A-Za-z'’ ]*?(?:\s+of\s+([A-Za-z& ]{3,80}?))?(?=\s*(?:—|–|-|\||,|CGPA|GPA|Percentage|$))/i);
    if (courseMatch) {
      course = courseMatch[0].trim();
      if (courseMatch[2]) branch = courseMatch[2].trim();
    }
    if (!course) {
      // Fall back to short-form abbreviations.
      const abbrev = text.match(/\b(MBA|BBA|BCA|MCA|BSc|MSc|B\.?Tech|M\.?Tech|B\.?A|M\.?A|B\.?Com|M\.?Com|PhD|Diploma|XII|X|10\+2|12th|10th)\b/i);
      if (abbrev) course = abbrev[0];
    }

    // ── University name ──────────────────────────────────────────
    // The line containing the university keyword. Strip any trailing
    // year range so we don't end up with "Lovely Prof Univ 2023 – 2026".
    let university = "";
    const uniLine = block.find((l) =>
      /\b(University|Institute|College|Polytechnic|Academy|School)\b/i.test(l),
    );
    if (uniLine) {
      university = uniLine
        .replace(/\(?\s*(19|20)\d{2}\s*[-–—]\s*(?:(19|20)\d{2}|present|current)\s*\)?/i, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    // ── Location ─────────────────────────────────────────────────
    // "Phagwara, Punjab" pattern at the end of the degree line. Look
    // for "<City>, <State>" near the end; reject if it overlaps the
    // CGPA fragment.
    let location = "";
    const locMatch = text.match(/([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?,\s*[A-Z][a-zA-Z]+)\s*$/);
    if (locMatch) location = locMatch[1].trim();

    // Keep an entry only when we have *something* useful.
    if (course || university) {
      results.push({ course, branch, startOfCourse, endOfCourse, university, location });
    }
  }
  return results.slice(0, 6);
}

// Last-resort fallback for resumes where pdfjs couldn't read the bold
// degree line at all (font rendered as vector outlines). Scan the
// whole document for university-name + year-range pairs and emit
// minimal entries — better than the empty state.
function scanEducationByUniversityYear(text: string): ExtractedEducation[] {
  const lines = text.split(/\n/).map(l => healFragmentedText(l)).filter(l => l.trim());
  const out: ExtractedEducation[] = [];
  for (const line of lines) {
    if (!/\b(University|Institute|College|Polytechnic|Academy)\b/i.test(line)) continue;
    const yr = line.match(/(19|20)\d{2}\s*[-–—]\s*(?:(?:19|20)\d{2}|present|current)/i);
    if (!yr) continue;
    const ys = yr[0].match(/(19|20)\d{2}/g) ?? [];
    const startOfCourse = ys[0] ?? "";
    const endOfCourse   = ys[1] ?? (/present|current/i.test(yr[0]) ? "Present" : "");
    const university = line
      .replace(/\(?\s*(19|20)\d{2}\s*[-–—]\s*(?:(19|20)\d{2}|present|current)\s*\)?/i, "")
      .replace(/\s+/g, " ")
      .trim();
    out.push({ course: "", branch: "", startOfCourse, endOfCourse, university, location: "" });
  }
  return out.slice(0, 6);
}

// ── Skills + Languages ────────────────────────────────────────────────
// Take the SKILLS (and LANGUAGES) sections and flatten into a string[]
// the apply form's chip input expects. Tolerant of every common bullet
// style (•, ·, ▪, *, -, –, —) AND of bullet characters appearing
// BETWEEN items on the same line ("Skill A • Skill B • Skill C").
//
// Aggressive filtering so we don't pollute the chip list with stray
// sentences from the work-experience block that follows when the
// SKILLS section's terminating heading isn't recognised:
//   • Reject anything longer than 5 words (skills are short labels).
//   • Reject items containing @ (emails), digits (years/phones),
//     a phone-shaped run, or sentence-like punctuation (periods,
//     except for "C++" / "C#" style trailing chars).
//   • Reject items that LOOK like job titles ("Relationship Manager",
//     "Software Engineer") — they're work history.
//   • Reject 1-character tokens (cut-off email/phone fragments).
//   • Hard cap at 20 to discourage runaway extraction.
const JOB_TITLE_HINTS = /\b(Manager|Engineer|Officer|Analyst|Specialist|Associate|Consultant|Director|Executive|Lead|Head|Coordinator|Representative|Assistant|Intern)\b/i;

// Language names that should NEVER appear under SKILLS — they're a
// separate category and confuse HR when mixed in.
const KNOWN_LANGUAGE_NAMES = new Set([
  "english","hindi","punjabi","tamil","telugu","kannada","malayalam","marathi","gujarati",
  "bengali","odia","assamese","sanskrit","urdu",
  "spanish","french","german","italian","portuguese","russian","chinese","mandarin","cantonese",
  "japanese","korean","arabic","dutch","swedish","norwegian","danish","polish","turkish",
  "vietnamese","thai","indonesian","malay","hebrew","greek","czech","hungarian","finnish",
]);

function looksLikeSkill(s: string): boolean {
  if (s.length < 2 || s.length > 40) return false;
  const words = s.split(/\s+/);
  if (words.length > 5) return false;            // sentences ≠ skills
  if (/@/.test(s))                  return false; // emails
  if (/\d{4,}/.test(s))             return false; // 4+ digit runs (years, IDs, phones)
  if (/\+?\d[\d\s-]{6,}/.test(s))   return false; // phone-shaped
  if (/[.!?]/.test(s))              return false; // sentence punctuation
  if (JOB_TITLE_HINTS.test(s))      return false; // job titles slipped in
  if (/^[a-z]{1,2}$/i.test(s))      return false; // single letters / "m"
  if (/^(WORK|HISTORY|EXPERIENCE|EDUCATION|PROFILE|CONTACT|PROJECTS|HOBBIES|REFERENCES|TAGS|SUMMARY)$/i.test(s)) return false;
  // Reject language names — they belong under LANGUAGES, not SKILLS.
  if (KNOWN_LANGUAGE_NAMES.has(s.toLowerCase())) return false;
  return true;
}

function parseSkills(text: string): string[] {
  // SKILLS section ONLY — languages live in their own section and
  // mixing them confuses HR. We additionally filter out any token
  // that happens to be a recognised language name even when it
  // appears inside the SKILLS section (defensive guard).
  const sections = [
    extractSection(text, ["skills", "technical skills", "core skills", "key skills", "expertise", "key competencies"]),
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const sec of sections) {
    if (!sec.trim()) continue;
    // Line-continuation pass: when a line ends with a connecting
    // word ("and", "or", "of", "for", "with", "to", "&"), join the
    // next non-empty line onto it. Many resumes wrap a single skill
    // across two visual lines (e.g. "Relationship building and /
    // management" lands as two text-extraction items).
    const rawLines = sec.split(/\r?\n/);
    const merged: string[] = [];
    for (const ln of rawLines) {
      const t = ln.trim();
      if (!t) { merged.push(""); continue; }
      const prev = merged[merged.length - 1];
      if (prev && /\b(and|or|of|for|with|to|&)$/i.test(prev)) {
        merged[merged.length - 1] = prev + " " + t;
      } else {
        merged.push(t);
      }
    }
    const tokens = merged
      // Strip leading bullet markers AND split on inline bullets so
      // "Skill A • Skill B" becomes two items rather than one item
      // with a "• Skill B" tail.
      .flatMap((l) => l.split(/[•·▪►★]/))
      .map((l) => l.replace(/^[\s*\-–—]+/, "").trim())
      .flatMap((l) => l.split(/[,|;/]/))
      .map((t) => t.trim())
      .filter(Boolean);
    for (const t of tokens) {
      const cleaned = t.replace(/[:.;]+$/, "").replace(/\s+/g, " ").trim();
      if (!looksLikeSkill(cleaned)) continue;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cleaned);
    }
  }
  return out.slice(0, 20);
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

    // URL extraction needs to look at two different views of the text.
    // (1) `text` — the line-broken version that preserves layout (used
    // by the heading/section detection above).
    // (2) `compact` — all whitespace stripped. pdfjs frequently shreds
    // URLs into one-glyph-per-item (each ".", "/", "https", "com"
    // landing on its own line in `text`). Joining without separators
    // recovers the URL string so the regexes can match it. We insert
    // a space BEFORE each `https://` / `http://` so consecutive URLs
    // (e.g. LinkedIn followed by GitHub) terminate cleanly — otherwise
    // they'd glue into one super-string and the handle regex would
    // over-match into the next URL's scheme.
    const compact = text.replace(/\s+/g, "").replace(/(https?:\/\/)/gi, " $1");

    // LinkedIn URL: linkedin.com/in/<handle>
    const linkedinMatch =
      text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i) ||
      compact.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i);
    const linkedinUrl = linkedinMatch?.[0]
      ? (linkedinMatch[0].startsWith("http") ? linkedinMatch[0] : "https://" + linkedinMatch[0])
      : null;

    // GitHub URL — common on developer resumes; treat as the portfolio
    // when nothing else is around.
    const githubMatch =
      text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+\/?/i) ||
      compact.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+\/?/i);
    const githubUrl = githubMatch?.[0]
      ? (githubMatch[0].startsWith("http") ? githubMatch[0] : "https://" + githubMatch[0])
      : null;

    // Portfolio URL — first non-LinkedIn http(s) link. Prefer the
    // GitHub URL when we have one, since dev resumes usually want
    // that surfaced first.
    const allUrls = [
      ...(text.match(/https?:\/\/[^\s,;)]+/gi) || []),
      ...(compact.match(/https?:\/\/[^\s,;)]+/gi) || []),
    ];
    const portfolioUrl = githubUrl ?? allUrls
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

    // Education + skills — best-effort structured extraction so the
    // candidate doesn't have to retype what's already on their CV.
    const educationSection = extractSection(text, ["education", "academic", "qualifications", "academics"]);
    let educations = parseEducations(educationSection);
    // Fallback: many resumes render their bold section headings + the
    // degree name as VECTOR OUTLINES instead of selectable text, so
    // pdfjs returns the text content with "EDUCATION" and "Bachelor
    // of …" completely missing. The university-name + year-range line
    // is usually plain-weight text and DOES come through. Scan the
    // whole document for that pattern when the structured extractor
    // came up empty, so candidates still get an entry.
    if (educations.length === 0) {
      educations = scanEducationByUniversityYear(text);
    }
    const skills     = parseSkills(text);

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
        educations,
        skills,
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
