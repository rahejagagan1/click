// Shared resume-parsing helpers. Both the public /api/jobs/parse-resume
// endpoint (called by the candidate apply form) and the HR-side auto-
// backfill (run when a candidate's drawer loads and key profile fields
// are still null) call these.
//
// Returns plain JSON shapes — the consumers serialize / persist them.

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export type ExtractedEducation = {
  course: string;
  branch: string;
  startOfCourse: string;
  endOfCourse: string;
  university: string;
  location: string;
};

export type ExtractedResume = {
  linkedinUrl:  string | null;
  portfolioUrl: string | null;
  educations:   ExtractedEducation[];
  skills:       string[];
  /** Pulled from the LANGUAGES section (kept separate from skills so
   *  "Hindi" / "English" don't show up under a SKILLS chip group). */
  languages:    string[];
};

// ── Text extraction ───────────────────────────────────────────────
// PDF via pdfjs-dist (custom worker resolution because Next.js's
// chunked build can't find the worker file otherwise). DOCX via
// mammoth. Other formats fall back to ASCII strip.
export async function extractText(buf: Buffer, fileName: string): Promise<string> {
  const ext = (fileName.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();

  if (ext === ".pdf") {
    const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      try {
        const req = createRequire(import.meta.url);
        pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
          req.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"),
        ).href;
      } catch { /* swallow — caller handles empty text */ }
    }
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buf),
      isEvalSupported: false,
      useSystemFonts: false,
    }).promise;
    const annotUrls = new Set<string>();
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      type Item = { str?: string; hasEOL?: boolean; transform?: number[] };
      let lastY: number | null = null;
      let pageBuf = "";
      for (const it of content.items as Item[]) {
        const y = it.transform?.[5];
        if (it.hasEOL || (lastY != null && y != null && Math.abs(y - lastY) > 2)) pageBuf += "\n";
        else if (pageBuf && !pageBuf.endsWith(" ") && !pageBuf.endsWith("\n")) pageBuf += " ";
        pageBuf += it.str ?? "";
        if (y != null) lastY = y;
      }
      pages.push(pageBuf);
      try {
        const annots = await page.getAnnotations();
        for (const a of annots as Array<{ url?: string }>) if (a.url) annotUrls.add(a.url);
      } catch { /* noop */ }
      page.cleanup();
    }
    await doc.destroy();
    const tail = annotUrls.size > 0 ? "\n\n" + [...annotUrls].join("\n") : "";
    return pages.join("\n") + tail;
  }

  if (ext === ".docx" || ext === ".doc") {
    try {
      const mammoth = (await import("mammoth")).default;
      const r = await mammoth.extractRawText({ buffer: buf });
      return String(r?.value ?? "");
    } catch {
      return "";
    }
  }

  if (ext === ".txt" || ext === ".md") return buf.toString("utf8");
  // RTF / unknown — ASCII strip is good enough for URL + heading
  // matching. Caller never throws on empty text.
  return buf.toString("utf8").replace(/[^\x20-\x7e\n]+/g, " ");
}

// ── Section-extraction + heading detection ────────────────────────
const SECTION_HEADINGS = [
  "summary","objective","profile","about me",
  "experience","work experience","professional experience","employment",
  "work history","career history","career",
  "education","academic","qualifications","academics",
  "skills","technical skills","core skills","key skills","expertise","key competencies",
  "languages","languages known",
  "projects","personal projects","key projects",
  "certifications","certificates","courses",
  "achievements","awards","accomplishments",
  "hobbies","interests",
  "references","contact","personal details",
  "responsibilities","key responsibilities",
];

function isHeadingLine(line: string): string | null {
  const t = line.trim().replace(/[:•·\-_=*]+$/g, "").trim();
  if (t.length < 3 || t.length > 40) return null;
  const norm = t.toLowerCase().replace(/[^\w\s]/g, "").trim();
  return SECTION_HEADINGS.includes(norm) ? norm : null;
}

function extractSection(text: string, wanted: string[]): string {
  const lines = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const k = isHeadingLine(lines[i]);
    if (k && wanted.includes(k)) { start = i + 1; break; }
  }
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    const k = isHeadingLine(lines[i]);
    if (k && !wanted.includes(k)) { end = i; break; }
  }
  return lines.slice(start, end).join("\n").trim();
}

// ── Fragmentation healing ─────────────────────────────────────────
function healFragmentedText(s: string): string {
  let out = s;
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/\b([A-Z]) ([a-z]{3,})\b/g, "$1$2");
  out = out.replace(/\b(19|20)\s?(\d)\s?(\d)\b/g, "$1$2$3");
  out = out.replace(/\b(1|2)\s+(9|0)\s?(\d)\s?(\d)\b/g, "$1$2$3$4");
  out = out.replace(/(\d)\s+%/g, "$1%");
  return out;
}

// ── URL extraction ────────────────────────────────────────────────
function extractUrls(text: string): { linkedinUrl: string | null; portfolioUrl: string | null } {
  const compact = text.replace(/\s+/g, "").replace(/(https?:\/\/)/gi, " $1");
  const linkedinMatch =
    text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i) ||
    compact.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i);
  const linkedinUrl = linkedinMatch?.[0]
    ? (linkedinMatch[0].startsWith("http") ? linkedinMatch[0] : "https://" + linkedinMatch[0])
    : null;

  const githubMatch =
    text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+\/?/i) ||
    compact.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+\/?/i);
  const githubUrl = githubMatch?.[0]
    ? (githubMatch[0].startsWith("http") ? githubMatch[0] : "https://" + githubMatch[0])
    : null;

  const allUrls = [
    ...(text.match(/https?:\/\/[^\s,;)]+/gi) || []),
    ...(compact.match(/https?:\/\/[^\s,;)]+/gi) || []),
  ];
  const portfolioUrl = githubUrl ?? allUrls
    .filter(u => !/linkedin\.com/i.test(u))
    .filter(u => !u.endsWith(".pdf") && !u.endsWith(".doc") && !u.endsWith(".docx"))[0] ?? null;

  return { linkedinUrl, portfolioUrl };
}

// ── Education ─────────────────────────────────────────────────────
const DEGREE_PATTERNS = [
  /\b(Bach(?:e?l|elo|elor)(?:o?u?r)?s?(?:'s)?(?:\s+of\s+[\w ]+?)?(?:\s+\([A-Z]+\))?)\b/i,
  /\b(Mast(?:e?r|ers?)(?:'s)?(?:\s+of\s+[\w ]+?)?(?:\s+\([A-Z]+\))?)\b/i,
  /\b(MBA|BBA|BCA|MCA|BSc|MSc|B\.?Sc|M\.?Sc|B\.?A|M\.?A|B\.?Com|M\.?Com|B\.?Tech|M\.?Tech|B\.?E|M\.?E|PhD|Doctorate|Diploma|HSC|SSC|XII|X|10\+2|12th|10th|Postgraduate|Undergraduate)\b/i,
];

function parseEducations(section: string): ExtractedEducation[] {
  if (!section.trim()) return [];
  const lines = section
    .split(/\r?\n/)
    .map((l) => healFragmentedText(l.trim()))
    .filter(Boolean);

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

    let startOfCourse = "";
    let endOfCourse   = "";
    const yr = text.match(/(19|20)\d{2}\s*(?:[-–—]|to)\s*(?:(?:19|20)\d{2}|present|current)/i);
    if (yr) {
      const ys = yr[0].match(/(19|20)\d{2}/g) ?? [];
      startOfCourse = ys[0] ?? "";
      endOfCourse   = ys[1] ?? (/present|current/i.test(yr[0]) ? "Present" : "");
    } else {
      const single = text.match(/(19|20)\d{2}/);
      if (single) endOfCourse = single[0];
    }

    let course = "";
    let branch = "";
    const courseMatch = text.match(/(Bach(?:e?l|elo|elor)(?:o?u?r)?s?|Mast(?:e?r|ers?))[A-Za-z'’ ]*?(?:\s+of\s+([A-Za-z& ]{3,80}?))?(?=\s*(?:—|–|-|\||,|CGPA|GPA|Percentage|$))/i);
    if (courseMatch) {
      course = courseMatch[0].trim();
      if (courseMatch[2]) branch = courseMatch[2].trim();
    }
    if (!course) {
      const abbrev = text.match(/\b(MBA|BBA|BCA|MCA|BSc|MSc|B\.?Tech|M\.?Tech|B\.?A|M\.?A|B\.?Com|M\.?Com|PhD|Diploma|XII|X|10\+2|12th|10th)\b/i);
      if (abbrev) course = abbrev[0];
    }

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

    let location = "";
    const locMatch = text.match(/([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?,\s*[A-Z][a-zA-Z]+)\s*$/);
    if (locMatch) location = locMatch[1].trim();

    if (course || university) {
      results.push({ course, branch, startOfCourse, endOfCourse, university, location });
    }
  }
  return results.slice(0, 6);
}

function scanEducationByUniversityYear(text: string): ExtractedEducation[] {
  const lines = text.split(/\n/).map(l => healFragmentedText(l)).filter(l => l.trim());
  const out: ExtractedEducation[] = [];
  for (const line of lines) {
    if (!/\b(University|Institute|College|Polytechnic|Academy)\b/i.test(line)) continue;
    const yr = line.match(/(19|20)\d{2}\s*[-–—]\s*(?:(?:19|20)\d{2}|present|current)/i);
    if (!yr) continue;
    const ys = yr[0].match(/(19|20)\d{2}/g) ?? [];
    const university = line
      .replace(/\(?\s*(19|20)\d{2}\s*[-–—]\s*(?:(19|20)\d{2}|present|current)\s*\)?/i, "")
      .replace(/\s+/g, " ")
      .trim();
    out.push({ course: "", branch: "", startOfCourse: ys[0] ?? "", endOfCourse: ys[1] ?? "", university, location: "" });
  }
  return out.slice(0, 6);
}

// ── Skills ────────────────────────────────────────────────────────
const JOB_TITLE_HINTS = /\b(Manager|Engineer|Officer|Analyst|Specialist|Associate|Consultant|Director|Executive|Lead|Head|Coordinator|Representative|Assistant|Intern)\b/i;

function looksLikeSkill(s: string): boolean {
  if (s.length < 2 || s.length > 40) return false;
  const words = s.split(/\s+/);
  if (words.length > 5) return false;
  if (/@/.test(s))                  return false;
  if (/\d{4,}/.test(s))             return false;
  if (/\+?\d[\d\s-]{6,}/.test(s))   return false;
  if (/[.!?]/.test(s))              return false;
  if (JOB_TITLE_HINTS.test(s))      return false;
  if (/^[a-z]{1,2}$/i.test(s))      return false;
  if (/^(WORK|HISTORY|EXPERIENCE|EDUCATION|PROFILE|CONTACT|PROJECTS|HOBBIES|REFERENCES|TAGS|SUMMARY)$/i.test(s)) return false;
  return true;
}

// Shared tokeniser for both Skills and Languages — a SKILLS-style
// list usually wraps the same way the LANGUAGES list does (bullets,
// commas, line continuation), so the splitting + filter logic is
// identical. The CALLER decides which section to feed and how to
// validate each item.
function tokeniseListSection(sec: string, isValid: (s: string) => boolean, cap: number): string[] {
  if (!sec.trim()) return [];
  const rawLines = sec.split(/\r?\n/);
  // Line-continuation: glue a line ending in "and"/"or"/etc onto
  // the next so wrapped skills ("Relationship building and /
  // management") merge into a single item.
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
    .flatMap(l => l.split(/[•·▪►★]/))
    .map(l => l.replace(/^[\s*\-–—]+/, "").trim())
    .flatMap(l => l.split(/[,|;/]/))
    .map(t => t.trim())
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const cleaned = t.replace(/[:.;]+$/, "").replace(/\s+/g, " ").trim();
    if (!isValid(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out.slice(0, cap);
}

// Skills validation: short labels, no sentences/emails/phones/job
// titles. Plus exclude language names so "Hindi" / "English" don't
// land under SKILLS when the resume sections are adjacent and the
// boundary detection slips.
const KNOWN_LANGUAGE_NAMES = new Set([
  "english","hindi","punjabi","tamil","telugu","kannada","malayalam","marathi","gujarati",
  "bengali","odia","assamese","sanskrit","urdu",
  "spanish","french","german","italian","portuguese","russian","chinese","mandarin","cantonese",
  "japanese","korean","arabic","dutch","swedish","norwegian","danish","polish","turkish",
  "vietnamese","thai","indonesian","malay","hebrew","greek","czech","hungarian","finnish",
]);

function looksLikeSkillNotLanguage(s: string): boolean {
  if (!looksLikeSkill(s)) return false;
  if (KNOWN_LANGUAGE_NAMES.has(s.toLowerCase())) return false;
  return true;
}

function parseSkills(text: string): string[] {
  // SKILLS section only — LANGUAGES is parsed separately so the two
  // categories stay distinct in the candidate drawer.
  const sec = extractSection(text, ["skills","technical skills","core skills","key skills","expertise","key competencies"]);
  return tokeniseListSection(sec, looksLikeSkillNotLanguage, 20);
}

function parseLanguages(text: string): string[] {
  const sec = extractSection(text, ["languages","languages known"]);
  // Validate: short label, plausible language name. Accept either
  // anything in the known-language set OR any short token that
  // passes looksLikeSkill (covers locale variants like "Marathi
  // (Native)" or "English (Fluent)" — strip parens first).
  const cleanForValidation = (s: string) => s.replace(/\s*\(.*?\)\s*/g, "").trim();
  return tokeniseListSection(
    sec,
    (s) => {
      const core = cleanForValidation(s);
      if (KNOWN_LANGUAGE_NAMES.has(core.toLowerCase())) return true;
      // Fall back to skill-shape check for less common languages.
      return core.length >= 2 && core.length <= 25 && /^[A-Za-z][A-Za-z\s'-]+$/.test(core);
    },
    12,
  );
}

// ── Top-level: run all extractors against a resume file ───────────
// When the regular text extraction comes back sparse — typical for
// PDFs that use vector-rendered display fonts (Canva / InDesign
// templates), where letters live as drawing operations rather than
// selectable characters — we fall back to OCR via pdftoppm +
// tesseract. The OCR text is APPENDED to whatever text extraction
// gave us, so we get the best of both: clean URLs / well-spaced text
// from the structured extractor PLUS the bold headings + degree
// names that only show up as pixels.
const TEXT_SPARSE_WORDCOUNT = 80; // empirical: light single-column
                                  // resumes have 150+ words extractable;
                                  // when we see <80 something is off.

export async function extractResumeData(buf: Buffer, fileName: string): Promise<ExtractedResume> {
  let text = await extractText(buf, fileName);
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  // OCR only kicks in for PDFs (the .docx path via mammoth is
  // already comprehensive) and only when the text extractor came
  // back sparse. Soft-fails the whole way down: any error in OCR
  // setup leaves the text-only result intact.
  if (wordCount < TEXT_SPARSE_WORDCOUNT && /\.pdf$/i.test(fileName)) {
    try {
      const { isOcrAvailable, ocrPdf } = await import("./ocr-pdf");
      if (await isOcrAvailable()) {
        const ocrText = await ocrPdf(buf);
        if (ocrText && ocrText.trim().length > 20) {
          // Concatenate. Duplicate phrases between text + OCR are
          // harmless — the downstream parsers de-dupe.
          text = text + "\n\n" + ocrText;
        }
      }
    } catch (e: any) {
      console.error("[resume-auto-extract] OCR fallback failed:", e?.message ?? e);
    }
  }

  if (!text || text.trim().length < 20) {
    return { linkedinUrl: null, portfolioUrl: null, educations: [], skills: [], languages: [] };
  }

  const { linkedinUrl, portfolioUrl } = extractUrls(text);
  let educations = parseEducations(
    extractSection(text, ["education","academic","qualifications","academics"]),
  );
  if (educations.length === 0) educations = scanEducationByUniversityYear(text);
  const skills    = parseSkills(text);
  const languages = parseLanguages(text);
  return { linkedinUrl, portfolioUrl, educations, skills, languages };
}
