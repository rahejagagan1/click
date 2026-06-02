// Render an edited JD as a branded NB Media PDF.
//
// Uses public/templates/jd-template.docx as the canvas — a derivative
// of the offer-letter template that already contains the NB Media
// letterhead, embedded logo image, and the page-header watermark.
// We do NOT build the DOCX from scratch in code; that would lose the
// binary image assets. Instead, we open the template, find/replace
// the {{JobTitle}} and {{Body}} placeholders, and convert to PDF.
//
// Pipeline:
//   1. Open public/templates/jd-template.docx via pizzip.
//   2. Replace {{JobTitle}} in the centered title.
//   3. Replace the single {{Body}} placeholder paragraph with a run
//      of paragraphs derived from HR's edited text — auto-formatted:
//      headings (lines ending with ":") become bold, lines starting
//      with "- " become bullets, "1." becomes numbered, etc.
//   4. Convert the resulting DOCX to PDF (Word COM on Windows dev /
//      LibreOffice on the VPS).

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import PizZip from "pizzip";
import { docxToPdf } from "./docx-to-pdf";

const TEMPLATE_PATH = resolve(process.cwd(), "public", "templates", "jd-template.docx");

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Paragraph-level XML builders (Times New Roman, 11pt) ──────────
const FONT = `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>`;

function paraPlain(text: string): string {
  return (
    `<w:p>` +
      `<w:pPr><w:spacing w:after="120"/></w:pPr>` +
      `<w:r>` +
        `<w:rPr>${FONT}<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>` +
        `<w:t xml:space="preserve">${xmlEscape(text)}</w:t>` +
      `</w:r>` +
    `</w:p>`
  );
}

function paraHeading(text: string): string {
  return (
    `<w:p>` +
      `<w:pPr><w:spacing w:before="160" w:after="80"/></w:pPr>` +
      `<w:r>` +
        `<w:rPr>${FONT}<w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>` +
        `<w:t xml:space="preserve">${xmlEscape(text)}</w:t>` +
      `</w:r>` +
    `</w:p>`
  );
}

function paraBullet(text: string): string {
  return (
    `<w:p>` +
      `<w:pPr>` +
        `<w:spacing w:after="60"/>` +
        `<w:ind w:left="720" w:hanging="360"/>` +
      `</w:pPr>` +
      `<w:r>` +
        `<w:rPr>${FONT}<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>` +
        `<w:t xml:space="preserve">• ${xmlEscape(text)}</w:t>` +
      `</w:r>` +
    `</w:p>`
  );
}

function paraNumbered(n: number, text: string): string {
  return (
    `<w:p>` +
      `<w:pPr>` +
        `<w:spacing w:after="60"/>` +
        `<w:ind w:left="720" w:hanging="360"/>` +
      `</w:pPr>` +
      `<w:r>` +
        `<w:rPr>${FONT}<w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>` +
        `<w:t xml:space="preserve">${n}. </w:t>` +
      `</w:r>` +
      `<w:r>` +
        `<w:rPr>${FONT}<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>` +
        `<w:t xml:space="preserve">${xmlEscape(text)}</w:t>` +
      `</w:r>` +
    `</w:p>`
  );
}

function paraBlank(): string {
  return `<w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>`;
}

// Classify each line of HR's edited text so we can apply the right
// paragraph style. Order matters — bullets before colon-heading
// (so "- Domain:" is a bullet, not a heading).
// Page-marker artefacts left over from PDF-to-text conversion:
//   "-- 1 of 2 --", "Page 1 of 2", "1 of 2", "Page 1"
// Skip them so the generated PDF doesn't reproduce them.
const PAGE_MARKER_RE = /^[\s\-–—]*(?:page\s+)?\d+(?:\s*(?:of|\/)\s*\d+)?[\s\-–—]*$/i;

function buildBodyXml(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((raw) => {
      const line = raw.trimEnd();
      if (!line.trim()) return paraBlank();
      if (PAGE_MARKER_RE.test(line.trim())) return "";
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
      if (bullet) return paraBullet(bullet[1]);
      const num = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
      if (num) return paraNumbered(parseInt(num[1], 10), num[2]);
      if (/:\s*$/.test(line) && line.length <= 60) {
        return paraHeading(line.replace(/:\s*$/, "") + ":");
      }
      return paraPlain(line);
    })
    .join("");
}

// Replace the entire {{Body}} placeholder PARAGRAPH (not just the
// text) with the generated multi-paragraph body XML. The placeholder
// in the template lives inside one <w:p>...</w:p> wrapper; we need
// to replace from the opening <w:p> through the closing </w:p>.
function replaceBodyParagraph(xml: string, bodyXml: string): string {
  const needle = "{{Body}}";
  const idx = xml.indexOf(needle);
  if (idx === -1) return xml;
  const pStart = xml.lastIndexOf("<w:p>", idx);
  const pStartAlt = xml.lastIndexOf("<w:p ", idx);
  const start = Math.max(pStart, pStartAlt);
  if (start === -1) return xml;
  const end = xml.indexOf("</w:p>", idx);
  if (end === -1) return xml;
  return xml.slice(0, start) + bodyXml + xml.slice(end + "</w:p>".length);
}

/** Render the edited JD text → branded NB Media PDF using the
 *  jd-template.docx as the canvas (letterhead + logo + watermark). */
export async function renderJdPdfFromText(args: {
  title: string;
  text: string;
}): Promise<Buffer> {
  const templateBytes = await readFile(TEMPLATE_PATH);
  const zip = new PizZip(templateBytes);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("word/document.xml missing in jd-template");
  let xml = docFile.asText();

  // ── 1. Replace the title placeholder (string-level) ─────────
  xml = xml.replace(/\{\{JobTitle\}\}/g, xmlEscape(args.title || "Role"));

  // ── 2. Swap the {{Body}} placeholder paragraph with auto-
  //       formatted paragraphs from HR's text. ──────────────────
  const bodyXml = buildBodyXml(args.text || "");
  xml = replaceBodyParagraph(xml, bodyXml);

  zip.file("word/document.xml", xml);
  const docxBytes = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
  return docxToPdf(docxBytes);
}
