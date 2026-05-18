// Helpers around the per-report team snapshot.
//
// Why this exists: User.managerId is mutable — it only stores the CURRENT
// reporting line. So if Suraj is under Manager A in March and moves to B
// in April, opening Manager A's March report later naively queries
// `User.findMany({ where: { managerId: A } })` and Suraj disappears from
// the March report even though he was on the team when it was written.
//
// Fix: on report submit/lock we freeze the team into a JSON column
// (`teamSnapshot`) on the report row. All read paths route through
// `resolveReportTeam` which returns the snapshot when present (locked
// reports = frozen) and falls back to the live `User.managerId` join
// when not (drafts, or legacy reports that pre-date this column).
//
// We use raw SQL for the snapshot column because the typed Prisma client
// can't currently regenerate (a pre-existing LeavePolicy back-relation
// validation error blocks `prisma generate`). Same pattern this codebase
// already uses for other new columns (see src/app/api/hr/people/[id]/route.ts).

import prisma from "@/lib/prisma";

export type TeamMember = {
  id: number;
  name: string;
  role: string;
  orgLevel: string | null;
  profilePictureUrl: string | null;
};

export type ReportPeriod =
  | { kind: "monthly"; month: number; year: number }
  | { kind: "weekly"; week: number; month: number; year: number };

/**
 * Fetch the team for a given manager + period, preferring the locked
 * snapshot when one exists. Falls back to the live team membership
 * query (active users with managerId === manager) when no snapshot is
 * stored — that's the right behavior for drafts and for legacy reports
 * submitted before this column was added.
 */
export async function resolveReportTeam(
  managerId: number,
  period: ReportPeriod,
): Promise<TeamMember[]> {
  const { team } = await resolveReportTeamWithSource(managerId, period);
  return team;
}

/**
 * Same as resolveReportTeam but also returns where the team came from:
 *   - "snapshot" → frozen at submit/lock time (historical truth)
 *   - "live"     → live User.managerId query (no snapshot exists yet)
 *
 * The UI uses this to render a "Frozen team" vs "Live team" badge on
 * the report header so viewers know whether what they're looking at
 * was captured at submission or is recomputed every page load.
 */
export async function resolveReportTeamWithSource(
  managerId: number,
  period: ReportPeriod,
): Promise<{ team: TeamMember[]; source: "snapshot" | "live" }> {
  const snapshot = await readSnapshot(managerId, period);
  if (snapshot) return { team: snapshot, source: "snapshot" };
  return { team: await liveTeam(managerId), source: "live" };
}

/**
 * Pure live-team query, exposed for callers that explicitly need the
 * "team right now" view (e.g. the draft form, the "Refresh snapshot"
 * action). Always reads User.managerId.
 */
export async function liveTeam(managerId: number): Promise<TeamMember[]> {
  const rows = await prisma.user.findMany({
    where: { managerId, isActive: true },
    select: {
      id: true,
      name: true,
      role: true,
      orgLevel: true,
      profilePictureUrl: true,
    },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: String(r.role),
    orgLevel: r.orgLevel ?? null,
    profilePictureUrl: r.profilePictureUrl ?? null,
  }));
}

/**
 * Snapshot the *current* team into the report row. Idempotent —
 * overwrites whatever's there. Call this:
 *  - From report PUT endpoints, when the save transitions the row to
 *    locked (or on every save of a locked row).
 *  - From the admin "Refresh team snapshot" action.
 */
export async function writeSnapshot(
  managerId: number,
  period: ReportPeriod,
  team?: TeamMember[],
): Promise<TeamMember[]> {
  const roster = team ?? (await liveTeam(managerId));
  const json = JSON.stringify(roster);

  if (period.kind === "monthly") {
    await prisma.$executeRawUnsafe(
      `UPDATE "MonthlyReport"
          SET "teamSnapshot" = $1::jsonb
        WHERE "managerId" = $2 AND "month" = $3 AND "year" = $4`,
      json, managerId, period.month, period.year,
    );
  } else {
    await prisma.$executeRawUnsafe(
      `UPDATE "WeeklyReport"
          SET "teamSnapshot" = $1::jsonb
        WHERE "managerId" = $2 AND "week" = $3 AND "month" = $4 AND "year" = $5`,
      json, managerId, period.week, period.month, period.year,
    );
  }
  return roster;
}

async function readSnapshot(
  managerId: number,
  period: ReportPeriod,
): Promise<TeamMember[] | null> {
  try {
    let rows: Array<{ teamSnapshot: unknown }>;
    if (period.kind === "monthly") {
      rows = await prisma.$queryRawUnsafe<Array<{ teamSnapshot: unknown }>>(
        `SELECT "teamSnapshot"
           FROM "MonthlyReport"
          WHERE "managerId" = $1 AND "month" = $2 AND "year" = $3
          LIMIT 1`,
        managerId, period.month, period.year,
      );
    } else {
      rows = await prisma.$queryRawUnsafe<Array<{ teamSnapshot: unknown }>>(
        `SELECT "teamSnapshot"
           FROM "WeeklyReport"
          WHERE "managerId" = $1 AND "week" = $2 AND "month" = $3 AND "year" = $4
          LIMIT 1`,
        managerId, period.week, period.month, period.year,
      );
    }
    const raw = rows[0]?.teamSnapshot;
    if (!raw) return null;
    // Postgres jsonb returns as a parsed JS value already. Be defensive
    // in case the underlying driver hands back a string.
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((u: any) => u && typeof u.id === "number" && typeof u.name === "string")
      .map((u: any) => ({
        id: u.id,
        name: u.name,
        role: String(u.role ?? "member"),
        orgLevel: u.orgLevel ?? null,
        profilePictureUrl: u.profilePictureUrl ?? null,
      }));
  } catch (e) {
    // Column missing (pre-migrate) — treat as "no snapshot, fall back to live".
    console.warn(`[team-snapshot] read failed for managerId=${managerId}:`, e);
    return null;
  }
}
