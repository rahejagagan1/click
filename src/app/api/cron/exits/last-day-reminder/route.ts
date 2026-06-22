// Daily "last working day is today" reminder.
//
// Fires once a day at 09:00 IST (= 03:30 UTC) and emails the offboarding
// stakeholders (HR managers / special-access / admins, toggle-gated
// developers, the employee's direct manager, and their brand CEO) one
// reminder per employee whose EmployeeExit.lastWorkingDay is today, so
// leadership knows the person is off the books as of today.
//
// Scheduling — pick ONE (don't double up):
//   • vercel.json    → { "path": "/api/cron/exits/last-day-reminder", "schedule": "30 3 * * *" }
//   • or VPS crontab → 30 3 * * *  curl -sS -X POST \
//                        -H "Authorization: Bearer $CRON_SECRET" \
//                        https://studio.nbmedia.co.in/api/cron/exits/last-day-reminder
//
// lastWorkingDay is a Postgres @db.Date, so we match it against the IST
// calendar day (istTodayDateOnly). No per-record dedup column is needed —
// the schedule fires the reminder exactly once, on the day itself.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { serverError } from "@/lib/api-auth";
import { sendEmail } from "@/lib/email/sender";
import { lastWorkingDayReminderEmail } from "@/lib/email/templates";
import { exitStakeholderEmails } from "@/lib/notifications";
import { istTodayDateOnly } from "@/lib/ist-date";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

async function handle(request: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get("authorization");
    if (!secret || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const today = istTodayDateOnly();
    // Exits whose last working day is today and who aren't already marked
    // fully exited (status flips to "exited" only after the day passes).
    const exits = await prisma.employeeExit.findMany({
      where: { lastWorkingDay: today, status: { not: "exited" } },
      select: {
        exitType: true,
        lastWorkingDay: true,
        reason: true,
        user: {
          select: {
            id: true, name: true, managerId: true,
            employeeProfile: { select: { employeeId: true, designation: true } },
          },
        },
      },
    });

    const sent: string[] = [];
    for (const ex of exits) {
      const recipients = await exitStakeholderEmails({
        id: ex.user.id,
        managerId: ex.user.managerId,
      });
      if (recipients.length === 0) continue;
      await sendEmail({
        to: recipients,
        content: lastWorkingDayReminderEmail({
          name:           ex.user.name,
          employeeId:     ex.user.employeeProfile?.employeeId ?? null,
          designation:    ex.user.employeeProfile?.designation ?? null,
          exitType:       ex.exitType,
          lastWorkingDay: ex.lastWorkingDay,
          reason:         ex.reason,
        }),
      });
      sent.push(ex.user.name);
    }

    return NextResponse.json({
      ok: true,
      date: today.toISOString().slice(0, 10),
      count: sent.length,
      employees: sent,
    });
  } catch (e) {
    return serverError(e, "POST /api/cron/exits/last-day-reminder");
  }
}

// GET + POST both supported — Vercel cron uses GET, the VPS crontab curl uses POST.
export const GET  = handle;
export const POST = handle;
