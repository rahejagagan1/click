/**
 * Who may open /dashboard/youtube and read quarter metrics from the DB.
 *
 * The YouTube dashboard is NB Media-only content. Brand membership is
 * the primary gate — anyone whose `businessUnit` is "YT Labs" is
 * excluded, including the YT Labs CEO (Kunal). Developers in NB Media
 * (or with no brand set) keep access since they're cross-brand infra.
 * Sync/cron stays admin/developer.
 */
export type YoutubeDashUserLike = {
    isDeveloper?: boolean;
    role?: string | null;
    orgLevel?: string | null;
    businessUnit?: string | null;
};

export function userCanAccessYoutubeDashboard(user: YoutubeDashUserLike | null | undefined): boolean {
    if (user == null) return false;
    // YT Labs is gated out unconditionally — including the YT Labs
    // CEO and any developer tagged onto that brand. The brand check
    // runs FIRST so an orgLevel='ceo' / isDeveloper bypass can't
    // accidentally re-grant access.
    if (user.businessUnit === "YT Labs") return false;
    // Everyone else (NB Media, legacy null-brand, founders, devs)
    // can use the read-only dashboard.
    return true;
}

/** JWT / middleware — same rule as session user (must be authenticated). */
export function tokenCanAccessYoutubeDashboard(token: { email?: string | null } | null): boolean {
    return token != null;
}

export function userCanAccessYoutubeDeveloperAnalytics(user: YoutubeDashUserLike | null | undefined): boolean {
    return user?.isDeveloper === true;
}
