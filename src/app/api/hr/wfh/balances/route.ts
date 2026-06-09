// GET /api/hr/wfh/balances?monthKey=2026-M06&brand=NB%20Media&q=arpit
//
// HR-admin view of every active employee's WFH balance for the
// chosen month. Returns an array suitable for the WFH Balances
// admin panel.
//
// Query params (all optional):
//   monthKey  — defaults to current month ("2026-M06")
//   brand     — "NB Media" | "YT Labs" filter (default: all)
//   q         — substring match on employee name / email
//
// Response shape:
// {
//   monthKey, totals: { credited, used, remaining, employees },
//   rows: [{ userId, name, email, department, businessUnit,
//            credited, used, remaining, hasRow }]
// }

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { getWfhPolicy, quotaForBrand } from "@/lib/hr/wfh-balance";
import { getMonthKey } from "@/lib/hr/pulse-week";
import { getBrandScope } from "@/lib/hr/brand-scope";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const monthKey = url.searchParams.get("monthKey") || getMonthKey();
    const requestedBrand = url.searchParams.get("brand");
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();

    // Hard brand scope — a YT Labs HR Manager only ever sees YT
    // Labs employees, etc. Developers + allowlisted users
    // (CROSS_BRAND_HR_USER_IDS) can switch freely via the
    // requested brand parameter.
    const scope = getBrandScope(session!.user);
    const effectiveBrand = scope.allBrands
      ? (requestedBrand === "NB Media" || requestedBrand === "YT Labs" ? requestedBrand : null)
      : scope.brand;

    const policy = await getWfhPolicy();

    // Active employees with their brand. LEFT JOIN to WfhBalance
    // for this month — employees with no row yet get treated as
    // "would be credited" by the policy (handles new joiners).
    type Row = {
      id: number; name: string; email: string;
      department: string | null; businessUnit: string | null;
      credited: number | null; used: number | null;
    };
    let rows: Row[];
    try {
      rows = await prisma.$queryRawUnsafe<Row[]>(
        `SELECT u.id, u.name, u.email,
                ep.department,
                ep."businessUnit",
                wb.credited, wb.used
           FROM "User" u
           LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
           LEFT JOIN "WfhBalance" wb ON wb."userId" = u.id AND wb."monthKey" = $1
          WHERE u."isActive" = true
            AND COALESCE(u."isDeveloper", false) = false
          ORDER BY ep."businessUnit" NULLS LAST, u.name ASC`,
        monthKey,
      );
    } catch (e: any) {
      const code = e?.meta?.code || e?.code;
      if (code === "42703" || /isDeveloper/.test(String(e?.message ?? ""))) {
        rows = await prisma.$queryRawUnsafe<Row[]>(
          `SELECT u.id, u.name, u.email,
                  ep.department, ep."businessUnit",
                  wb.credited, wb.used
             FROM "User" u
             LEFT JOIN "EmployeeProfile" ep ON ep."userId" = u.id
             LEFT JOIN "WfhBalance" wb ON wb."userId" = u.id AND wb."monthKey" = $1
            WHERE u."isActive" = true
            ORDER BY ep."businessUnit" NULLS LAST, u.name ASC`,
          monthKey,
        );
      } else { throw e; }
    }

    // Brand filter (server-side enforced, not just for UI).
    if (effectiveBrand) {
      rows = rows.filter((r) => r.businessUnit === effectiveBrand);
    }
    // Name / email substring search.
    let filtered = rows;
    if (q) {
      filtered = rows.filter((r) =>
        (r.name || "").toLowerCase().includes(q) ||
        (r.email || "").toLowerCase().includes(q),
      );
    }

    // Project into the response shape — synthesize credited/used
    // from the policy for employees with no row yet.
    const out = filtered.map((r) => {
      const expected = quotaForBrand(policy, r.businessUnit);
      const credited = r.credited ?? expected;
      const used     = r.used ?? 0;
      return {
        userId: r.id,
        name: r.name,
        email: r.email,
        department: r.department,
        businessUnit: r.businessUnit,
        credited,
        used,
        remaining: Math.max(0, credited - used),
        hasRow: r.credited != null,    // false = synthetic (no DB row yet)
      };
    });

    // Roll-up totals for the panel header.
    const totals = out.reduce(
      (acc, r) => {
        acc.credited += r.credited;
        acc.used     += r.used;
        acc.remaining += r.remaining;
        acc.employees += 1;
        return acc;
      },
      { credited: 0, used: 0, remaining: 0, employees: 0 },
    );

    return NextResponse.json({
      monthKey,
      brand: effectiveBrand,
      limitEnabled: policy.limitEnabled,
      totals,
      rows: out,
    });
  } catch (e) {
    return serverError(e, "GET /api/hr/wfh/balances");
  }
}
