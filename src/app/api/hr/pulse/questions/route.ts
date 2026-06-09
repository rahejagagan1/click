// Pulse & Surveys — question bank CRUD (Weekly Pulse + Monthly Survey).
//
// GET    /api/hr/pulse/questions?surveyType=weekly&week=N
//   → Weekly: filter by week (1-4). Omit week to return all 4 weeks
//     flattened. surveyType defaults to 'weekly' for back-compat.
// GET    /api/hr/pulse/questions?surveyType=monthly
//   → Monthly: single list of monthly questions in `order` ASC.
// POST   /api/hr/pulse/questions          → create.
// PATCH  /api/hr/pulse/questions/[id]     → edit (separate file).
// DELETE /api/hr/pulse/questions/[id]     → hard delete.
//
// Read is open to every authenticated employee (the answer page
// will fetch the active set). Write is HR-admin only.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

// `emoji` / `rating` are weekly-pulse staples. `likert` is the
// 5-point Strongly Disagree → Strongly Agree scale used by the
// Monthly Survey's engagement-driver questions. `enps` is the
// 0-10 Net Promoter slider that drives the eNPS metric. `text`
// is the free-text comment box shared by both.
const VALID_TYPES = new Set(["emoji", "rating", "likert", "enps", "text"]);
const VALID_SURVEY_TYPES = new Set(["weekly", "monthly"]);
const VALID_BRANDS = new Set(["NB Media", "YT Labs"]);
const DEFAULT_EMOJIS = ["😡", "😟", "😐", "🙂", "😄"];

// Normalise an incoming brand string. Accepts slugs + friendly
// names + the literal "both" / "shared" / "" → null (= both brands).
function normalizeBrand(raw: unknown): "NB Media" | "YT Labs" | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === "both" || s === "shared") return null;
  const lower = s.toLowerCase();
  if (lower === "nb_media" || lower === "nbmedia" || lower === "nb media") return "NB Media";
  if (lower === "yt_labs"  || lower === "ytlabs"  || lower === "yt labs")  return "YT Labs";
  return null;
}

export async function GET(req: NextRequest) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const url = new URL(req.url);
    const surveyTypeRaw = url.searchParams.get("surveyType") ?? "weekly";
    const surveyType = VALID_SURVEY_TYPES.has(surveyTypeRaw) ? surveyTypeRaw : "weekly";
    const week = Number(url.searchParams.get("week"));
    const hasWeek = surveyType === "weekly" && Number.isFinite(week) && week >= 1 && week <= 4;

    // Brand filter — null/empty/"both" returns shared questions only,
    // "NB Media" / "YT Labs" returns brand-specific + shared. Used by
    // the HR panel's brand tabs.
    const brandParam = url.searchParams.get("brand");
    const requestedBrand = normalizeBrand(brandParam);
    // If client passes ?brand=both or omits → show ONLY shared
    // questions (brand IS NULL). If they pass a specific brand →
    // show that brand + shared so the manager sees the full
    // "what this brand's employees will receive" set.
    const showBrandAware = !!requestedBrand;

    const brandClause = showBrandAware
      ? ` AND (brand IS NULL OR brand = $${hasWeek ? 3 : 2})`
      : ` AND brand IS NULL`;
    const params: any[] = [surveyType];
    if (hasWeek) params.push(week);
    if (showBrandAware) params.push(requestedBrand);

    const sql = hasWeek
      ? `SELECT id, week, "order", text, type, emojis, "isActive", "surveyType", brand,
                "createdAt", "updatedAt"
           FROM "PulseQuestion"
          WHERE "surveyType" = $1 AND week = $2 ${brandClause}
          ORDER BY "order" ASC, id ASC`
      : `SELECT id, week, "order", text, type, emojis, "isActive", "surveyType", brand,
                "createdAt", "updatedAt"
           FROM "PulseQuestion"
          WHERE "surveyType" = $1 ${brandClause}
          ORDER BY COALESCE(week, 0) ASC, "order" ASC, id ASC`;

    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...params);
    return NextResponse.json({ questions: rows, brandFilter: requestedBrand });
  } catch (e) {
    return serverError(e, "GET /api/hr/pulse/questions");
  }
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));

    const surveyType = String(body?.surveyType ?? "weekly").trim();
    if (!VALID_SURVEY_TYPES.has(surveyType)) {
      return NextResponse.json({ error: "surveyType must be weekly or monthly" }, { status: 400 });
    }

    // Weekly questions need a week (1-4). Monthly leaves it NULL.
    let week: number | null = null;
    if (surveyType === "weekly") {
      const w = Number(body?.week);
      if (!Number.isInteger(w) || w < 1 || w > 4) {
        return NextResponse.json({ error: "week must be 1, 2, 3, or 4 for weekly questions" }, { status: 400 });
      }
      week = w;
    }

    const text = String(body?.text ?? "").trim();
    if (!text || text.length > 400) {
      return NextResponse.json({ error: "text required (≤400 chars)" }, { status: 400 });
    }

    const type = String(body?.type ?? "emoji").trim();
    if (!VALID_TYPES.has(type)) {
      return NextResponse.json({ error: "type must be emoji | rating | likert | enps | text" }, { status: 400 });
    }

    // `emojis` array only meaningful for type=emoji.
    let emojis: string[] | null = null;
    if (type === "emoji") {
      emojis = Array.isArray(body?.emojis) && body.emojis.length === 5
        ? body.emojis.map((e: any) => String(e).slice(0, 8))
        : DEFAULT_EMOJIS;
    }

    // Brand assignment — defaults to NULL (= both brands) if omitted.
    const brand = normalizeBrand(body?.brand);

    // Next `order` = max within the same (surveyType, week, brand) bucket.
    const maxRow = (await prisma.$queryRawUnsafe<any[]>(
      week == null
        ? `SELECT COALESCE(MAX("order"), 0) AS m FROM "PulseQuestion"
             WHERE "surveyType" = $1 AND week IS NULL
               AND ${brand == null ? "brand IS NULL" : "brand = $2"}`
        : `SELECT COALESCE(MAX("order"), 0) AS m FROM "PulseQuestion"
             WHERE "surveyType" = $1 AND week = $2
               AND ${brand == null ? "brand IS NULL" : "brand = $3"}`,
      ...(week == null
        ? (brand == null ? [surveyType] : [surveyType, brand])
        : (brand == null ? [surveyType, week] : [surveyType, week, brand])),
    ))[0];
    const nextOrder = (maxRow?.m ?? 0) + 1;

    const inserted = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO "PulseQuestion" (week, "order", text, type, emojis, "isActive", "surveyType", brand)
       VALUES ($1, $2, $3, $4, $5::jsonb, true, $6, $7)
       RETURNING id, week, "order", text, type, emojis, "isActive", "surveyType", brand, "createdAt", "updatedAt"`,
      week, nextOrder, text, type, emojis ? JSON.stringify(emojis) : null, surveyType, brand,
    );
    return NextResponse.json({ question: inserted[0] }, { status: 201 });
  } catch (e) {
    return serverError(e, "POST /api/hr/pulse/questions");
  }
}
