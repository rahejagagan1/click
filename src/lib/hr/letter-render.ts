// Server-side renderer for HR letter templates. Takes a template
// bodyHtml + the picked employee + HR's custom inputs, and returns
// the fully-substituted HTML (and, for the PDF flow, a DOCX-styled
// version we hand to docx-to-pdf for letterhead-quality output).
//
// Placeholder grammar: `{{Section.Field}}`. Unknown placeholders
// render as the literal string with a [missing: ...] suffix so HR
// can see what's not resolving instead of getting an empty letter.
//
// Security:
//   • Placeholder values are HTML-escaped before insertion so an
//     employee name containing `<script>…</script>` can't break out
//     of text into markup.
//   • sanitizeLetterHtml() runs the body through `sanitize-html`
//     (a parser-based sanitiser) with an explicit allowlist before
//     we persist or render — replaces the earlier regex approach
//     which had known bypass classes.

import prisma from "@/lib/prisma";
import sanitizeHtml from "sanitize-html";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Lazy-cache logos as base64 data URLs so the preview iframe
// (sandboxed with default-src 'none' + img-src data:) can render
// them without any network. One-time read per server lifetime.
const logoCache: Record<string, string> = {};
async function getLogoDataUrl(filename: string): Promise<string> {
  if (logoCache[filename] !== undefined) return logoCache[filename];
  try {
    const path = resolve(process.cwd(), "public", filename);
    const bytes = await readFile(path);
    logoCache[filename] = `data:image/png;base64,${bytes.toString("base64")}`;
    return logoCache[filename];
  } catch {
    logoCache[filename] = "";
    return "";
  }
}
/** Resolve the right logo + letterhead data per business unit.
 *  YT Labs uses public/logo-ytlabs.png + the BILLION FILMS letterhead.
 *  NB Media uses public/logo.png + the YT Money Productions letterhead.
 *  Falls back to NB Media chrome when an unknown brand is passed. */
async function getBrandChrome(businessUnit: string | null | undefined): Promise<{
  logoDataUrl: string;
  company: string;
  addressHtml: string;
  altText: string;
}> {
  if (businessUnit === "YT Labs") {
    // YT Labs uses its own hash icon — DO NOT fall back to the
    // NB Media logo when public/logo-ytlabs.png is missing. A
    // letter going to a YT Labs employee with the NB Media logo
    // is worse than a letter with no logo at all. The header
    // layout still renders correctly; HR just sees an empty slot
    // top-right until the asset is dropped in.
    const logo = await getLogoDataUrl("logo-ytlabs.png");
    return {
      logoDataUrl: logo,
      altText: "YT Labs",
      company: "BILLION FILMS PRIVATE LIMITED",
      addressHtml: `
        <strong>Registered Office:</strong> 2nd Floor, NAAR Tower,<br/>
        Sector 74 A, Industrial Area, Sector 74,<br/>
        Sahibzada Ajit Singh Nagar,<br/>
        Punjab 140307<br/>
        <strong>Phone:</strong> 8146891380<br/>
        <strong>CIN :</strong> U18200PB2024PTC061355`,
    };
  }
  // NB Media (default)
  return {
    logoDataUrl: await getLogoDataUrl("logo.png"),
    altText: "NB Media",
    company: "YT Money Productions Pvt. Ltd.",
    addressHtml: `
      <strong>Registered Office:</strong> 1st Floor, 209, NB Media,<br/>
      Model Town, Main Road, Phase 2,<br/>
      Bathinda, Punjab, 151001<br/>
      <strong>Phone:</strong> 8146891380<br/>
      <strong>Email:</strong> HRD@nbmediaproductions.com<br/>
      <strong>CIN :</strong> U92113PB2022PTC055026`,
  };
}

// Founder signature images, cached per-brand on first read so the
// preview iframe (sandboxed with img-src data:) can embed without
// any network access. NB Media letters use Nikit Bassi's
// signature; YT Labs letters use Kunal Lall's. Returns "" when the
// file isn't present, so the wrapper silently skips rendering the
// signature image and HR can drop the asset in later.
const signatureCache: Record<string, { loaded: boolean; dataUrl: string }> = {};
async function getSignatureDataUrl(businessUnit?: string | null): Promise<string> {
  const slug = businessUnit === "YT Labs" ? "kunal-lall" : "nikit-bassi";
  if (signatureCache[slug]?.loaded) return signatureCache[slug].dataUrl;
  const candidates: Array<{ path: string; mime: string }> = [
    { path: resolve(process.cwd(), "public", "signatures", `${slug}.png`), mime: "image/png" },
    { path: resolve(process.cwd(), "public", "signatures", `${slug}.jpg`), mime: "image/jpeg" },
    { path: resolve(process.cwd(), "public", "signatures", `${slug}.jpeg`), mime: "image/jpeg" },
  ];
  for (const c of candidates) {
    try {
      const bytes = await readFile(c.path);
      const dataUrl = `data:${c.mime};base64,${bytes.toString("base64")}`;
      signatureCache[slug] = { loaded: true, dataUrl };
      return dataUrl;
    } catch { /* try next */ }
  }
  signatureCache[slug] = { loaded: true, dataUrl: "" };
  return "";
}

/** Inject the founder's signature image into the body HTML right
 *  before the first occurrence of "Regards,". Returns body
 *  unchanged when no signature file exists at
 *  public/signatures/nikit-bassi.{png|jpg|jpeg} — no synthetic
 *  fallback (a stand-in cursive font never matches the real
 *  hand-signature and looks worse than a blank gap). */
async function injectSignatureBeforeRegards(bodyHtml: string, businessUnit?: string | null): Promise<string> {
  const sig = await getSignatureDataUrl(businessUnit);
  if (!sig) return bodyHtml;
  // Signature sits ABOVE the "Regards," line — same placement HR's
  // source PDFs use (cursive flourish between the body and the
  // typed signoff block). Kunal's signature is rendered larger
  // than Nikit's because his source strokes are thinner.
  const altText  = businessUnit === "YT Labs" ? "Kunal Lall" : "Nikit Bassi";
  // Pixel dimensions hard-coded from the source PNGs:
  //   Nikit Bassi : 260×48  → aspect 5.42:1 → render 130×24px (~18pt)
  //   Kunal Lall  : 252×105 → aspect 2.40:1 →  render  90×37px (~28pt)
  // We use HTML width/height ATTRIBUTES (not CSS) because
  // LibreOffice's HTML→PDF importer ignores `style="height:18pt"`
  // on inline images and falls back to the image's native pixel
  // size (so the cursive ballooned to ~260px wide in the PDF
  // while the browser preview rendered at 18pt). HTML4 width/height
  // attributes are honoured by both renderers.
  const sigW = businessUnit === "YT Labs" ? 90 : 130;
  const sigH = businessUnit === "YT Labs" ? 37 : 24;
  // <br/> after the img forces "Regards," onto the next line. We
  // can't rely on display:block because LibreOffice ignores it on
  // inline elements like <img>.
  const sigImg = `<img src="${sig}" alt="${altText}" width="${sigW}" height="${sigH}" style="vertical-align:bottom"/><br/>`;
  const re = /(<(?:p|div|h[1-6])[^>]*>)(\s*Regards\s*,)/i;
  if (re.test(bodyHtml)) return bodyHtml.replace(re, `$1${sigImg}$2`);
  // Fallback when no "Regards," anchor exists — append at the
  // end so HR can still spot the signature.
  return bodyHtml + `<p style="margin:8pt 0 0 0">${sigImg}</p>`;
}

export type RenderContext = {
  employeeId: number;
  customFields: Record<string, string>;
};

/** Build a placeholder resolver bound to one employee + custom
 *  inputs. Shared by both the HTML preview path and the DOCX
 *  substitution path (letter-docx-render.ts) so the two can never
 *  disagree on what `{{Section.Field}}` means. */
export async function buildPlaceholderResolver(ctx: RenderContext): Promise<{
  resolve: (key: string) => string | null;
  user: any;
  profile: any;
  exit: any;
}> {
  const user = await prisma.user.findUnique({
    where: { id: ctx.employeeId },
    include: { employeeProfile: true },
  });
  if (!user) throw new Error(`Employee #${ctx.employeeId} not found.`);

  let exit: any = null;
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "resignationDate", "lastWorkingDay", "noticePeriodDays", "exitType", status
         FROM "EmployeeExit" WHERE "userId" = $1 LIMIT 1`,
      ctx.employeeId,
    );
    exit = rows[0] ?? null;
  } catch { /* employee may not have an exit row */ }

  let extended: any = {};
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "probationEndDate", "internshipEndDate"
         FROM "EmployeeProfile" WHERE "userId" = $1`,
      ctx.employeeId,
    );
    extended = rows[0] ?? {};
  } catch { /* columns may be missing on older deploys */ }

  const profile = { ...(user.employeeProfile ?? {}), ...extended };
  const renderCtx = { user, profile, exit, customFields: ctx.customFields ?? {} };
  return {
    resolve: (key: string) => resolvePlaceholder(key, renderCtx),
    user, profile, exit,
  };
}

const fmtDate = (d: Date | null | undefined): string => {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d as any);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
};
const fmtShortDate = (d: Date | null | undefined): string => {
  if (!d) return new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const date = d instanceof Date ? d : new Date(d as any);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

// Resolves a placeholder against the employee row + custom inputs.
// Returns the substituted string or null if the placeholder isn't
// known.
function resolvePlaceholder(
  fullKey: string,
  ctx: {
    user: any;
    profile: any;
    exit: any | null;
    customFields: Record<string, string>;
  },
): string | null {
  const [section, field] = fullKey.split(".");
  if (!section || !field) return null;
  const u = ctx.user;
  const p = ctx.profile;
  const ex = ctx.exit;

  switch (section) {
    case "EmployeeBasicInfo":
      if (field === "DisplayName")    return u?.name || "";
      if (field === "Email")          return u?.email || "";
      break;
    case "EmployeeBasicHeaderInfo":
      if (field === "EmployeeNumber") return p?.employeeId || "";
      if (field === "ShortDate")      return fmtShortDate(new Date());
      break;
    case "EmployeeJobInfo":
      if (field === "JobTitle")        return p?.designation || u?.role || "";
      if (field === "Department")      return p?.department || "";
      if (field === "DateJoined")      return fmtDate(p?.joiningDate);
      if (field === "ResignationDate") return fmtDate(ex?.resignationDate);
      if (field === "LastWorkingDay")  return fmtDate(ex?.lastWorkingDay);
      if (field === "ProbationEndDate")return fmtDate(p?.probationEndDate);
      break;
    case "EmployeeCustomFields":
      if (field === "InternshipEndDate") return fmtDate(p?.internshipEndDate);
      break;
    case "DocumentFilterInfo":
      if (field === "ShortDate") return fmtShortDate(new Date());
      if (field === "HeShe") {
        const g = (p?.gender || "").toLowerCase();
        if (g === "male")   return "He";
        if (g === "female") return "She";
        return "They";
      }
      if (field === "HisHer") {
        const g = (p?.gender || "").toLowerCase();
        if (g === "male")   return "His";
        if (g === "female") return "Her";
        return "Their";
      }
      // Object pronoun — used after verbs ("we wish him/her good
      // luck"). Falls back to "them" for non-binary / unknown.
      if (field === "HimHer") {
        const g = (p?.gender || "").toLowerCase();
        if (g === "male")   return "him";
        if (g === "female") return "her";
        return "them";
      }
      break;
    case "CustomAttributes":
      // HR-supplied per-render values (FnFAmount, ReferenceNo, …)
      return ctx.customFields?.[field] ?? "";
  }
  return null;
}

export type RenderResult = {
  html: string;
  /** Unresolved placeholders, surfaced so the editor can flag them. */
  missing: string[];
};

export async function renderLetterHtml(
  bodyHtml: string,
  ctx: RenderContext,
): Promise<RenderResult> {
  // Pull employee + profile + exit in one query so the renderer is
  // O(1) DB hits regardless of how many placeholders are used.
  const user = await prisma.user.findUnique({
    where: { id: ctx.employeeId },
    include: {
      employeeProfile: true,
    },
  });
  if (!user) throw new Error(`Employee #${ctx.employeeId} not found.`);

  // Exit row (if present) drives the FnF / relieving placeholders.
  let exit: any = null;
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "resignationDate", "lastWorkingDay", "noticePeriodDays", "exitType", status
         FROM "EmployeeExit" WHERE "userId" = $1 LIMIT 1`,
      ctx.employeeId,
    );
    exit = rows[0] ?? null;
  } catch { /* exit may not exist for non-leavers */ }

  // Extended profile fields (probationEndDate, internshipEndDate)
  // via raw SQL — same pattern used in /api/hr/people/[id] to dodge
  // stale Prisma client deployments.
  let extended: any = {};
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "probationEndDate", "internshipEndDate"
         FROM "EmployeeProfile" WHERE "userId" = $1`,
      ctx.employeeId,
    );
    extended = rows[0] ?? {};
  } catch { /* columns may be missing on older deploys */ }

  const profile = { ...(user.employeeProfile ?? {}), ...extended };
  const renderCtx = {
    user,
    profile,
    exit,
    customFields: ctx.customFields ?? {},
  };

  const missing: string[] = [];
  // Placeholder values are PLAIN TEXT — escape them before
  // inserting into HTML so an employee name like
  // `Manpreet <script>alert(1)</script>` can't break out of text.
  // The body itself is HTML (sanitised separately) so we don't
  // escape it again here.
  const html = bodyHtml.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_.]*)\s*\}\}/g, (_match, key: string) => {
    const v = resolvePlaceholder(key, renderCtx);
    if (v == null) {
      if (!missing.includes(key)) missing.push(key);
      return `[missing: ${escapeHtml(key)}]`;
    }
    return escapeHtml(v);
  });
  return { html, missing };
}

/**
 * Wrap a substituted body in a complete A4-sized preview HTML
 * document — letterhead, embedded logo, faint background watermark,
 * Times New Roman body. The PDF pipeline doesn't use this (the
 * DOCX template already supplies the same chrome) but the live
 * editor preview pane does, so HR sees the final layout before
 * generating.
 *
 * The logo is base64-embedded so the sandboxed iframe doesn't need
 * any network access — its CSP can stay at `default-src 'none'`
 * with just `img-src data:` and `style-src 'unsafe-inline'`.
 */
export async function wrapLetterPreviewHtml(
  bodyHtml: string,
  title: string,
  businessUnit: string | null = "NB Media",
): Promise<string> {
  // Brand-aware chrome — letterhead text, logo image, watermark are
  // all picked from getBrandChrome(). YT Labs renders the BILLION
  // FILMS letterhead with the YT Labs hash icon; NB Media renders
  // the YT Money Productions letterhead with the nb-media logo.
  const chrome = await getBrandChrome(businessUnit);
  const logoImg = chrome.logoDataUrl
    ? `<img class="lh-logo" src="${chrome.logoDataUrl}" alt="${escapeHtml(chrome.altText)}" />`
    : "";
  // Auto-inject the founder signature image (Nikit for NB Media,
  // Kunal for YT Labs) below the body's "Founder & CEO" line if
  // the PNG is on disk. No-op otherwise.
  bodyHtml = await injectSignatureBeforeRegards(bodyHtml, businessUnit);
  const watermarkImg = chrome.logoDataUrl
    ? `<img class="lh-watermark" src="${chrome.logoDataUrl}" alt="" aria-hidden="true" />`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
  <title>${escapeHtml(title)}</title>
  <style>
    /* Page size for print/PDF generation. Margin is 0 because the
       inner .page div has its own 22mm × 18mm padding — without
       this they'd stack and the body content area would be half
       the page. */
    @page { size: A4; margin: 0; }
    html, body { margin: 0; padding: 0; background: #f8fafc; font-family: "Times New Roman", Times, serif; color: #1f2937; }
    .page {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: 22mm 18mm;
      background: white;
      box-shadow: 0 0 0 1px rgba(15,23,42,0.06), 0 2px 16px rgba(15,23,42,0.06);
      box-sizing: border-box;
      position: relative;
      overflow: hidden;
    }
    /* Faded NB Media watermark — sits behind everything via z-index. */
    .lh-watermark {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 60%;
      max-width: 360pt;
      opacity: 0.06;
      pointer-events: none;
      z-index: 0;
      user-select: none;
    }
    /* Body content sits on its own stacking context above the watermark. */
    .page > :not(.lh-watermark) {
      position: relative;
      z-index: 1;
    }
    /* Letterhead: no underline rule — gives a cleaner, more
       professional look. The visual break between the chrome and
       the body title is created by the title margin + 22pt gap
       below the letterhead instead. */
    .letterhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 24pt; margin-bottom: 22pt; padding-bottom: 0; }
    .letterhead .lh-text { font-size: 10.5pt; line-height: 1.45; letter-spacing: 0.3px; }
    .letterhead .lh-text .company { font-size: 12pt; font-weight: bold; margin-bottom: 4pt; letter-spacing: 0.5px; }
    .letterhead .lh-logo { width: 86pt; height: auto; }
    h1.letter-title { font-size: 16pt; font-weight: bold; text-align: center; margin: 14pt 0 16pt; letter-spacing: 0.5px; }
    /* Body paragraphs — 1.5 line height + 0.5px letter-spacing
       gives the text the airy, formal feel of a printed HR letter.
       Margins tightened to 4pt so the 1.5 line-height doesn't
       double-space consecutive paragraphs. */
    p { font-size: 12pt; line-height: 1.5; margin: 4pt 0; text-align: justify; letter-spacing: 0.5px; }
    p.signoff, p[data-role="signoff"] { text-align: left; margin: 2pt 0; letter-spacing: 0.5px; }
    p.note { text-align: center; font-style: italic; font-weight: bold; font-size: 11pt; margin: 4pt 0 12pt; letter-spacing: 0.5px; }
    h2 { font-size: 14pt; margin: 16pt 0 8pt; letter-spacing: 0.5px; }
    h3 { font-size: 13pt; margin: 14pt 0 8pt; letter-spacing: 0.5px; }
    ol, ul { padding-left: 22pt; margin: 8pt 0; }
    ol li, ul li { margin-bottom: 4pt; font-size: 12pt; line-height: 1.5; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; margin: 10pt 0 14pt; }
    table th, table td { border: 1pt solid #1f2937; padding: 6pt 9pt; font-size: 11pt; text-align: left; }
    table th { background: #f3f4f6; }
    .page-break { display: block; height: 22pt; border-top: 1pt dashed #cbd5e1; margin: 18pt 0; padding-top: 8pt; }
  </style>
</head>
<body>
  <div class="page">
    ${watermarkImg}
    <div class="letterhead">
      <div class="lh-text">
        <div class="company">${escapeHtml(chrome.company)}</div>
        ${chrome.addressHtml}
      </div>
      ${logoImg}
    </div>
    <h1 class="letter-title">${escapeHtml(title)}</h1>
    ${bodyHtml}
  </div>
</body>
</html>`;
}

/**
 * Stripped-down HTML wrapper specifically for LibreOffice HTML→PDF.
 *
 * LibreOffice's HTML importer struggles with modern CSS — `position:
 * absolute`, flexbox, mm-based widths, background-image positioning,
 * and `@page` rules all render unpredictably (we saw a 3-page blow-out
 * where the watermark + logo each took a full page because LibreOffice
 * read absolute-positioned images as block content). This wrapper
 * sticks to what LibreOffice does render reliably:
 *
 *   • A 2-col `<table>` for the letterhead (text left, logo right),
 *     with the logo's width set via the `width` attribute (not CSS).
 *   • Sequential block-level content for body / signature / signoff.
 *   • No watermark — LibreOffice can't anchor a backdrop image
 *     without scaling it to the page. The preview pane still shows
 *     the watermark via the rich wrapLetterPreviewHtml.
 *   • Inline `style="font-size:..."` instead of class-based rules
 *     so the importer doesn't drop styling.
 */
export async function wrapLetterForPdf(
  bodyHtml: string,
  title: string,
  businessUnit: string | null = "NB Media",
): Promise<string> {
  const chrome = await getBrandChrome(businessUnit);
  bodyHtml = await injectSignatureBeforeRegards(bodyHtml, businessUnit);
  const logoCell = chrome.logoDataUrl
    ? `<td style="vertical-align:top; text-align:right; padding:0;"><img src="${chrome.logoDataUrl}" alt="${escapeHtml(chrome.altText)}" width="86" /></td>`
    : `<td></td>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="font-family: 'Times New Roman', Times, serif; color: #1f2937; font-size: 12pt; line-height: 1.5; margin: 0;">
  <table style="width:100%; border-collapse:collapse; margin-bottom:18px;">
    <tr>
      <td style="vertical-align:top; padding:0; font-size:10.5pt; line-height:1.45;">
        <div style="font-size:12pt; font-weight:bold; margin-bottom:4pt;">${escapeHtml(chrome.company)}</div>
        ${chrome.addressHtml}
      </td>
      ${logoCell}
    </tr>
  </table>
  <h1 style="font-size:16pt; font-weight:bold; text-align:center; margin:14pt 0 16pt 0;">${escapeHtml(title)}</h1>
  ${bodyHtml}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[m] as string));
}

/**
 * Parser-based HTML sanitiser for letter-template bodies. Uses
 * `sanitize-html` with an explicit allowlist of tags/attributes —
 * unknown elements are stripped, attribute URLs are restricted to
 * safe schemes, and the parser handles every bypass class that a
 * regex would miss (malformed/nested tags, CDATA tricks, namespaced
 * elements, mixed-case `<sCrIpT>`, etc.).
 *
 * Allowed surface is intentionally tight — covers the letter
 * templates HR uses today (text blocks, lists, tables, formatting).
 * If HR ever needs an extra element (e.g. images), add it here.
 */
export function sanitizeLetterHtml(input: string): string {
  if (typeof input !== "string") return "";
  return sanitizeHtml(input, {
    // Allowed elements — letter content shape only. Anything outside
    // this list (script / iframe / object / embed / svg / form /
    // input / etc.) is dropped wholesale by the parser.
    allowedTags: [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "div", "span", "br", "hr",
      "strong", "em", "b", "i", "u", "s", "del", "sub", "sup",
      "ul", "ol", "li",
      "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    ],
    allowedAttributes: {
      "*":     ["class", "style"],
      "td":    ["class", "style", "colspan", "rowspan", "align"],
      "th":    ["class", "style", "colspan", "rowspan", "align"],
      "ol":    ["class", "type", "start"],
      "table": ["class", "style", "border", "cellpadding", "cellspacing"],
    },
    // Restrict inline styles to layout properties. Drops anything
    // that could be used for exfiltration via `background:url(...)`
    // or scripty `behavior:` properties — only the literal subset
    // below is allowed and the value must match the regex.
    allowedStyles: {
      "*": {
        "color":           [/^[#\w\(\),\s.%-]+$/],
        "background":      [/^[#\w\(\),\s.%-]+$/],
        "background-color":[/^[#\w\(\),\s.%-]+$/],
        "font-family":     [/^[\w\s,"'-]+$/],
        "font-size":       [/^[\d.]+(px|pt|em|rem|%)$/],
        "font-weight":     [/^(bold|normal|\d+)$/],
        "font-style":      [/^(italic|normal)$/],
        "text-align":      [/^(left|right|center|justify)$/],
        "text-decoration": [/^(underline|line-through|none)$/],
        "margin":          [/^[\d.\s\-pxptemrm%]+$/],
        "margin-top":      [/^[\d.\-pxptemrm%]+$/],
        "margin-bottom":   [/^[\d.\-pxptemrm%]+$/],
        "padding":         [/^[\d.\s\-pxptemrm%]+$/],
        "line-height":     [/^[\d.]+(px|pt|em|rem|%)?$/],
        "width":           [/^[\d.]+(px|pt|em|rem|%)$/],
        "border":          [/^[\d.]+(px|pt) (solid|dashed|dotted) [#\w]+$/],
      },
    },
    // Restrict href/src URL schemes. The default block list already
    // covers javascript: / data: / vbscript: but we're explicit
    // about what's allowed for clarity. No external resources are
    // expected in letter templates anyway.
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesAppliedToAttributes: ["href", "src", "cite"],
    // CSS class names are arbitrary strings; sanitize-html keeps
    // them when allowed in allowedAttributes above. Comments are
    // stripped by default.
    selfClosing: ["br", "hr"],
  });
}
