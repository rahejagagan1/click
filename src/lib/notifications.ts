import prisma from "@/lib/prisma";

export type NotificationType =
  | "regularization"
  | "wfh"
  | "on_duty"
  | "leave"
  | "comp_off";

/**
 * Resolve the set of users who should be notified when `actorId` submits a
 * request that needs approval: their direct manager + every active CEO / HR
 * manager / developer / admin. The actor themselves is excluded so
 * self-approvers don't ping their own inbox.
 */
export async function approverIdsForUser(actorId: number): Promise<number[]> {
  // Developers aren't a DB flag — they're resolved at session time from the
  // DEVELOPER_EMAILS env var. Match those emails here so devs get the same
  // approver notifications as CEOs / HR managers.
  const devEmails = (process.env.DEVELOPER_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const [actor, admins] = await Promise.all([
    prisma.user.findUnique({ where: { id: actorId }, select: { managerId: true } }),
    prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { orgLevel: { in: ["ceo", "hr_manager"] } },
          { role: "admin" },
          ...(devEmails.length > 0 ? [{ email: { in: devEmails } }] : []),
        ],
      },
      select: { id: true },
    }),
  ]);
  const ids = new Set<number>(admins.map((u) => u.id));
  if (actor?.managerId) ids.add(actor.managerId);
  ids.delete(actorId);
  return Array.from(ids);
}

/**
 * Low-level: write notifications for an explicit set of recipient ids. Dedupes
 * and excludes the actor themselves. Pass `actorId: null` (or omit it) to
 * create a system / self-confirmation notification that isn't filtered out of
 * its own recipient list. Swallows failures.
 */
export async function notifyUsers(params: {
  actorId?: number | null;
  userIds:  number[];
  type:     NotificationType;
  title:    string;
  body?:    string;
  entityId?: number;
  linkUrl?:  string;
}): Promise<void> {
  try {
    const actor = params.actorId ?? null;
    const ids = Array.from(new Set(params.userIds))
      .filter((id) => actor == null || id !== actor);
    if (ids.length === 0) return;
    await prisma.notification.createMany({
      data: ids.map((userId) => ({
        userId,
        actorId:  params.actorId,
        type:     params.type,
        title:    params.title,
        body:     params.body,
        entityId: params.entityId,
        linkUrl:  params.linkUrl,
      })),
    });
  } catch (e) {
    console.error("notifyUsers failed:", e);
  }
}

/**
 * Create notification rows for every approver of `actorId`. Safe to call from
 * a POST handler — failures are swallowed and logged so a notification outage
 * never blocks the underlying request from being created.
 */
export async function notifyApprovers(params: {
  actorId: number;
  type: NotificationType;
  title: string;
  body?: string;
  entityId?: number;
  linkUrl?: string;
  /** Additional users to notify (e.g. names the requester picked in "Notify"). */
  extraUserIds?: number[];
}): Promise<void> {
  try {
    const approvers = await approverIdsForUser(params.actorId);
    const all = new Set<number>([...approvers, ...(params.extraUserIds ?? [])]);
    if (all.size === 0) return;
    await prisma.notification.createMany({
      data: Array.from(all).map((userId) => ({
        userId,
        actorId:  params.actorId,
        type:     params.type,
        title:    params.title,
        body:     params.body,
        entityId: params.entityId,
        linkUrl:  params.linkUrl,
      })),
    });
  } catch (e) {
    console.error("notifyApprovers failed:", e);
  }
}
