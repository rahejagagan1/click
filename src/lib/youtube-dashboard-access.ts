/**
 * Who may open /dashboard/youtube and read quarter metrics from the DB.
 * Now gated by the VIEW_YOUTUBE_DASHBOARD permission (designation-driven), with
 * a legacy "any authenticated user" fallback for objects/tokens that don't
 * carry a resolved permissions array. Sync/cron stays admin/developer.
 */
import { can, hasResolvedPermissions } from "./permissions/can";

export type YoutubeDashUserLike = {
    isDeveloper?: boolean;
    role?: string | null;
    orgLevel?: string | null;
    permissions?: string[] | null;
    email?: string | null;
};

export function userCanAccessYoutubeDashboard(user: YoutubeDashUserLike | null | undefined): boolean {
    if (!user) return false;
    if (hasResolvedPermissions(user)) return can(user, "VIEW_YOUTUBE_DASHBOARD");
    return true; // legacy: any authenticated user (bare object without permissions)
}

/** JWT / middleware — tokens don't carry permissions, so this stays
 *  authentication-only; the session-based checks above do the real gating. */
export function tokenCanAccessYoutubeDashboard(token: { email?: string | null } | null): boolean {
    return token != null;
}

export function userCanAccessYoutubeDeveloperAnalytics(user: YoutubeDashUserLike | null | undefined): boolean {
    return user?.isDeveloper === true;
}
