import prisma from "@/lib/prisma";
import { TAB_CATALOG, TabKey, defaultTabPermissions } from "./tabs";

/**
 * Always-on override. These roles/flags are NEVER blocked by tab
 * permissions — the UI still shows their toggles but they render as
 * "Protected" and can't be unchecked, so an admin can't accidentally
 * lock out the CEO or a developer.
 */
export function hasProtectedRole(user: {
  orgLevel?: string | null;
  role?: string | null;
  isDeveloper?: boolean | null;
}): boolean {
  if (user.isDeveloper === true) return true;
  if (user.orgLevel === "ceo") return true;
  if (user.orgLevel === "special_access") return true;
  return false;
}

// ─── Internal: raw-SQL helpers so callers work before `prisma generate` ──
async function rawGetRows(userId: number): Promise<{ tabKey: string; enabled: boolean }[]> {
  try {
    return await prisma.$queryRawUnsafe<{ tabKey: string; enabled: boolean }[]>(
      `SELECT "tabKey", "enabled" FROM "UserTabPermission" WHERE "userId" = $1`,
      userId
    );
  } catch {
    return []; // Table missing (pre-migrate) → treat as no rows.
  }
}
async function rawCount(userId: number): Promise<number> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ c: string | number | bigint }[]>(
      `SELECT COUNT(*)::int AS c FROM "UserTabPermission" WHERE "userId" = $1`,
      userId
    );
    return Number(rows?.[0]?.c ?? 0);
  } catch {
    return 0;
  }
}
async function rawUpsert(userId: number, tabKey: string, enabled: boolean, updatedBy: number | null): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "UserTabPermission" ("userId","tabKey","enabled","createdAt","updatedAt","updatedBy")
     VALUES ($1,$2,$3,NOW(),NOW(),$4)
     ON CONFLICT ("userId","tabKey")
     DO UPDATE SET "enabled"=EXCLUDED."enabled","updatedAt"=NOW(),"updatedBy"=EXCLUDED."updatedBy"`,
    userId, tabKey, enabled, updatedBy
  );
}

/**
 * Resolve a single user's full tab permission map. Fills in role-aware
 * defaults for any tab the user has no explicit row for.
 *
 * Developers (via DEVELOPER_EMAILS env) always see every tab — this is
 * a non-negotiable power-user override so devs can debug any screen.
 * CEOs and special_access users use their role-aware defaults, which
 * still grant the right tabs per the sidebar's access logic. All three
 * are "protected" — the UI won't let an admin flip their toggles.
 */
export async function tabPermissionsForUser(userId: number): Promise<Record<TabKey, boolean>> {
  const [user, rows] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { orgLevel: true, role: true, email: true },
    }),
    rawGetRows(userId),
  ]);

  const devEmails = (process.env.DEVELOPER_EMAILS || "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const isDeveloper = !!user?.email && devEmails.includes(user.email.toLowerCase());

  // Role-aware defaults — a brand-new Manager gets Scores + Reports on
  // by default, a new Member only gets the 4 basic tabs, etc.
  const out = defaultTabPermissions(user?.orgLevel);

  // Developers override everything — they always see every tab.
  if (isDeveloper) {
    for (const t of TAB_CATALOG) out[t.key] = true;
    return out;
  }

  // Everyone else: apply explicit per-user overrides from the DB.
  for (const r of rows) {
    if (r.tabKey in out) out[r.tabKey as TabKey] = r.enabled;
  }
  return out;
}

export async function canAccessTab(
  userId: number,
  tabKey: TabKey | null,
  tokenHints: { orgLevel?: string | null; isDeveloper?: boolean | null }
): Promise<boolean> {
  if (tabKey === null) return true;
  if (hasProtectedRole(tokenHints)) return true;
  const rows = await rawGetRows(userId);
  const r = rows.find((x) => x.tabKey === tabKey);
  if (r) return r.enabled;
  return defaultTabPermissions(tokenHints.orgLevel)[tabKey];
}

/**
 * Seed default permissions for a newly-onboarded user so the "NEW"
 * badge disappears. Defaults are role-aware — a new Manager gets the
 * Manager defaults, a new Member gets the basic 4. No-op if any rows
 * already exist.
 */
export async function seedDefaultPermissionsIfMissing(
  userId: number,
  actorId: number | null
): Promise<{ seeded: boolean }> {
  const existing = await rawCount(userId);
  if (existing > 0) return { seeded: false };
  // Look up the user's orgLevel so we seed role-appropriate defaults.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { orgLevel: true },
  });
  const defaults = defaultTabPermissions(user?.orgLevel);
  await Promise.all(
    TAB_CATALOG.map((t) => rawUpsert(userId, t.key, defaults[t.key], actorId))
  );
  return { seeded: true };
}

/** True when the user has zero explicit permission rows — "NEW" badge. */
export async function isUserNew(userId: number): Promise<boolean> {
  return (await rawCount(userId)) === 0;
}

/**
 * Bulk upsert: writes every key→enabled pair from the `perms` map.
 * Used by the PUT endpoint.
 */
export async function savePermissions(
  userId: number,
  perms: Record<string, boolean>,
  updatedBy: number | null
): Promise<void> {
  const valid = new Set<string>(TAB_CATALOG.map((t) => t.key));
  await Promise.all(
    Object.entries(perms)
      .filter(([k]) => valid.has(k))
      .map(([k, v]) => rawUpsert(userId, k, !!v, updatedBy))
  );
}
