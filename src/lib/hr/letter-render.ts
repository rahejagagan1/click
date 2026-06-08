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
  // No "Regards," anchor in the body — this template doesn't
  // want a signature (e.g. the Exit Statement payslip-style
  // document, which is just a tabular pay statement and signing
  // it off as a "letter" makes no sense). Return the body
  // unmodified instead of appending a stray signature at the end.
  return bodyHtml;
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
// Despite the legacy name, fmtShortDate uses the FULL month name
// ("06 June 2026") to match HR's preferred letter-style format.
// Was 3-letter month previously ("06 Jun 2026"); flipped to long
// after HR feedback on the Revised Offer Letter preview.
const fmtShortDate = (d: Date | null | undefined): string => {
  if (!d) return new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
  const date = d instanceof Date ? d : new Date(d as any);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
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
      // Pronouns return lowercase by default because every existing
      // template uses them MID-SENTENCE ("Arpit fulfilled his roles",
      // "we wish him good luck") — capitalized would read as a
      // typo. Templates that need the capitalized form (first word
      // of a sentence) should use {{…HeSheCap}} / {{…HisHerCap}}.
      if (field === "HeShe") {
        const g = (p?.gender || "").toLowerCase();
        if (g === "male")   return "he";
        if (g === "female") return "she";
        return "they";
      }
      if (field === "HeSheCap") {
        const g = (p?.gender || "").toLowerCase();
        if (g === "male")   return "He";
        if (g === "female") return "She";
        return "They";
      }
      if (field === "HisHer") {
        const g = (p?.gender || "").toLowerCase();
        if (g === "male")   return "his";
        if (g === "female") return "her";
        return "their";
      }
      if (field === "HisHerCap") {
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
    case "ExitSettlement":
      // Provisional Full & Final Settlement statement — auto
      // computes the earnings total, deductions total, net
      // payable, and the English-words representation from the
      // line items HR enters as custom fields.
      return resolveExitSettlement(field, ctx.customFields);
    case "Salary":
      // Auto-derived salary breakup. HR types the annual package
      // (e.g. 600000) and ticks the EnablePf checkbox; this section
      // expands {{Salary.Basic}}, {{Salary.HRA}}, … into the
      // computed rupees per the NB Media / YT Labs standard:
      //   Monthly CTC = Annual / 12
      //   Basic       = 50% × monthly
      //   HRA         = 20% × monthly
      //   PF          = 1800 (fixed, only when EnablePf=true)
      //   DA          = 10% × monthly
      //   Conveyance  = 7.5% × monthly
      //   Medical     = 1250 (15K / year)
      //   Special     = remaining (so the column sums to monthly CTC)
      return resolveSalary(field, ctx.customFields);
  }
  return null;
}

/** Compute the standard salary breakup placeholders.
 *  Reads `AnnualPackage` + `EnablePf` from the HR-entered custom
 *  fields. Returns "" for unknown fields so renderLetterHtml's
 *  "missing" list still catches typos. */
/** Convert a positive integer rupee amount to Indian English
 *  words ("14217 → Fourteen Thousand Two Hundred Seventeen
 *  Rupees only"). Handles the Indian numbering system (lakh,
 *  crore) since the existing payroll system uses it. Returns
 *  "Zero Rupees only" for 0, "—" for non-numbers. */
function rupeesInWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return "—";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const twoDigit = (n: number): string => {
    if (n < 20) return ones[n];
    const t = Math.floor(n / 10), o = n % 10;
    return o === 0 ? tens[t] : `${tens[t]} ${ones[o]}`;
  };
  const threeDigit = (n: number): string => {
    const h = Math.floor(n / 100), r = n % 100;
    if (h === 0) return twoDigit(r);
    if (r === 0) return `${ones[h]} Hundred`;
    return `${ones[h]} Hundred ${twoDigit(r)}`;
  };
  let n = Math.floor(amount);
  if (n === 0) return "Zero Rupees only";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000); n = n % 10_000_000;
  const lakh  = Math.floor(n / 100_000);    n = n % 100_000;
  const thousand = Math.floor(n / 1000);    n = n % 1000;
  const hundredRem = n;
  if (crore    > 0) parts.push(`${twoDigit(crore)} Crore`);
  if (lakh     > 0) parts.push(`${twoDigit(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${twoDigit(thousand)} Thousand`);
  if (hundredRem > 0) parts.push(threeDigit(hundredRem));
  return `${parts.join(" ")} Rupees only`;
}

/** Compute earnings + deductions for the Exit Statement.
 *
 *  HR types ONE input: AnnualPackage (₹) — and optionally toggles
 *  EnablePf (checkbox). Everything else is derived using the same
 *  formula as the Revised Offer Letter, pro-rated by Working Days
 *  (with a 30-day month denominator, standard payroll convention):
 *
 *    Monthly CTC      = annual / 12
 *    Basic            = 50%  × monthly
 *    HRA              = 20%  × monthly
 *    DA               = 10%  × monthly
 *    Conveyance       = 7.5% × monthly
 *    Medical          = 1,250  (fixed)
 *    PF               = 1,800  (fixed, only when EnablePf=true)
 *    Special          = remaining (so monthly columns tie to CTC)
 *    Then each ×= (WorkingDays / 30)  →  pro-rated for the partial
 *                                        last month.
 *    LeaveEncashment  = (Basic_pro + DA_pro) / WorkingDays × LeaveEncashmentDays
 *                       — standard formula based on per-day basic+DA
 *                       rate × encashment days. Falls back to 0 if
 *                       no LE days entered.
 *
 *  HR can also enter any individual amount manually as a custom
 *  field — manual values override the computed defaults. That's
 *  the escape hatch for the rare cases where payroll diverges
 *  from the formula. */
function resolveExitSettlement(field: string, customFields: Record<string, string>): string {
  const num = (key: string): number => {
    const raw = String(customFields?.[key] ?? "").replace(/[^\d.\-]/g, "");
    const v = Number(raw);
    return Number.isFinite(v) ? v : 0;
  };
  const numOrUndef = (key: string): number | undefined => {
    const raw = String(customFields?.[key] ?? "").trim();
    if (!raw) return undefined;
    const v = Number(raw.replace(/[^\d.\-]/g, ""));
    return Number.isFinite(v) ? v : undefined;
  };
  // ── Compute the pro-rated salary block ──────────────────────
  const annual      = num("AnnualPackage");
  const workingDays = num("WorkingDays");
  const enablePf    = String(customFields?.EnablePf ?? "false") === "true";
  const monthly     = annual > 0 ? annual / 12 : 0;
  const proRata     = workingDays > 0 ? (workingDays / 30) : 1; // 1 = full month
  // Full-month monetary values per the offer-letter formula.
  const mBasic = monthly * 0.50;
  const mHRA   = monthly * 0.20;
  const mDA    = monthly * 0.10;
  const mConv  = monthly * 0.075;
  const mMed   = 1250;
  const mPF    = enablePf ? 1800 : 0;
  const mFixed = mBasic + mHRA + mDA + mConv + mMed + mPF;
  const mSpecial = Math.max(0, Math.round(monthly) - Math.round(mFixed));
  // Pro-rate each by working days / 30.
  const calc = {
    Basic:               mBasic   * proRata,
    HRA:                 mHRA     * proRata,
    DearnessAllowance:   mDA      * proRata,
    ConveyanceAllowance: mConv    * proRata,
    MedicalAllowance:    mMed     * proRata,
    ProvidentFund:       mPF      * proRata,
    SpecialAllowance:    mSpecial * proRata,
  };
  // Leave encashment: daily Basic+DA × LE days. Fall back to 0
  // if no encashment days entered (no implicit encashment).
  const leDays = num("LeaveEncashmentDays");
  const dailyBasicDA = (mBasic + mDA) / 30;
  const calcLE = leDays > 0 ? dailyBasicDA * leDays : 0;
  // Manual overrides take precedence — HR can type any line and
  // the typed value wins over the computed one.
  const final = {
    Basic:                  numOrUndef("Basic")                  ?? calc.Basic,
    HRA:                    numOrUndef("HRA")                    ?? calc.HRA,
    MedicalAllowance:       numOrUndef("MedicalAllowance")       ?? calc.MedicalAllowance,
    ConveyanceAllowance:    numOrUndef("ConveyanceAllowance")    ?? calc.ConveyanceAllowance,
    SpecialAllowance:       numOrUndef("SpecialAllowance")       ?? calc.SpecialAllowance,
    DearnessAllowance:      numOrUndef("DearnessAllowance")      ?? calc.DearnessAllowance,
    ProvidentFund:          numOrUndef("ProvidentFund")          ?? calc.ProvidentFund,
    LeaveEncashmentAmount:  numOrUndef("LeaveEncashmentAmount")  ?? calcLE,
  };
  const totalEarnings = final.Basic + final.HRA + final.MedicalAllowance +
                        final.ConveyanceAllowance + final.SpecialAllowance +
                        final.DearnessAllowance + final.LeaveEncashmentAmount;
  // Provident Fund counts as a deduction in payslip-style
  // statements (employee contribution).
  const profTax = num("ProfessionalTax");
  const totalDeductions = profTax + final.ProvidentFund;
  const net = totalEarnings - totalDeductions;
  const fmtRs2 = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtRs0 = (n: number) => Math.round(n).toLocaleString("en-IN");
  switch (field) {
    // Computed line items (resolve to "" instead of "0.00" when
    // package not entered — keeps the form looking clean before
    // HR fills the trigger fields).
    case "Basic":               return annual > 0 ? fmtRs2(final.Basic) : "";
    case "HRA":                 return annual > 0 ? fmtRs2(final.HRA) : "";
    case "DearnessAllowance":   return annual > 0 ? fmtRs2(final.DearnessAllowance) : "";
    case "ConveyanceAllowance": return annual > 0 ? fmtRs2(final.ConveyanceAllowance) : "";
    case "MedicalAllowance":    return annual > 0 ? fmtRs2(final.MedicalAllowance) : "";
    case "SpecialAllowance":    return annual > 0 ? fmtRs2(final.SpecialAllowance) : "";
    case "ProvidentFund":       return annual > 0 ? fmtRs2(final.ProvidentFund) : "";
    case "LeaveEncashmentAmount": return final.LeaveEncashmentAmount > 0 ? fmtRs2(final.LeaveEncashmentAmount) : "";
    case "ProfessionalTax":     return profTax > 0 ? fmtRs2(profTax) : "0.00";
    // PF row visibility — single placeholder that resolves to the
    // <tr> only when EnablePf is true. Lets the same body template
    // cover both PF / no-PF cases without duplicating HTML.
    case "PfRow":
      return enablePf
        ? `<tr><td style="border:none; padding:3pt 0;">Provident Fund (PF)</td><td style="border:none; text-align:right; padding:3pt 0;">${fmtRs2(final.ProvidentFund)}</td></tr>`
        : "";
    // Totals
    case "TotalEarnings":       return fmtRs2(totalEarnings);
    case "TotalDeductions":     return fmtRs2(totalDeductions);
    case "NetPayable":          return fmtRs0(net);
    case "NetInWords":          return rupeesInWords(net);
    default:                    return "";
  }
}

function resolveSalary(field: string, customFields: Record<string, string>): string {
  const annual = Number(String(customFields?.AnnualPackage ?? "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(annual) || annual <= 0) {
    // Render placeholders as "—" so the table shows empty cells
    // when HR hasn't entered the package yet.
    return field === "Annual" || field === "Total" ? "—" : "—";
  }
  const enablePf = String(customFields?.EnablePf ?? "false") === "true";
  const monthly  = annual / 12;
  const basic    = Math.round(monthly * 0.50);
  const hra      = Math.round(monthly * 0.20);
  const da       = Math.round(monthly * 0.10);
  const conv     = Math.round(monthly * 0.075);
  const medical  = 1250;
  const pf       = enablePf ? 1800 : 0;
  // Special = whatever's left to make the column sum to monthly CTC.
  // We compute against the rounded values so the totals tie.
  const monthlyR = Math.round(monthly);
  const fixedSum = basic + hra + da + conv + medical + pf;
  const special  = Math.max(0, monthlyR - fixedSum);
  const fmtRs = (n: number) => n.toLocaleString("en-IN");
  switch (field) {
    case "Annual":     return fmtRs(annual);
    case "Monthly":    return fmtRs(monthlyR);
    case "Basic":      return fmtRs(basic);
    case "HRA":        return fmtRs(hra);
    case "DA":         return fmtRs(da);
    case "Conveyance": return fmtRs(conv);
    case "Medical":    return fmtRs(medical);
    case "PF":         return fmtRs(pf);
    case "Special":    return fmtRs(special);
    case "Total":      return fmtRs(monthlyR);
    // Single placeholder that resolves to the entire PF row when
    // enabled, or empty when disabled. One template body covers
    // both PF / no-PF cases without HR touching the HTML.
    case "PfRow":
      return enablePf
        ? `<tr><td>Provident Fund (PF)</td><td>${fmtRs(pf)}</td><td>Fixed</td></tr>`
        : "";
    case "EnablePfText": return enablePf ? "with PF" : "without PF";
    default:           return "";
  }
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
  //
  // Exception: placeholders whose KEYS are listed in
  // SAFE_HTML_PLACEHOLDERS resolve to first-party HTML fragments
  // we generate ourselves (e.g. {{Salary.PfRow}} → "<tr>…</tr>"),
  // so escaping them would print the literal tags as text in the
  // output. We trust those values because they're produced by
  // resolveSalary() with no user-controlled input flowing into
  // tag positions — only digits + INR commas via fmtRs().
  const html = bodyHtml.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_.]*)\s*\}\}/g, (_match, key: string) => {
    const v = resolvePlaceholder(key, renderCtx);
    if (v == null) {
      if (!missing.includes(key)) missing.push(key);
      return `[missing: ${escapeHtml(key)}]`;
    }
    return SAFE_HTML_PLACEHOLDERS.has(key) ? v : escapeHtml(v);
  });
  return { html, missing };
}

/** Placeholder keys whose resolved value is intentional HTML and
 *  must NOT be HTML-escaped. Everything else goes through
 *  escapeHtml() so user-controlled values (names, emails, custom
 *  fields) can't break out of their text node and inject script. */
const SAFE_HTML_PLACEHOLDERS = new Set<string>([
  "Salary.PfRow",
  "ExitSettlement.PfRow",
]);

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
    /* Global letter-spacing of 0.5px on every text element so the
       letter has the airy, formal feel of a printed HR document.
       Applied at the body level so every nested element inherits
       it — letterhead, title, paragraphs, lists, table cells.
       Brand-agnostic: same rule applies to NB Media and YT Labs
       letters since they share this wrapper. */
    /* Font stack: Times New Roman (Windows/macOS), Liberation
       Serif (Linux — metric-compatible drop-in for Times), then
       generic serif. The VPS runs Linux and most distros don't
       have Times New Roman by default; Liberation Serif ships with
       the standard fontconfig package and matches Times's
       character widths exactly, so the letter renders the same
       layout regardless of which font is actually picked.
       (Best practice: also apt install ttf-mscorefonts-installer
       on the VPS so the real Times New Roman is available too.) */
    html, body { margin: 0; padding: 0; background: #f8fafc; font-family: "Times New Roman", "Liberation Serif", "Nimbus Roman", "DejaVu Serif", Times, serif; color: #1f2937; letter-spacing: 0.5px; }
    .page {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      /* Compact margins — 16mm top / 18mm bottom / 16mm sides.
         Trimmed from 26 × 22 × 18 because long letters (Relieving
         with its 7-line NDA paragraph) were spilling onto page 2.
         Still plenty of whitespace for a printed letter. */
      padding: 16mm 16mm 18mm 16mm;
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
    .letterhead .lh-text { font-size: 10.5pt; line-height: 1.45; }
    .letterhead .lh-text .company { font-size: 12pt; font-weight: bold; margin-bottom: 4pt; }
    .letterhead .lh-logo { width: 86pt; height: auto; }
    h1.letter-title { font-size: 16pt; font-weight: bold; text-align: center; margin: 14pt 0 16pt; }
    /* Body paragraphs — 1.5 line height + 0.5px letter-spacing
       gives the text the airy, formal feel of a printed HR letter.
       Margins tightened to 4pt so the 1.5 line-height doesn't
       double-space consecutive paragraphs. */
    /* Body typography. 12pt / 1.55 line-height / 3pt margins keep
       the letter on a single A4 page in most cases. Word-spacing
       bumped to 2px so individual words have visible gaps between
       them — fixes the "congested / words running together"
       feel users hit at the 0.5px default. Letter-spacing
       inherits 0.5px from body. */
    p { font-size: 12pt; line-height: 1.5; margin: 2pt 0; text-align: left; word-spacing: 2px; }
    p.signoff, p[data-role="signoff"] { text-align: left; margin: 2pt 0; }
    p.note { text-align: center; font-style: italic; font-weight: bold; font-size: 11pt; margin: 4pt 0 12pt; }
    h2 { font-size: 14pt; margin: 12pt 0 6pt; }
    h3 { font-size: 13pt; margin: 10pt 0 6pt; }
    ol, ul { padding-left: 22pt; margin: 6pt 0; }
    ol li, ul li { margin-bottom: 3pt; font-size: 12pt; line-height: 1.5; word-spacing: 2px; }
    /* Keep the signature cluster (Regards / Name / Founder & CEO +
       cursive image) together — it has the cursive PNG and
       splitting it mid-block would look broken. We deliberately
       DO NOT lock down .acknowledgement because it's plain text
       with <br/> separators; if a tight letter would otherwise
       push the whole acknowledgement to page 2 just to keep its
       4 lines together, we'd rather let it flow naturally and
       keep the document on one page. */
    .no-break, .signature-block, p[data-role="signoff"] { page-break-inside: avoid; break-inside: avoid; }
    /* Force the same Times-family stack on tables — some user
       agents fall back to a sans-serif default for table cells if
       the family isn't restated. Liberation Serif ensures Linux
       VPS renders look the same as local. */
    table { width: 100%; border-collapse: collapse; margin: 14pt 0 18pt; font-family: "Times New Roman", "Liberation Serif", "Nimbus Roman", "DejaVu Serif", Times, serif; }
    /* More breathing room: 9pt vertical padding, 12pt horizontal —
       reads like a printed pay-table instead of a cramped grid. */
    table th, table td { border: 1pt solid #1f2937; padding: 9pt 12pt; font-size: 11pt; text-align: left; vertical-align: middle; font-family: "Times New Roman", "Liberation Serif", "Nimbus Roman", "DejaVu Serif", Times, serif; }
    table th { background: #f3f4f6; font-weight: bold; }
    /* Pay-table auto-alignment — first column left (labels),
       second column right (rupee amounts so the digits line up by
       their right edge), third column center (basis labels like
       50%, Fixed, Remaining). Applies whenever the body uses the
       .pay-table class (set on all Revised Offer Letter tables).
       Number cells get a tabular-nums OpenType feature so
       0/1/…/9 all occupy the same horizontal cell — keeps the
       column visually clean even when amounts differ in digit
       count. */
    table.pay-table td:nth-child(1), table.pay-table th:nth-child(1) { text-align: left; }
    table.pay-table td:nth-child(2), table.pay-table th:nth-child(2) { text-align: right; font-variant-numeric: tabular-nums; }
    table.pay-table td:nth-child(3), table.pay-table th:nth-child(3) { text-align: center; }
    /* Total row reads as a footer — slightly tinted background +
       bold weight so the eye lands on it. */
    table.pay-table tr:last-child td { background: #f9fafb; font-weight: bold; }
    /* Pay-table must NEVER split across pages — splitting it
       leaves "Basic Pay" on one page and the rest of the breakup
       on another, which reads as broken. page-break-inside is the
       puppeteer/Chromium alias; break-inside is the modern spec.
       The preceding "COMPENSATION STRUCTURE" / "Annexure A"
       heading uses page-break-after: avoid so the heading and
       table travel together — if there isn't room for both at the
       bottom of a page, Chrome pushes the whole heading + table
       to the next page intact. */
    table.pay-table { page-break-inside: avoid; break-inside: avoid; }
    table.pay-table tr { page-break-inside: avoid; break-inside: avoid; }
    h2.section-title, h3 { page-break-after: avoid; break-after: avoid; }
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
