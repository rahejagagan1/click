/**
 * Who may open /dashboard/youtube and read quarter metrics from the DB.
 * Sync/cron remains developer/admin; this is read-only dashboard access.
 */
export type YoutubeDashUserLike = {
    isDeveloper?: boolean;
    role?: string | null;
    orgLevel?: string | null;
};

export function userCanAccessYoutubeDashboard(user: YoutubeDashUserLike | null | undefined): boolean {
    if (!user) return false;
    if (user.isDeveloper === true) return true;
    if (user.role === "production_manager") return true;
    if (user.orgLevel === "ceo" || user.orgLevel === "special_access") return true;
    return false;
}

/** JWT / middleware token shape from next-auth */
export function tokenCanAccessYoutubeDashboard(token: {
    isDeveloper?: boolean;
    role?: string;
    orgLevel?: string;
} | null): boolean {
    if (!token) return false;
    return userCanAccessYoutubeDashboard({
        isDeveloper: token.isDeveloper === true,
        role: token.role,
        orgLevel: token.orgLevel,
    });
}

export function userCanAccessYoutubeDeveloperAnalytics(user: YoutubeDashUserLike | null | undefined): boolean {
    return user?.isDeveloper === true;
}
