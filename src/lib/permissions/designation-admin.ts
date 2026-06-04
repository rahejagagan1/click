// Server helpers for the designation admin UI. Raw SQL so they work before the
// typed client knows the new models. Grant edits are authoritative: the posted
// permission set fully replaces the designation's grants.

import prisma from "@/lib/prisma";
import { ALL_PERMISSIONS, Permission } from "./catalog";

/** Who may open/use the Designation admin screen: the HR Manager + top admins.
 *  (Mirrors isFullHRAdmin in src/lib/access.ts so it works pre-gate-refactor.) */
export function canManageDesignations(session: unknown): boolean {
  const u = (session as { user?: Record<string, unknown> } | null)?.user;
  if (!u) return false;
  return (
    u.isDeveloper === true ||
    u.orgLevel === "ceo" ||
    u.orgLevel === "special_access" ||
    u.role === "admin" ||
    u.role === "hr_manager"
  );
}

/** Replace a designation's permission grants with exactly `permissionKeys`
 *  (filtered to real catalog keys). Records `grantedBy` for the audit trail. */
export async function syncGrants(
  designationId: number,
  permissionKeys: string[],
  actorId: number | null
): Promise<void> {
  const valid = [...new Set(permissionKeys.filter((k) => ALL_PERMISSIONS.includes(k as Permission)))];
  await prisma.$executeRawUnsafe(
    `DELETE FROM "DesignationPermission" WHERE "designationId" = $1`,
    designationId
  );
  for (const key of valid) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "DesignationPermission" ("designationId","permissionId","grantedBy","createdAt")
       SELECT $1, pm."id", $3, NOW() FROM "Permission" pm WHERE pm."key" = $2`,
      designationId, key, actorId
    );
  }
}

/** Slugify a label into a stable designation key. */
export function toDesignationKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
