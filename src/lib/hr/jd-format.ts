// Shared JD text helpers. Kept in its own module (pure string logic, no
// server deps) so both the Create-Job wizard and the Replace-JD modal
// import ONE copy — the copy-paste of plainTextToQuillHtml is exactly how
// a title-duplication bug spread to both, so new shared logic lives here.

// A line that looks like a pasted company LETTERHEAD. Used to drop the
// leading letterhead block from a JD body before it is laid over the
// .docx template's OWN letterhead (which is the single source of truth).
// Without this, HR pasting a letterhead into the editor double-renders it
// AND drags along typos like "HRD@bmediaproductions.com" (missing 'n').
const LETTERHEAD_RE =
  /(?:YT\s*Money\s*Productions|Billion\s*Films|Registered\s*Office|Model\s*Town|Main\s*Road,?\s*Phase|Bathinda|Sahibzada\s*Ajit\s*Singh\s*Nagar|Punjab\s*,?\s*\d{4,6}|Phone\s*[:：]|Email\s*[:：]|CIN\s*[:：]|U\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}|@\w*mediaproductions\.com|@ytlpro\.com|This\s+is\s+a\s+temporary)/i;

/**
 * Strip a LEADING run of company-letterhead lines from a pasted/extracted
 * JD body. Stops at the first line that isn't letterhead-ish (e.g. the
 * "Job Description - …" title or the first real body line), so it never
 * eats actual JD content. Returns the text unchanged if no leading
 * letterhead was found.
 */
export function stripLeadingCompanyContent(text: string): string {
  if (!text) return text;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let removed = false;
  while (i < lines.length) {
    const l = lines[i].trim();
    if (l === "") { i++; continue; }            // skip blanks inside the leading run
    if (LETTERHEAD_RE.test(l)) { removed = true; i++; continue; }
    break;                                       // first real (non-letterhead) line — stop
  }
  return removed ? lines.slice(i).join("\n").replace(/^\n+/, "") : text;
}
