// PATCH /api/hr/wfh/balances/:userId?monthKey=YYYY-Mxx
//
// HR-admin manual override of a single employee's WFH balance
// for one month. Use cases:
//   • Grant an exception (e.g. Manpreet on notice → +3 extra)
//   • Correct a mistake (cron credited wrong amount)
//   • Set `used` directly for a back-fill / migration
//
// Body: { credited?: number, used?: number }
//   • Either / both can be passed.
//   • Range 0-31 (a month's worth of days).
// Optional `monthKey` query param (defaults to current month).
//
// Returns the updated balance row + the editor's name for the
// audit display.
//
// Auth: HR-admin only. Brand-scoped — a YT Labs HR Manager can't
// edit an NB Media employee even if they know the userId.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, resolveUserId, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { getMonthKey } from "@/lib/hr/pulse-week";
import { getBrandScope } from "@/lib/hr/brand-scope";
import { getWfhPolicy, quotaForBrand } from "@/lib/hr/wfh-balance";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { userId: userIdRaw } = await params;
    const userId = parseInt(userIdRaw, 10);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "Bad userId" }, { status: 400 });
    }

    const url = new URL(req.url);
    const monthKey = url.searchParams.get("monthKey") || getMonthKey();
    if (!/^\d{4}-M(0[1-9]|1[0-2])$/.test(monthKey)) {
      return NextResponse.json({ error: "Bad monthKey" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const credited = body?.credited;
    const used     = body?.used;
    const hasCredited = credited !== undefined && credited !== null;
    const hasUsed     = used     !== undefined && used     !== null;
    if (!hasCredited && !hasUsed) {
      return NextResponse.json({ error: "Provide credited and/or used" }, { status: 400 });
    }
    if (hasCredited && (!Number.isInteger(credited) || credited < 0 || credited > 31)) {
      return NextResponse.json({ error: "credited must be an integer 0-31" }, { status: 400 });
    }
    if (hasUsed && (!Number.isInteger(used) || used < 0 || used > 31)) {
      return NextResponse.json({ error: "used must be an integer 0-31" }, { status: 400 });
    }

    // Brand scope check — fetch the subject's brand and bounce
    // when the caller can't see it.
    const subject = await prisma.$queryRawUnsafe<Array<{ id: number; businessUnit: string | null }>>(
      `SELECT u.id, ep."businessUnit"
         FROM "User" u
         LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
        WHERE u.id = $1
        LIMIT 1`,
      userId,
    );
    if (!subject[0]) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const subjectBrand = subject[0].businessUnit;

    const scope = getBrandScope(session!.user);
    if (!scope.allBrands && scope.brand !== subjectBrand) {
      return NextResponse.json({ error: "Forbidden — outside your brand scope" }, { status: 403 });
    }

    const callerId = await resolveUserId(session);

    // Upsert. For brand-new rows we need a credited value — use
    // either the supplied one or fall back to the policy quota.
    const policy = await getWfhPolicy();
    const defaultCredited = quotaForBrand(policy, subjectBrand);
    const insertCredited = hasCredited ? credited : defaultCredited;
    const insertUsed     = hasUsed     ? used     : 0;

    // ON CONFLICT: only update the fields the client actually
    // sent. Build the SET dynamically.
    const updateSets: string[] = [];
    const updateArgs: any[] = [];
    if (hasCredited) {
      updateArgs.push(credited);
      updateSets.push(`"credited" = $${updateArgs.length}`);
    }
    if (hasUsed) {
      updateArgs.push(used);
      updateSets.push(`"used" = $${updateArgs.length}`);
    }
    updateArgs.push(callerId ?? null);
    updateSets.push(`"updatedById" = $${updateArgs.length}`);
    updateSets.push(`"updatedAt" = NOW()`);

    // Insert params come first.
    const params2 = [userId, monthKey, insertCredited, insertUsed, callerId ?? null, ...updateArgs];

    const rows = await prisma.$queryRawUnsafe<Array<any>>(
      `INSERT INTO "WfhBalance" ("userId", "monthKey", "credited", "used", "updatedById", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT ("userId", "monthKey")
       DO UPDATE SET ${updateSets.join(", ")}
       RETURNING id, "userId", "monthKey", credited, used,
                 "updatedById", "updatedAt"`,
      ...params2,
    );
    const updated = rows[0];

    // Optional: who is the editor?
    let updatedByName: string | null = null;
    if (updated?.updatedById) {
      const u = await prisma.$queryRawUnsafe<any[]>(
        `SELECT name FROM "User" WHERE id = $1 LIMIT 1`,
        updated.updatedById,
      );
      updatedByName = u[0]?.name ?? null;
    }

    return NextResponse.json({
      userId: updated.userId,
      monthKey: updated.monthKey,
      credited: updated.credited,
      used: updated.used,
      remaining: Math.max(0, updated.credited - updated.used),
      updatedAt: updated.updatedAt,
      updatedByName,
    });
  } catch (e) {
    return serverError(e, "PATCH /api/hr/wfh/balances/[userId]");
  }
}
