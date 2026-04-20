/**
 * Who may open /dashboard/youtube and read quarter metrics from the DB.
 * Any signed-in user may use the read-only dashboard. Sync/cron stays admin/developer.
 */
export type YoutubeDashUserLike = {
    isDeveloper?: boolean;
    role?: string | null;
    orgLevel?: string | null;
};

export function userCanAccessYoutubeDashboard(user: YoutubeDashUserLike | null | undefined): boolean {
    return user != null;
}

/** JWT / middleware — same rule as session user (must be authenticated). */
export function tokenCanAccessYoutubeDashboard(token: { email?: string | null } | null): boolean {
    return token != null;
}

export function userCanAccessYoutubeDeveloperAnalytics(user: YoutubeDashUserLike | null | undefined): boolean {
    return user?.isDeveloper === true;
}
