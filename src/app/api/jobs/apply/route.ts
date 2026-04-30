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
    const jobOpeningId = Number(get("jobOpeningId"));
    if (!fullName)     return NextResponse.json({ error: "Full name is required" },  { status: 400 });
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
                       return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
    if (!Number.isFinite(jobOpeningId) || jobOpeningId <= 0)
                       return NextResponse.json({ error: "Pick a job to apply for" }, { status: 400 });

    // Confirm the opening exists and is still open.
    const openings = await prisma.$queryRawUnsafe<Array<{ id: number; title: string; isOpen: boolean }>>(
      `SELECT id, title, "isOpen" FROM "JobOpening" WHERE id = $1 LIMIT 1`,
      jobOpeningId,
    );
    const opening = openings[0];
    if (!opening) return NextResponse.json({ error: "Selected role no longer exists" }, { status: 400 });
    if (!opening.isOpen)
      return NextResponse.json({ error: "This role is no longer accepting applications" }, { status: 400 });

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
    const inserted = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
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
    const applicationId = inserted[0]?.id;

    // ── Notify hiring stakeholders ──
    // Same recipient set as feedback / report locks: CEO, HR managers,
    // admins, special_access, plus developer emails from env.
    try {
      const devEmails = (process.env.DEVELOPER_EMAILS || "")
        .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
      const recipients = await prisma.user.findMany({
        where: {
          isActive: true,
          OR: [
            { orgLevel: { in: ["ceo", "hr_manager", "special_access"] } },
            { role: "admin" },
            ...(devEmails.length > 0 ? [{ email: { in: devEmails } }] : []),
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
    console.error("[/api/jobs/apply] failed:", e);
    return NextResponse.json({ error: "Could not submit application" }, { status: 500 });
  }
}
