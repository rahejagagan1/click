// Public submit endpoint — accepts multipart/form-data with the candidate's
// info + resume upload, persists a JobApplication row, and notifies the
// hiring stakeholders (CEO / HR / admins / developers / special_access).
//
// Resume files land in /public/uploads/resumes/<random>-<safe-name> so
// they're served via Next's static asset handler on the same domain.
//
// IMPORTANT: this route is NOT auth-gated — anyone on the internet can
// post here. Mitigations: 5MB file cap, file-extension whitelist, simple
// per-IP rate-limit shield can be added later if abuse becomes an issue.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import prisma from "@/lib/prisma";
import { notifyUsers } from "@/lib/notifications";
import { devEmailRecipientsClause } from "@/lib/email/toggles";

export const dynamic = "force-dynamic";
// File uploads need the Node runtime (Edge can't do fs).
export const runtime = "nodejs";

const MAX_FILE_BYTES = 5 * 1024 * 1024;       // 5 MB
// Generous whitelist — match parse-resume so uploads never get rejected
// for the candidate's choice of format. The file is stored verbatim;
// auto-fill is best-effort.
const ALLOWED_EXTS = new Set([
  ".pdf", ".doc", ".docx",
  ".rtf", ".odt", ".pages",
  ".txt", ".md", ".html", ".htm",
]);

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const get  = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v.trim() : null;
    };

    // ── Required basics ──
    const fullName     = get("fullName");
    const email        = get("email");
    // Candidates can land here from /jobs/[slug] → ?role=<id> OR a
    // partner site that POSTs slug instead of id. Accept either.
    const idRaw   = Number(get("jobOpeningId"));
    const slugRaw = get("slug");
    if (!fullName)     return NextResponse.json({ error: "Full name is required" },  { status: 400 });
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
                       return NextResponse.json({ error: "A valid email is required" }, { status: 400 });

    // fetchOpening tries the wider column set first (with the new
    // allowReapplyDays column) and falls back to the legacy shape on
    // DBs where the wizard migration hasn't run yet.
    type Opening = { id: number; title: string; status: string; closesAt: Date | null; brand?: string | null; allowReapplyDays?: number | null };
    const fetchOpening = async (whereSql: string, param: number | string): Promise<Opening[]> => {
      try {
        return await prisma.$queryRawUnsafe<Opening[]>(
          `SELECT id, title, "status", "closesAt", brand, "allowReapplyDays"
             FROM "JobOpening" WHERE ${whereSql} LIMIT 1`,
          param,
        );
      } catch (e: any) {
        const msg = String(e?.meta?.message || e?.message || "");
        if (!/does not exist|42703/i.test(msg)) throw e;
        return await prisma.$queryRawUnsafe<Opening[]>(
          `SELECT id, title, "status", "closesAt", brand FROM "JobOpening" WHERE ${whereSql} LIMIT 1`,
          param,
        );
      }
    };

    let opening: Opening | undefined;
    if (Number.isFinite(idRaw) && idRaw > 0) {
      const rows = await fetchOpening("id = $1", idRaw);
      opening = rows[0];
    } else if (slugRaw) {
      const rows = await fetchOpening(`"publicSlug" = $1`, slugRaw);
      opening = rows[0];
    } else {
      return NextResponse.json({ error: "Pick a job to apply for" }, { status: 400 });
    }
    if (!opening) return NextResponse.json({ error: "Selected role no longer exists" }, { status: 400 });

    // Only PUBLISHED jobs accept applications. DRAFT / ON_HOLD / CLOSED
    // all 400 with a friendly message — drafts shouldn't be reachable
    // via the public site anyway, but defending against ?role= URL
    // manipulation is cheap.
    if (opening.status !== "published")
      return NextResponse.json({ error: "This role is no longer accepting applications" }, { status: 400 });
    if (opening.closesAt && new Date(opening.closesAt) <= new Date())
      return NextResponse.json({ error: "Applications for this role have closed" }, { status: 400 });
    const jobOpeningId = opening.id;

    // ── Reapply window ──────────────────────────────────────────────
    // `allowReapplyDays` semantics (matches Keka):
    //   • > 0  → block re-application within the last N days; allow
    //            after the window passes.
    //   • = 0  → no restriction; same email can re-apply any time.
    // The check is by email (lowercased) since that's the candidate's
    // stable identity on the public form (no auth here).
    const reapplyDays = Number(opening.allowReapplyDays ?? 0);
    if (reapplyDays > 0) {
      const dupRows = await prisma.$queryRawUnsafe<Array<{ createdAt: Date }>>(
        `SELECT "createdAt"
           FROM "JobApplication"
          WHERE "jobOpeningId" = $1
            AND LOWER(email)   = LOWER($2)
            AND "createdAt"    > NOW() - ($3 || ' days')::interval
          ORDER BY "createdAt" DESC
          LIMIT 1`,
        jobOpeningId, email, String(reapplyDays),
      );
      const prev = dupRows[0];
      if (prev) {
        // Privacy-conscious wording: we don't echo the precise prior
        // application date or the email-specific re-apply timestamp,
        // since the error response would otherwise be a single-shot
        // email-enumeration oracle ("did this address apply, and
        // when?"). The legitimate applicant knows when they applied;
        // a probing third party gets only a generic refusal.
        return NextResponse.json(
          {
            error: `We're unable to accept another application for this role from you right now. Please try again after ${reapplyDays} day${reapplyDays === 1 ? "" : "s"}.`,
          },
          { status: 409 },
        );
      }
    }

    // ── Optional fields (validated lightly) ──
    const phone        = get("phone");
    const linkedinUrl  = get("linkedinUrl");
    const portfolioUrl = get("portfolioUrl");
    const coverLetter  = get("coverLetter");
    const currentCompany = get("currentCompany");
    const noticePeriod = get("noticePeriod");
    const expRaw       = get("experienceYears");
    const experienceYears = expRaw && /^\d+$/.test(expRaw) ? Math.min(60, Number(expRaw)) : null;

    // ── Resume upload ──
    const resume = form.get("resume");
    let resumeFileName: string | null = null;
    let resumeUrl:      string | null = null;
    if (resume instanceof File && resume.size > 0) {
      if (resume.size > MAX_FILE_BYTES)
        return NextResponse.json({ error: "Resume must be 5 MB or smaller" }, { status: 400 });
      const ext = extname(resume.name).toLowerCase();
      if (!ALLOWED_EXTS.has(ext))
        return NextResponse.json({ error: "Resume must be a PDF, Word, RTF, ODT, TXT, or HTML file" }, { status: 400 });
      const safeBase = resume.name
        .replace(/\.[^.]+$/, "")
        .replace(/[^A-Za-z0-9._-]+/g, "_")
        .slice(0, 60) || "resume";
      const stamped = `${randomUUID()}-${safeBase}${ext}`;
      const dir     = resolve(process.cwd(), "public", "uploads", "resumes");
      await mkdir(dir, { recursive: true });
      const buf     = Buffer.from(await resume.arrayBuffer());
      await writeFile(resolve(dir, stamped), buf);
      resumeFileName = resume.name;
      resumeUrl      = `/uploads/resumes/${stamped}`;
    }

    // ── Extra "smart form" fields (added in the redesigned UI) ──────
    // All optional / nullable in the DB, so a candidate using the
    // legacy form (no extra fields) still submits successfully.
    const firstName            = get("firstName");
    const middleName           = get("middleName");
    const lastName             = get("lastName");
    const gender               = get("gender");
    const dobRaw               = get("dateOfBirth");
    const dateOfBirth          = dobRaw && /^\d{4}-\d{2}-\d{2}$/.test(dobRaw) ? new Date(dobRaw) : null;
    const mobileCountryCode    = get("mobileCountryCode");
    const expMonRaw            = get("experienceMonths");
    const experienceMonths     = expMonRaw && /^\d+$/.test(expMonRaw) ? Math.min(11, Number(expMonRaw)) : null;
    const numericOrNull = (v: string | null) => {
      if (!v) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const intOrNull = (v: string | null) => {
      if (!v) return null;
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    };
    const currentSalary           = numericOrNull(get("currentSalary"));
    const currentSalaryCurrency   = get("currentSalaryCurrency");
    const currentSalaryFreq       = get("currentSalaryFreq");
    const expectedSalary          = numericOrNull(get("expectedSalary"));
    const expectedSalaryCurrency  = get("expectedSalaryCurrency");
    const expectedSalaryFreq      = get("expectedSalaryFreq");
    const availableToJoinDays     = intOrNull(get("availableToJoinDays"));
    const preferredLocation       = get("preferredLocation");
    const currentLocationVal      = get("currentLocation");
    const skills                  = get("skills");
    const educationDetails        = get("educationDetails");
    const experienceDetails       = get("experienceDetails");

    // ── Insert via raw SQL — typed client may not know JobApplication yet ──
    // The full INSERT includes the "smart form" columns (firstName,
    // dateOfBirth, salary fields, etc.). Older deploys haven't run
    // the smart-form migration yet (the table is owned by a
    // different Postgres role on some envs so HR has to run the
    // ALTER manually). When that happens the INSERT fails with
    // 42703 — fall back to the legacy column-set so the candidate's
    // basic info still lands.
    let inserted: Array<{ id: number }> = [];
    try {
      inserted = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
        `INSERT INTO "JobApplication"
           ("jobOpeningId", "fullName", email, phone, "coverLetter",
            "linkedinUrl", "portfolioUrl", "experienceYears", "currentCompany",
            "noticePeriod", "resumeFileName", "resumeUrl",
            "firstName", "middleName", "lastName", gender, "dateOfBirth",
            "mobileCountryCode", "experienceMonths",
            "currentSalary", "currentSalaryCurrency", "currentSalaryFreq",
            "expectedSalary", "expectedSalaryCurrency", "expectedSalaryFreq",
            "availableToJoinDays", "preferredLocation", "currentLocation",
            skills, "educationDetails", "experienceDetails",
            status, "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
                 $13,$14,$15,$16,$17,$18,$19,
                 $20,$21,$22,$23,$24,$25,
                 $26,$27,$28,$29,$30,$31,
                 'new', now())
         RETURNING id`,
        jobOpeningId, fullName, email, phone, coverLetter,
        linkedinUrl, portfolioUrl, experienceYears, currentCompany,
        noticePeriod, resumeFileName, resumeUrl,
        firstName, middleName, lastName, gender, dateOfBirth,
        mobileCountryCode, experienceMonths,
        currentSalary, currentSalaryCurrency, currentSalaryFreq,
        expectedSalary, expectedSalaryCurrency, expectedSalaryFreq,
        availableToJoinDays, preferredLocation, currentLocationVal,
        skills, educationDetails, experienceDetails,
      );
    } catch (insertErr: any) {
      const code = insertErr?.meta?.code || insertErr?.code;
      const msg  = String(insertErr?.meta?.message || insertErr?.message || "");
      if (code === "42703" || /column .* does not exist/i.test(msg)) {
        // Legacy fallback — only the columns that have been in
        // JobApplication since day one. Extra profile data (DOB,
        // salary, skills, etc.) is dropped on the floor; HR can
        // re-collect that at the interview stage.
        // Stash the lost extras in coverLetter so nothing's lost.
        const dropped = [
          firstName        && `First name: ${firstName}`,
          middleName       && `Middle name: ${middleName}`,
          lastName         && `Last name: ${lastName}`,
          gender           && `Gender: ${gender}`,
          dobRaw           && `DOB: ${dobRaw}`,
          mobileCountryCode && `Country code: ${mobileCountryCode}`,
          (experienceMonths != null)   && `Experience months: ${experienceMonths}`,
          currentSalary    && `Current salary: ${currentSalaryCurrency || ""} ${currentSalary} ${currentSalaryFreq || ""}`.trim(),
          expectedSalary   && `Expected salary: ${expectedSalaryCurrency || ""} ${expectedSalary} ${expectedSalaryFreq || ""}`.trim(),
          (availableToJoinDays != null) && `Available in: ${availableToJoinDays} days`,
          preferredLocation && `Preferred location: ${preferredLocation}`,
          currentLocationVal && `Current location: ${currentLocationVal}`,
          skills            && `Skills: ${skills}`,
          educationDetails  && `Education: ${educationDetails}`,
          experienceDetails && `Experience: ${experienceDetails}`,
        ].filter(Boolean).join("\n");
        const mergedCover = [coverLetter, dropped].filter(Boolean).join("\n\n---\n\n") || null;

        inserted = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
          `INSERT INTO "JobApplication"
             ("jobOpeningId", "fullName", email, phone, "coverLetter",
              "linkedinUrl", "portfolioUrl", "experienceYears", "currentCompany",
              "noticePeriod", "resumeFileName", "resumeUrl",
              status, "updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
                   'new', now())
           RETURNING id`,
          jobOpeningId, fullName, email, phone, mergedCover,
          linkedinUrl, portfolioUrl, experienceYears, currentCompany,
          noticePeriod, resumeFileName, resumeUrl,
        );
      } else {
        throw insertErr;
      }
    }
    const applicationId = inserted[0]?.id;

    // ── Stamp `source` on the new application ──
    // Derived from the job's brand so HR can filter / report on
    // "where did this candidate come from". Written as a separate
    // UPDATE so a missing column (legacy DBs that haven't run the
    // Keka migration yet) fails gracefully — the insert above still
    // landed and the candidate isn't lost.
    if (applicationId) {
      const brand = String(opening.brand || "").toLowerCase();
      // Prefer the HTTP Referer when the request came from a known
      // partner domain so HR can distinguish syndicated postings.
      const ref = String(req.headers.get("referer") || "");
      let host = "";
      try { host = new URL(ref).hostname.replace(/^www\./, ""); } catch {}
      const partnerHosts: Record<string, string> = {
        "linkedin.com":   "LinkedIn",
        "naukri.com":     "Naukri",
        "instahyre.com":  "Instahyre",
        "indeed.com":     "Indeed",
        "wellfound.com":  "Wellfound",
        "angel.co":       "Wellfound",
      };
      const partnerLabel = Object.entries(partnerHosts).find(([h]) => host.endsWith(h))?.[1] || null;
      const brandLabel =
        brand === "nb_media" ? "NB Media Careers" :
        brand === "yt_labs"  ? "YT Labs Careers"  :
        "Careers Page";
      const sourceLabel = partnerLabel ? `${partnerLabel} → ${brandLabel}` : brandLabel;
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "JobApplication" SET source = $1 WHERE id = $2`,
          sourceLabel,
          applicationId,
        );
      } catch (e: any) {
        // 42703 = column "source" does not exist (legacy DB). Non-fatal:
        // the application row is already saved, we just couldn't tag it.
        const code = e?.meta?.code || e?.code;
        if (code !== "42703" && !/does not exist/i.test(String(e?.message))) {
          console.error("Could not stamp source on JobApplication:", e);
        }
      }
    }

    // ── Notify hiring stakeholders ──
    // Same recipient set as feedback / report locks: CEO, HR managers,
    // admins, special_access. Developer accounts gated by the
    // "Notify developers" toggle in Admin → Emails Automation.
    try {
      const recipients = await prisma.user.findMany({
        where: {
          isActive: true,
          OR: [
            { orgLevel: { in: ["ceo", "hr_manager", "special_access"] } },
            { role: "admin" },
            ...(await devEmailRecipientsClause()),
          ],
        },
        select: { id: true },
      });
      const userIds = recipients.map(u => u.id);
      if (userIds.length > 0) {
        await notifyUsers({
          actorId: null,
          userIds,
          type: "job_application" as any,
          title: `New job application — ${opening.title}`,
          body: [
            `name: ${fullName}`,
            `email: ${email}`,
            phone ? `phone: ${phone}` : "",
            `role: ${opening.title}`,
            `link: /dashboard/hr/hiring`,
          ].filter(Boolean).join("\n"),
          entityId: applicationId,
          linkUrl: "/dashboard/hr/hiring",
        });
      }
    } catch (e) {
      console.error("[/api/jobs/apply] notify failed:", e);
      // Don't fail the candidate's submission if notification dispatch breaks.
    }

    return NextResponse.json({ ok: true, id: applicationId });
  } catch (e: any) {
    // This endpoint is public (anyone on the internet can hit /api/
    // jobs/apply). Never echo raw Postgres / Prisma messages back —
    // column names, table names, and error codes are recon for an
    // attacker. Log everything server-side with a correlation id;
    // return only a generic class-of-error message plus that id so
    // HR can quote it to support.
    const code   = e?.meta?.code   || e?.code;
    const detail = e?.meta?.message || e?.message || "";
    const reqId  = randomUUID();
    console.error("[/api/jobs/apply] failed:", reqId, code, detail, e);

    if (/too many .*connections/i.test(detail) || /connection slots/i.test(detail)) {
      return NextResponse.json(
        { error: "We're a bit overloaded right now. Please try again in a few seconds.", reqId },
        { status: 503 },
      );
    }
    if (code === "42703" || code === "42P01" || /does not exist/i.test(detail)) {
      return NextResponse.json(
        { error: "Something's misconfigured on our end. Please try again later — your details haven't been saved.", reqId },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: "Could not submit application. Please try again later.", reqId },
      { status: 500 },
    );
  }
}
