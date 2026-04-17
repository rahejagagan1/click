/**
 * Who may use manager reports (hub + weekly/monthly), and which template they get.
 * Prefer `User.role` + `User.orgLevel`; name checks are legacy fallback until DB roles are set.
 */

export type ManagerReportFormat = "production" | "researcher" | "qa" | "hr";

export type ManagerReportIdentity = {
    role?: string | null;
    orgLevel?: string | null;
    name?: string | null;
    reportAccess?: boolean | null;
};

const PRODUCTION_MANAGER_NAME_PARTS = ["bhoomika", "manpreet", "tanya", "sreyasi"] as const;

function nameMatchesProductionManagerStyle(name: string): boolean {
    return PRODUCTION_MANAGER_NAME_PARTS.some((part) => name.includes(part));
}

/** True if this user should see the manager reports hub and own weekly/monthly flows. */
export function isManagerReportEligible(u: ManagerReportIdentity): boolean {
    if (u.reportAccess === true) return true;
    const role = String(u.role ?? "").toLowerCase();
    const org = String(u.orgLevel ?? "").toLowerCase();
    if (["hod", "manager", "hr_manager"].includes(org)) return true;
    if (["production_manager", "researcher_manager", "hr_manager"].includes(role)) return true;
    if (role === "qa" && ["manager", "hod"].includes(org)) return true;
    return false;
}

/**
 * Weekly + monthly UI branch (production vs researcher manager vs QA vs HR).
 */
export function getManagerReportFormat(u: ManagerReportIdentity): ManagerReportFormat {
    const role = String(u.role ?? "").toLowerCase();
    const org = String(u.orgLevel ?? "").toLowerCase();
    const name = String(u.name ?? "").toLowerCase();

    if (role === "hr_manager" || org === "hr_manager") return "hr";
    if (role === "researcher_manager") return "researcher";
    if (role === "production_manager") return "production";
    if (role === "qa" && ["manager", "hod", "special_access"].includes(org)) return "qa";

    if (name.includes("tanvi")) return "hr";
    if (name.includes("nishant")) return "researcher";
    if (nameMatchesProductionManagerStyle(name)) return "production";
    if (name.includes("andrew")) return "qa";

    return "production";
}

/** Subtitle on report hub cards for weekly. */
export function weeklyReportCardSubtitle(format: ManagerReportFormat): string {
    switch (format) {
        case "researcher":
            return "Researchers";
        case "qa":
            return "QA Review";
        case "hr":
            return "HR";
        default:
            return "Writers & editors";
    }
}
