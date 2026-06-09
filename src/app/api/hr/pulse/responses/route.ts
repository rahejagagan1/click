// HR-admin: GET /api/hr/pulse/responses?surveyType=weekly|monthly&cycleKey=...
//
// ANONYMITY ENFORCED AT THIS LAYER.
//
// Returns aggregated stats for a cycle — counts, averages,
// distributions, AND anonymous text comments. We deliberately never
// return userId or any per-respondent breakdown, even to HR-admin.
// The DB stores userId for the clock-out gate + uniqueness check;
// this endpoint is the only path HR has to view responses, and it
// strips identity before it leaves the server.
//
// surveyType defaults to "weekly". cycleKey defaults to the current
// week / month. To browse history, HR passes a past cycleKey.
//
// Response shape:
// {
//   cycleKey,
//   surveyType,
//   participation: { responded, totalActiveUsers, percent },
//   questions: [{
//     id, order, text, type,
//     stats: {
//       count,
//       average,            // null for text questions
//       distribution,       // { "0": 1, "1": 3, ... }  (null for text)
//       enpsScore?,         // only for type=enps  (-100..100)
//     },
//     comments: string[]    // anonymous free-text responses
//   }]
// }

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { getCycleKey, getActiveWeekNumber } from "@/lib/hr/pulse-week";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const surveyType: "weekly" | "monthly" =
      url.searchParams.get("surveyType") === "monthly" ? "monthly" : "weekly";
    const cycleKey = url.searchParams.get("cycleKey") || getCycleKey(surveyType);

    // Resolve which question set is in play. For weekly, the cycleKey
    // doesn't directly tell us which rotation week was active — we
    // need to derive it. For simplicity, when HR views "this week",
    // we use the current activeWeek; when they view a historical week
    // we look up which questions were actually answered in that cycle.
    let questions: any[];
    if (surveyType === "monthly") {
      questions = await prisma.$queryRawUnsafe(
        `SELECT id, "order", text, type, emojis
           FROM "PulseQuestion"
          WHERE "surveyType" = 'monthly' AND "isActive" = true
          ORDER BY "order" ASC`,
      );
    } else {
      // Find the questions actually answered in this cycle. Falls
      // back to the current rotation's questions if the cycle has
      // zero responses (so HR still sees the form shape).
      const respondedIds = await prisma.$queryRawUnsafe<any[]>(
        `SELECT DISTINCT "questionId" FROM "PulseResponse" WHERE "weekKey" = $1`,
        cycleKey,
      );
      if (respondedIds.length > 0) {
        questions = await prisma.$queryRawUnsafe(
          `SELECT id, "order", text, type, emojis
             FROM "PulseQuestion"
            WHERE id = ANY($1::int[])
            ORDER BY "order" ASC`,
          respondedIds.map((r) => r.questionId),
        );
      } else {
        const activeWeek = getActiveWeekNumber();
        questions = await prisma.$queryRawUnsafe(
          `SELECT id, "order", text, type, emojis
             FROM "PulseQuestion"
            WHERE "surveyType" = 'weekly' AND week = $1 AND "isActive" = true
            ORDER BY "order" ASC`,
          activeWeek,
        );
      }
    }

    if (questions.length === 0) {
      return NextResponse.json({
        cycleKey, surveyType,
        participation: { responded: 0, totalActiveUsers: 0, percent: 0 },
        questions: [],
      });
    }

    // Per-question stats. One query that groups by questionId + score
    // for the distribution; comments fetched separately.
    const qids = questions.map((q) => Number(q.id));
    const distRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "questionId", "score", count(*)::int AS n
         FROM "PulseResponse"
        WHERE "weekKey" = $1 AND "questionId" = ANY($2::int[])
        GROUP BY "questionId", "score"`,
      cycleKey, qids,
    );

    // Distinct submitter count → participation %.
    const respondedRow = (await prisma.$queryRawUnsafe<any[]>(
      `SELECT count(DISTINCT "userId")::int AS n
         FROM "PulseResponse" WHERE "weekKey" = $1`,
      cycleKey,
    ))[0];
    const responded = respondedRow?.n ?? 0;

    let totalActiveUsers = 0;
    try {
      const t = await prisma.$queryRawUnsafe<any[]>(
        `SELECT count(*)::int AS n FROM "User"
          WHERE "isActive" = true AND email IS NOT NULL AND email <> ''
            AND COALESCE("isDeveloper", false) = false`,
      );
      totalActiveUsers = t[0]?.n ?? 0;
    } catch {
      const t = await prisma.$queryRawUnsafe<any[]>(
        `SELECT count(*)::int AS n FROM "User"
          WHERE "isActive" = true AND email IS NOT NULL AND email <> ''`,
      );
      totalActiveUsers = t[0]?.n ?? 0;
    }
    const percent = totalActiveUsers > 0 ? Math.round((responded / totalActiveUsers) * 100) : 0;

    // Anonymous text comments — fetched WITHOUT userId, ordered by
    // submitted-at so HR sees recent feedback first.
    const commentRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "questionId", "comment"
         FROM "PulseResponse"
        WHERE "weekKey" = $1 AND "questionId" = ANY($2::int[])
          AND "comment" IS NOT NULL AND "comment" <> ''
        ORDER BY "submittedAt" DESC`,
      cycleKey, qids,
    );

    // Roll up per-question.
    const out = questions.map((q) => {
      const id = Number(q.id);
      const rows = distRows.filter((r) => Number(r.questionId) === id);
      const dist: Record<string, number> = {};
      let count = 0, sum = 0;
      for (const r of rows) {
        if (r.score == null) continue;
        const s = Number(r.score);
        const n = Number(r.n);
        dist[String(s)] = (dist[String(s)] ?? 0) + n;
        count += n;
        sum   += s * n;
      }
      // For text questions, count from comments only.
      if (q.type === "text") {
        count = commentRows.filter((c) => Number(c.questionId) === id).length;
      }
      const average = q.type === "text" || count === 0 ? null : Number((sum / count).toFixed(2));

      // eNPS formula for type=enps. Promoters 9-10, Passives 7-8,
      // Detractors 0-6. Score = % promoters - % detractors.
      let enpsScore: number | null = null;
      if (q.type === "enps" && count > 0) {
        let promoters = 0, detractors = 0;
        for (let s = 0; s <= 10; s++) {
          const n = dist[String(s)] ?? 0;
          if (s <= 6) detractors += n;
          else if (s >= 9) promoters += n;
        }
        enpsScore = Math.round(((promoters - detractors) / count) * 100);
      }

      const comments = commentRows
        .filter((c) => Number(c.questionId) === id)
        .map((c) => String(c.comment))
        .slice(0, 200); // hard cap to avoid huge payloads

      return {
        id, order: q.order, text: q.text, type: q.type, emojis: q.emojis,
        stats: {
          count,
          average,
          distribution: q.type === "text" ? null : dist,
          enpsScore,
        },
        comments,
      };
    });

    return NextResponse.json({
      cycleKey,
      surveyType,
      participation: { responded, totalActiveUsers, percent },
      questions: out,
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/pulse/responses");
  }
}
