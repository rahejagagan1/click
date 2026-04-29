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
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        id: number; userId: number; userName: string; userEmail: string;
        designation: string | null; department: string | null;
        exitType: string; resignationDate: Date; lastWorkingDay: Date;
        noticePeriodDays: number; reason: string | null; notes: string | null;
        status: string;
        assetsReturned: boolean; documentsHandled: boolean;
        finalSettlementDone: boolean; exitInterviewDone: boolean;
        createdAt: Date;
      }>
    >(
      `SELECT e.id, e."userId", u.name AS "userName", u.email AS "userEmail",
              ep.designation, ep.department,
              e."exitType", e."resignationDate", e."lastWorkingDay",
              e."noticePeriodDays", e.reason, e.notes, e.status,
              e."assetsReturned", e."documentsHandled",
              e."finalSettlementDone", e."exitInterviewDone", e."createdAt"
         FROM "EmployeeExit" e
         JOIN "User" u ON u.id = e."userId"
    LEFT JOIN "EmployeeProfile" ep ON ep."userId" = e."userId"
        ORDER BY e."createdAt" DESC`,
    );
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

    // Insert the exit row + flip isActive in a single transaction so we
    // don't leave one of them dangling on partial failure.
    await prisma.$transaction([
      prisma.$executeRawUnsafe(
        `INSERT INTO "EmployeeExit"
           ("userId", "exitType", "resignationDate", "lastWorkingDay", "noticePeriodDays",
            reason, notes, "initiatedById", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
         ON CONFLICT ("userId") DO UPDATE
            SET "exitType" = EXCLUDED."exitType",
                "resignationDate" = EXCLUDED."resignationDate",
                "lastWorkingDay" = EXCLUDED."lastWorkingDay",
                "noticePeriodDays" = EXCLUDED."noticePeriodDays",
                reason = EXCLUDED.reason,
                notes = EXCLUDED.notes,
                "updatedAt" = now()`,
        userId, exitType, resignationDate, lastWorkingDay, noticePeriodDays,
        reason, notes, initiatedBy,
      ),
      prisma.user.update({
        where: { id: userId },
        data:  { isActive: false },
      }),
    ]);

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
      const devEmails = (process.env.DEVELOPER_EMAILS || "")
        .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
      const stakeholders = await prisma.user.findMany({
        where: {
          isActive: true,
          OR: [
            { orgLevel: { in: ["ceo", "hr_manager", "special_access"] } },
            { role: "admin" },
            ...(devEmails.length > 0 ? [{ email: { in: devEmails } }] : []),
            ...(target.managerId ? [{ id: target.managerId }] : []),
          ],
        },
        select: { id: true, email: true },
      });
      const recipientEmails = stakeholders.map(u => u.email).filter(Boolean) as string[];
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
