/** Who may open the anonymous feedback inbox (UI + GET /api/feedback). */
export function canViewFeedbackInbox(
    user: { orgLevel?: string; role?: string; isDeveloper?: boolean } | null | undefined
): boolean {
    if (!user) return false;
    if (user.isDeveloper) return true;
    if (user.orgLevel === "ceo") return true;
    if (user.orgLevel === "special_access") return true;
    return user.orgLevel === "hr_manager" || user.role === "hr_manager";
}
