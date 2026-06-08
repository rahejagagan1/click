// HR-side offboarding endpoint.
//   GET  → list every EmployeeExit row, joined to User basics.
//   POST → record a new exit. Side-effects: flips User.isActive=false,
//          fires goodbye email to the leaver + notification + email to
//          CEO / HR / admins / developers / their manager.
//
// Raw SQL throughout because the typed Prisma client may not know about
// the new EmployeeExit table until `prisma generate` reruns.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { sendEmail } from "@/lib/email/sender";
import { employeeFarewellEmail, exitNotificationEmail } from "@/lib/email/templates";
import { devEmailRecipientsClause } from "@/lib/email/toggles";
import { brandCeoIdForEmployee } from "@/lib/notifications";
import { canViewAllBrands } from "@/lib/access";

export const dynamic = "force-dynamic";

function canManage(session: any): boolean {
  const u = session?.user;
  return !!u && (u.orgLevel === "ceo" || u.orgLevel === "hr_manager" || u.role === "admin" || u.isDeveloper === true);
}

const EXIT_TYPES = new Set(["resignation", "termination", "contract_end", "retirement", "other"]);

export async function GET() {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    // ── Strict brand-scope ─────────────────────────────────────
    // Each per-brand HR Manager (NB Media / YT Labs) sees ONLY
    // exits for employees with the same businessUnit on their
    // EmployeeProfile. No "legacy NULL bypass" — earlier attempt
    // used COALESCE(..., '') IN ('', $1) so rows with NULL
    // businessUnit would show up to everyone; that turned out to
    // be the leak (Manpreet Singh / Arpit Sharma had NULL on
    // their profile so YT Labs HR could still see them). If a
    // row legitimately lacks a brand, only developers see it (so
    // HR can fix the data).
    //
    // canViewAllBrands bypass:
    //   • Developers → always
    //   • role = "hr_manager" (top-tier org-wide) → always
    //   Per-brand HR Managers (orgLevel=hr_manager + businessUnit
    //   set) and CEOs are brand-scoped here.
    //
    // If the caller has no businessUnit on their own profile AND
    // doesn't pass canViewAllBrands, return an empty list. Better
    // to show "0 of 0" + force HR to set the brand on the user's
    // profile than to silently leak the whole table.
    const user = session!.user as any;
    const callerBu = user?.businessUnit ?? null;
    const allBrands = canViewAllBrands(user);

    const baseSql = `SELECT e.id, e."userId", u.name AS "userName", u.email AS "userEmail",
                            ep.designation, ep.department, ep."businessUnit",
                            e."exitType", e."resignationDate", e."lastWorkingDay",
                            e."noticePeriodDays", e.reason, e.notes, e.status,
                            e."assetsReturned", e."documentsHandled",
                            e."finalSettlementDone", e."exitInterviewDone",
                            e."okToRehire", e."createdAt"
                       FROM "EmployeeExit" e
                       JOIN "User" u ON u.id = e."userId"
                  LEFT JOIN "EmployeeProfile" ep ON ep."userId" = e."userId"`;

    let rows: any[];
    if (allBrands) {
      rows = await prisma.$queryRawUnsafe<any[]>(
        `${baseSql} ORDER BY e."createdAt" DESC`,
      );
    } else if (!callerBu) {
      console.warn(`[GET /api/hr/exits] caller #${user?.dbId} has no businessUnit set — returning empty list. Set their EmployeeProfile.businessUnit to enable brand-scoped access.`);
      rows = [];
    } else {
      rows = await prisma.$queryRawUnsafe<any[]>(
        `${baseSql} WHERE ep."businessUnit" = $1 ORDER BY e."createdAt" DESC`,
        callerBu,
      );
    }

    return NextResponse.json(rows);
  } catch (e: any) {
    console.error("[GET /api/hr/exits] failed:", e);
    return NextResponse.json({ error: "Could not load exits" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!canManage(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const userId          = Number(body?.userId);
    const exitType        = String(body?.exitType || "resignation");
    const resignationDate = body?.resignationDate ? new Date(body.resignationDate) : null;
    const lastWorkingDay  = body?.lastWorkingDay  ? new Date(body.lastWorkingDay)  : null;
    const noticePeriodDays = Number.isFinite(Number(body?.noticePeriodDays)) ? Number(body.noticePeriodDays) : 30;
    const reason          = body?.reason ? String(body.reason) : null;
    const notes           = body?.notes  ? String(body.notes)  : null;
    const okToRehire      = body?.okToRehire === true;

    if (!Number.isFinite(userId)) return NextResponse.json({ error: "userId is required" }, { status: 400 });
    if (!EXIT_TYPES.has(exitType)) return NextResponse.json({ error: "Invalid exit type" }, { status: 400 });
    if (!resignationDate || isNaN(resignationDate.getTime()))
      return NextResponse.json({ error: "Resignation date is required" }, { status: 400 });
    if (!lastWorkingDay  || isNaN(lastWorkingDay.getTime()))
      return NextResponse.json({ error: "Last working day is required" }, { status: 400 });

    // Confirm the user exists + is currently active. Pulls manager and
    // employee profile in the same query for the notification step.
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, email: true, isActive: true, managerId: true,
        manager: { select: { id: true } },
      },
    });
    if (!target) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    if (!target.isActive)
      return NextResponse.json({ error: "Employee is already inactive" }, { status: 409 });

    const initiatedBy = (session!.user as any)?.dbId ?? null;

    // Create (or update) the exit row. The employee STAYS active through
    // the notice period — their account is fully usable until HR flips
    // the exit status to "offboarded" via PATCH /api/hr/exits/[id],
    // which then sets User.isActive=false. So search bars, the People
    // directory, and the @-mention picker still show them until then.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "EmployeeExit"
         ("userId", "exitType", "resignationDate", "lastWorkingDay", "noticePeriodDays",
          reason, notes, "okToRehire", "initiatedById", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       ON CONFLICT ("userId") DO UPDATE
          SET "exitType" = EXCLUDED."exitType",
              "resignationDate" = EXCLUDED."resignationDate",
              "lastWorkingDay" = EXCLUDED."lastWorkingDay",
              "noticePeriodDays" = EXCLUDED."noticePeriodDays",
              reason = EXCLUDED.reason,
              notes = EXCLUDED.notes,
              "okToRehire" = EXCLUDED."okToRehire",
              "updatedAt" = now()`,
      userId, exitType, resignationDate, lastWorkingDay, noticePeriodDays,
      reason, notes, okToRehire, initiatedBy,
    );

    // Fire emails — fire-and-forget so SMTP hiccups don't block save.
    if (target.email) {
      void sendEmail({
        to: target.email,
        content: employeeFarewellEmail({
          name: target.name,
          lastWorkingDay,
        }),
      });
    }

    try {
      // Brand-CEO routing: HR / Special Access / admin (CEO excluded)
      // + the exiting employee's brand CEO + direct manager. Each CEO
      // sees only their own brand's exits.
      const [stakeholders, brandCeoId] = await Promise.all([
        prisma.user.findMany({
          where: {
            isActive: true,
            orgLevel: { not: "ceo" },
            OR: [
              { orgLevel: { in: ["hr_manager", "special_access"] } },
              { role: "admin" },
              // Developer accounts gated by the "Notify developers"
              // toggle in Admin → Emails Automation.
              ...(await devEmailRecipientsClause()),
              ...(target.managerId ? [{ id: target.managerId }] : []),
            ],
          },
          select: { id: true, email: true },
        }),
        brandCeoIdForEmployee(target.id),
      ]);
      // Resolve the brand CEO's email separately (the query above
      // excluded all CEOs).
      let brandCeoEmail: string | null = null;
      if (brandCeoId) {
        const ceo = await prisma.user.findUnique({
          where: { id: brandCeoId },
          select: { email: true },
        });
        brandCeoEmail = ceo?.email ?? null;
      }
      const recipientEmails = [
        ...stakeholders.map(u => u.email),
        brandCeoEmail,
      ].filter(Boolean) as string[];
      if (recipientEmails.length > 0) {
        void sendEmail({
          to: recipientEmails,
          content: exitNotificationEmail({
            name: target.name,
            email: target.email,
            exitType,
            lastWorkingDay,
            reason,
          }),
        });
      }
    } catch (e) {
      console.error("[POST /api/hr/exits] notify-stakeholders failed:", e);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[POST /api/hr/exits] failed:", e);
    return NextResponse.json({ error: e?.message || "Could not record exit" }, { status: 500 });
  }
}
