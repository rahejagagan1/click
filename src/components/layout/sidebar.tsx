"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState, useEffect, useRef, useCallback, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { canViewFeedbackInbox } from "@/lib/feedback-inbox-access";
import { userCanAccessYoutubeDashboard } from "@/lib/youtube-dashboard-access";
import { Users, BarChart2, BarChart3, User, MessageCircle, Settings, Home, Building2, LayoutDashboard, FileText, Star, PlayCircle, CircleDollarSign, Wrench, Target } from "lucide-react";

// Consistent Keka-style icon: thin outline, fixed size / stroke.
const icon = (Cmp: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>) => (
    <Cmp size={18} strokeWidth={1.5} />
);
import useSWR from "swr";
import { fetcher } from "@/lib/swr";

interface Manager {
    id: number;
    name: string;
    orgLevel: string;
}

const NAV_ITEMS = [
    { label: "Dashboard", href: "/dashboard",         icon: icon(LayoutDashboard),                             developerOnly: true          },
    { label: "Cases",     href: "/cases",              icon: icon(FileText),       adminOnly: true                                           },
    { label: "Company",   href: "/dashboard/company",  icon: icon(Building2),      adminOnly: true                                           },
    { label: "Scores",    href: "/dashboard/scores",   icon: icon(Star),                                        managersOnly: true           },
    { label: "YouTube",   href: "/dashboard/youtube",  icon: icon(PlayCircle),     youtubeDashboardAccess: true                              },
    { label: "Feedback",  href: "/dashboard/feedback", icon: icon(MessageCircle)                                                             },
    { label: "Tools",     href: "/dashboard/tools",    icon: icon(Wrench)                                                                    },
    { label: "Admin",     href: "/admin",              icon: icon(Settings),       adminOnly: true                                           },
];

export default function Sidebar() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const currentTab = searchParams?.get("tab") || null;
    const router   = useRouter();
    const { data: session } = useSession();
    const user = session?.user as any;

    // `special_access` and `role === "admin"` both qualify as admin —
    // per the auth.ts session callback comment "Full visibility but NOT
    // CEO". Include both so they see Cases / Company / Admin / HR
    // Dashboard / Reports / Scores like ceo + developers do.
    const isAdmin =
      user?.orgLevel === "ceo" ||
      user?.isDeveloper === true ||
      user?.orgLevel === "special_access" ||
      user?.role === "admin";
    const isHRAdmin = isAdmin || user?.orgLevel === "hr_manager";
    // CEO-only items stay restricted to the actual CEO + developers — `Dashboard`
    // for instance is the org-wide CEO console, not appropriate for special_access.
    const isCeo = user?.orgLevel === "ceo" || user?.isDeveloper === true;
    const canSeeReports = isAdmin
        || user?.orgLevel === "manager"
        || user?.orgLevel === "hod"
        || user?.orgLevel === "hr_manager";
    const canSeeViolationLog = isAdmin || user?.orgLevel === "special_access" || user?.role === "hr_manager";
    const showFeedbackSubmenu = canViewFeedbackInbox(user);

    // Tab-permission overrides — the caller's personal map from
    // UserTabPermission, with protected roles getting `true` everywhere.
    // Missing keys default to `true` so a brand-new install (before any
    // permissions are written) doesn't break the sidebar.
    const { data: perms } = useSWR<{ permissions: Record<string, boolean> }>(
        "/api/hr/me/tab-permissions",
        fetcher,
        { revalidateOnFocus: false, dedupingInterval: 30_000 }
    );
    const tabAllowed = (key: string) => (perms?.permissions?.[key] ?? true);

    const visibleItems = NAV_ITEMS.filter((item) => {
        const label = (item as any).label as string;
        // Items that ARE in the Tab Permissions catalog let the per-user
        // permission win — that's what makes the Permissions UI actually
        // grant access. tabPermissionsForUser() already incorporates role
        // defaults, so a Member with no explicit row still gets `false`
        // for admin tabs; an admin granting `cases: true` to that Member
        // now actually unlocks Cases.
        const keyMap: Record<string, string> = {
            // "Dashboard" intentionally omitted — it is developer-only and
            // must NOT be unlockable via the per-user Tab Permissions UI.
            // "Admin" intentionally omitted — admin/CEO/dev only.
            "Cases": "cases", "Company": "company",
            "Scores": "scores", "YouTube": "youtube", "Feedback": "feedback",
            "Tools": "tools",
        };
        const k = keyMap[label];
        if (k) {
            // YouTube has a separate per-user channel-access check that's
            // distinct from Tab Permissions — keep it stacked on top.
            if ((item as any).youtubeDashboardAccess && !userCanAccessYoutubeDashboard(user)) return false;
            return tabAllowed(k);
        }

        // Items NOT in the catalog (Tools, Admin) — role gates decide,
        // since there's no per-user toggle to defer to.
        if ((item as any).ceoOnly && !isCeo) return false;
        if ((item as any).managersOnly && !canSeeReports) return false;
        if ((item as any).adminOnly && !isAdmin) return false;
        if ((item as any).developerOnly && user?.isDeveloper !== true) return false;
        return true;
    });

    // Report submenu state
    const [reportHovered, setReportHovered] = useState(false);
    const [managers, setManagers] = useState<Manager[]>([]);
    const [managersLoaded, setManagersLoaded] = useState(false);
    const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // HR sideways flyout state — portalled to body so overflow-y:auto can't clip them
    const isHRPath = pathname.startsWith("/dashboard/hr");
    const [hrMeOpen,   setHrMeOpen]   = useState(false);
    const [hrTeamOpen, setHrTeamOpen] = useState(false);
    const [hrMeY,      setHrMeY]      = useState(0);
    const [hrTeamY,    setHrTeamY]    = useState(0);
    const hrMeTrigger   = useRef<HTMLDivElement>(null);
    const hrTeamTrigger = useRef<HTMLDivElement>(null);
    const hrMeTimer     = useRef<NodeJS.Timeout | null>(null);
    const hrTeamTimer   = useRef<NodeJS.Timeout | null>(null);

    const makeHrHandlers = (
        setOpen: (v: boolean) => void,
        setY: (y: number) => void,
        triggerRef: MutableRefObject<HTMLDivElement | null>,
        timerRef: MutableRefObject<NodeJS.Timeout | null>
    ) => ({
        onMouseEnter: () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            if (triggerRef.current) setY(triggerRef.current.getBoundingClientRect().top);
            setOpen(true);
        },
        onMouseLeave: () => { timerRef.current = setTimeout(() => setOpen(false), 200); },
    });

    // Inbox badge count
    const { data: inboxData } = useSWR("/api/hr/inbox", fetcher, { refreshInterval: 30000 });

    // Approvals badge count — total pending across all types (leave / regularize /
    // wfh / on-duty / comp-off). Only fetched for users who can actually approve.
    const { data: approvalsSummary } = useSWR<{ byTab: Record<string, number>; total: number }>(
        isHRAdmin ? "/api/hr/approvals/summary" : null,
        fetcher,
        { refreshInterval: 30000 }
    );
    const approvalsCount = approvalsSummary?.total ?? 0;

    // My Finances — top-level pinned tile with its own flyout (Summary / My Pay / Manage Tax)
    const [financesOpen, setFinancesOpen] = useState(false);
    const [financesY, setFinancesY] = useState(0);
    const financesTrigger = useRef<HTMLDivElement>(null);
    const financesTimer   = useRef<NodeJS.Timeout | null>(null);

    // Nested sub-flyout for "My Pay" — reveals My Salary / Pay Slips / Income Tax
    // to the right of the main My Finances flyout.
    const [myPaySubOpen, setMyPaySubOpen] = useState(false);
    const [myPaySubY, setMyPaySubY] = useState(0);
    const myPayRowRef = useRef<HTMLDivElement>(null);
    const myPaySubTimer = useRef<NodeJS.Timeout | null>(null);

    // Dept submenu state (portalled, like the HR flyouts)
    const [deptHovered, setDeptHovered] = useState(false);
    const [deptY, setDeptY] = useState(0);
    const deptTriggerRef = useRef<HTMLDivElement | null>(null);
    const deptHoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Feedback submenu (CEO / Developer / HR) — also portalled
    const [feedbackHovered, setFeedbackHovered] = useState(false);
    const [feedbackY, setFeedbackY] = useState(0);
    const feedbackTriggerRef = useRef<HTMLDivElement | null>(null);
    const feedbackHoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Report submenu Y-pos for portal
    const [reportY, setReportY] = useState(0);
    const reportTriggerRef = useRef<HTMLDivElement | null>(null);

    // Helper: pick a flyout Y based on where the trigger sits in the viewport.
    //   Trigger in top third    → anchor top-of-flyout to top-of-trigger (drops down)
    //   Trigger in middle third → vertically centre flyout with trigger
    //   Trigger in bottom third → anchor bottom-of-flyout to bottom-of-trigger (grows up)
    // Then clamp into the viewport with a 16px safety margin.
    // We pick the position ONCE on hover-open and never again, so the cursor
    // never gets pulled away from the option the user is aiming at.
    const computeFlyoutY = useCallback((trigger: HTMLDivElement | null, estimatedHeight: number) => {
        if (!trigger || typeof window === "undefined") return 16;
        const rect = trigger.getBoundingClientRect();
        const vh = window.innerHeight;
        const margin = 16;
        const h = Math.min(estimatedHeight, vh - margin * 2);
        const triggerCenter = (rect.top + rect.bottom) / 2;
        let y: number;
        if (triggerCenter < vh / 3) {
            y = rect.top;                      // top — drop down from trigger
        } else if (triggerCenter > (vh * 2) / 3) {
            y = rect.bottom - h;               // bottom — grow up from trigger
        } else {
            y = triggerCenter - h / 2;         // middle — centre on trigger
        }
        return Math.max(margin, Math.min(y, vh - h - margin));
    }, []);

    const DEPARTMENTS = [
        { label: "HR Dept.", slug: "hr" },
        { label: "Researcher Dept.", slug: "researcher" },
        { label: "QA Dept.", slug: "qa" },
        { label: "Production Dept.", slug: "production" },
        { label: "AI Dept.", slug: "ai" },
        { label: "SocialMedia Dept.", slug: "socialmedia" },
        { label: "IT Dept.", slug: "it" },
    ];

    const handleDeptMouseEnter = () => {
        if (deptHoverTimeoutRef.current) clearTimeout(deptHoverTimeoutRef.current);
        // Skip Y recomputation when the menu is already open — otherwise the
        // panel jumps under the cursor as the user moves from trigger to flyout.
        if (!deptHovered) {
            const estHeight = 30 + DEPARTMENTS.length * 36 + 16;
            setDeptY(computeFlyoutY(deptTriggerRef.current, estHeight));
        }
        setDeptHovered(true);
    };

    const handleDeptMouseLeave = () => {
        deptHoverTimeoutRef.current = setTimeout(() => {
            setDeptHovered(false);
        }, 200);
    };

    useEffect(() => {
        if (reportHovered && !managersLoaded) {
            fetch("/api/managers")
                .then((res) => res.json())
                .then((data) => {
                    if (Array.isArray(data)) {
                        // Non-admin users only see their own report link
                        if (!isAdmin) {
                            setManagers(data.filter((m: Manager) => String(m.id) === String(user?.dbId)));
                        } else {
                            setManagers(data);
                        }
                    }
                    setManagersLoaded(true);
                })
                .catch(() => setManagersLoaded(true));
        }
    }, [reportHovered, managersLoaded]);

    const handleReportMouseEnter = () => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        // Only compute Y the first time the menu opens. While the menu is
        // already open and the user moves their cursor onto the flyout
        // panel, this same handler fires from the panel's onMouseEnter — we
        // must NOT recompute Y there or the menu jumps under the cursor.
        if (!reportHovered) {
            const rowCount = managersLoaded ? Math.max(managers.length, 1) : 8;
            const estHeight = 30 + rowCount * 36 + 16;
            setReportY(computeFlyoutY(reportTriggerRef.current, estHeight));
        }
        setReportHovered(true);
    };

    const handleReportMouseLeave = () => {
        hoverTimeoutRef.current = setTimeout(() => {
            setReportHovered(false);
        }, 200);
    };

    const handleFeedbackMouseEnter = () => {
        if (feedbackHoverTimeoutRef.current) clearTimeout(feedbackHoverTimeoutRef.current);
        if (feedbackTriggerRef.current) setFeedbackY(feedbackTriggerRef.current.getBoundingClientRect().top);
        setFeedbackHovered(true);
    };

    const handleFeedbackMouseLeave = () => {
        feedbackHoverTimeoutRef.current = setTimeout(() => {
            setFeedbackHovered(false);
        }, 200);
    };

    const isReportActive = pathname.startsWith("/dashboard/reports");
    const isFeedbackFormActive = pathname === "/dashboard/feedback";
    const isFeedbackInboxActive =
        pathname === "/dashboard/feedback_inbox" || pathname.startsWith("/dashboard/feedback_inbox/");
    const isFeedbackNavActive = isFeedbackFormActive || isFeedbackInboxActive;

    // Find the index where Report should be inserted (before Admin)
    const adminIndex = visibleItems.findIndex((item) => item.label === "Admin");
    const beforeAdmin = adminIndex >= 0 ? visibleItems.slice(0, adminIndex) : visibleItems;
    const afterAdmin = adminIndex >= 0 ? visibleItems.slice(adminIndex) : [];

    return (
        <>
        <aside className="fixed left-0 top-0 z-40 flex h-screen w-[92px] flex-col border-r border-[#dbe4ee] bg-[#f7f9fc] shadow-[6px_0_24px_rgba(15,23,42,0.05)]">
            {/* Logo */}
            <div className="border-b border-[#e4ebf2] px-2 py-3">
                <div className="flex flex-col items-center gap-2 text-center">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-md">
                        <Image
                            src="/logo.png"
                            alt="NB"
                            width={36}
                            height={36}
                            priority
                            className="object-contain"
                            sizes="36px"
                        />
                    </div>
                    <div>
                        <h1 className="text-[11px] font-bold leading-none text-[#243445]">NB Media</h1>
                        <p className="mt-1 text-[9px] leading-none text-[#7f91a4]">Dashboard</p>
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 space-y-1 overflow-y-auto p-2.5 scrollbar-thin">
                <p className="hidden text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-semibold mb-2 px-1 text-center">
                    Main Menu
                </p>

                {/* HR Home + Me — pinned to the top of the sidebar so they're always one click away. */}
                {(() => {
                    const meHandlers = makeHrHandlers(setHrMeOpen, setHrMeY, hrMeTrigger, hrMeTimer);
                    const isMeActive = isHRPath
                        && !pathname.startsWith("/dashboard/hr/my-team")
                        && !pathname.startsWith("/dashboard/hr/inbox")
                        && !pathname.startsWith("/dashboard/hr/people")
                        && !pathname.startsWith("/dashboard/hr/org")
                        && !pathname.startsWith("/dashboard/hr/engage")
                        && !pathname.startsWith("/dashboard/hr/home")
                        && !pathname.startsWith("/dashboard/hr/admin")
                        && !pathname.startsWith("/dashboard/hr/assets")
                        && pathname !== "/admin";
                    const homeActive = pathname === "/dashboard/hr/home" || pathname.startsWith("/dashboard/hr/home/");
                    const E = "text-[#6e8297] hover:bg-[#eef3f8] hover:text-[#213446]";
                    const A = "bg-gradient-to-br from-[#e8f1fc] to-[#d9e7f8] text-[#0f4e93] shadow-[inset_0_0_0_1px_rgba(15,110,205,0.18),0_2px_8px_rgba(15,110,205,0.08)]";
                    return (
                        <>
                            {tabAllowed("hr_home") && (
                                <Link href="/dashboard/hr/home"
                                    className={cn("flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]", homeActive ? A : E)}>
                                    <Home size={15} strokeWidth={1.75} className={homeActive ? "text-[#0f6ecd]" : ""} />
                                    Home
                                </Link>
                            )}
                            {tabAllowed("hr_me") && (
                                <div ref={hrMeTrigger} {...meHandlers}
                                    onDoubleClick={() => { setHrMeOpen(false); router.push("/dashboard/hr/attendance"); }}
                                    className={cn("flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px] cursor-pointer select-none", isMeActive || hrMeOpen ? A : E)}>
                                    <User size={15} strokeWidth={1.75} className={isMeActive || hrMeOpen ? "text-[#0f6ecd]" : ""} />
                                    Me
                                </div>
                            )}
                            {/* My Finances — pinned tile with a Summary / My Pay / Manage Tax flyout */}
                            {(() => {
                                const financesHandlers = makeHrHandlers(setFinancesOpen, setFinancesY, financesTrigger, financesTimer);
                                const financesActive = pathname.startsWith("/dashboard/hr/payroll");
                                return (
                                    <div ref={financesTrigger} {...financesHandlers}
                                        className={cn("flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px] cursor-pointer", financesActive || financesOpen ? A : E)}>
                                        <CircleDollarSign size={15} strokeWidth={1.75} className={financesActive || financesOpen ? "text-[#0f6ecd]" : ""} />
                                        My Finances
                                    </div>
                                );
                            })()}
                        </>
                    );
                })()}

                {/* Items before Admin */}
                {beforeAdmin.map((item) => {
                    if (item.label === "Feedback" && showFeedbackSubmenu) {
                        return (
                            <div
                                key={item.href}
                                ref={feedbackTriggerRef}
                                className="relative"
                                onMouseEnter={handleFeedbackMouseEnter}
                                onMouseLeave={handleFeedbackMouseLeave}
                            >
                                <div
                                    className={cn(
                                        "flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px] cursor-pointer",
                                        isFeedbackNavActive
                                            ? "bg-gradient-to-br from-[#e8f1fc] to-[#d9e7f8] text-[#0f4e93] shadow-[inset_0_0_0_1px_rgba(15,110,205,0.18),0_2px_8px_rgba(15,110,205,0.08)]"
                                            : "text-[#6e8297] hover:bg-[#eef3f8] hover:text-[#213446]"
                                    )}
                                >
                                    <span className="flex flex-col items-center gap-1">
                                        <span className={cn(isFeedbackNavActive ? "text-[#0f6ecd]" : "")}>
                                            {item.icon}
                                        </span>
                                        Feedback
                                    </span>
                                    <svg
                                        className={cn(
                                            "hidden",
                                            feedbackHovered ? "rotate-90" : ""
                                        )}
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                </div>

                                {feedbackHovered && typeof document !== "undefined" && createPortal(
                                    <div
                                        style={{ position: "fixed", left: 108, top: feedbackY, zIndex: 9999 }}
                                        className="w-56 rounded-xl border border-[#cfd8e3] bg-[#eef2f6] py-2 shadow-xl shadow-slate-300/30 animate-in fade-in slide-in-from-left-2 duration-200"
                                        onMouseEnter={handleFeedbackMouseEnter}
                                        onMouseLeave={handleFeedbackMouseLeave}
                                    >
                                        <Link
                                            href="/dashboard/feedback"
                                            className={cn(
                                                "flex items-center justify-between px-4 py-2 text-sm transition-all duration-150",
                                                isFeedbackFormActive
                                                    ? "bg-[#eef4fb] font-medium text-[#1f3b57]"
                                                    : "text-[#34495e] hover:bg-[#dde4ec] hover:text-[#1f3b57]"
                                            )}
                                        >
                                            <span className="truncate">NB Unplugged</span>
                                            <svg className="w-3.5 h-3.5 opacity-40 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                        </Link>
                                        <Link
                                            href="/dashboard/feedback_inbox"
                                            className={cn(
                                                "flex items-center justify-between px-4 py-2 text-sm transition-all duration-150",
                                                isFeedbackInboxActive
                                                    ? "bg-[#eef4fb] font-medium text-[#1f3b57]"
                                                    : "text-[#34495e] hover:bg-[#dde4ec] hover:text-[#1f3b57]"
                                            )}
                                        >
                                            <span className="truncate">NB Unplugged inbox</span>
                                            <svg className="w-3.5 h-3.5 opacity-40 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                        </Link>
                                    </div>,
                                    document.body
                                )}
                            </div>
                        );
                    }

                    const isActive =
                        pathname === item.href ||
                        (item.href !== "/dashboard" && pathname.startsWith(item.href));

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                "flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]",
                                isActive
                                    ? "bg-gradient-to-br from-[#e8f1fc] to-[#d9e7f8] text-[#0f4e93] shadow-[inset_0_0_0_1px_rgba(15,110,205,0.18),0_2px_8px_rgba(15,110,205,0.08)]"
                                    : "text-[#6e8297] hover:bg-[#eef3f8] hover:text-[#213446]"
                            )}
                        >
                            <span className={cn(isActive ? "text-[#0f6ecd]" : "")}>{item.icon}</span>
                            {item.label}
                        </Link>
                    );
                })}

                {/* Report — visible to CEO, developers, managers, HODs only */}
                {canSeeReports && tabAllowed("reports") && (!isAdmin ? (
                    <Link
                        href={`/dashboard/reports/${user?.dbId}`}
                        className={cn(
                            "flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]",
                            isReportActive
                                ? "bg-gradient-to-br from-[#e8f1fc] to-[#d9e7f8] text-[#0f4e93] shadow-[inset_0_0_0_1px_rgba(15,110,205,0.18),0_2px_8px_rgba(15,110,205,0.08)]"
                                : "text-[#6e8297] hover:bg-[#eef3f8] hover:text-[#213446]"
                        )}
                    >
                        <span className={cn(isReportActive ? "text-[#0f6ecd]" : "")}>
                            <BarChart3 size={18} strokeWidth={1.5} />
                        </span>
                        Report
                    </Link>
                ) : (
                    <div
                        ref={reportTriggerRef}
                        className="relative"
                        onMouseEnter={handleReportMouseEnter}
                        onMouseLeave={handleReportMouseLeave}
                    >
                        <div
                            className={cn(
                                "flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px] cursor-pointer",
                                isReportActive
                                    ? "bg-gradient-to-br from-[#e8f1fc] to-[#d9e7f8] text-[#0f4e93] shadow-[inset_0_0_0_1px_rgba(15,110,205,0.18),0_2px_8px_rgba(15,110,205,0.08)]"
                                    : "text-[#6e8297] hover:bg-[#eef3f8] hover:text-[#213446]"
                            )}
                        >
                            <span className="flex flex-col items-center gap-1">
                                <span className={cn(isReportActive ? "text-[#0f6ecd]" : "")}>
                                    <BarChart3 size={18} strokeWidth={1.5} />
                                </span>
                                Report
                            </span>
                            <svg
                                className={cn(
                                    "hidden",
                                    reportHovered ? "rotate-90" : ""
                                )}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </div>

                        {/* Flyout submenu — admins only, portalled to escape overflow clip */}
                        {reportHovered && typeof document !== "undefined" && createPortal(
                            <div
                                style={{ position: "fixed", left: 108, top: reportY, zIndex: 9999, maxHeight: `calc(100vh - ${reportY}px - 16px)` }}
                                className="w-52 overflow-y-auto rounded-xl border border-[#cfd8e3] bg-[#eef2f6] py-2 shadow-xl shadow-slate-300/30 scrollbar-thin animate-in fade-in slide-in-from-left-2 duration-200"
                                onMouseEnter={handleReportMouseEnter}
                                onMouseLeave={handleReportMouseLeave}
                            >
                                <p className="text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-medium mb-1 px-4 py-1">
                                    Manager Reports
                                </p>
                                {!managersLoaded ? (
                                    <div className="px-4 py-3">
                                        <div className="flex items-center gap-2 text-xs text-slate-500">
                                            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                            </svg>
                                            Loading...
                                        </div>
                                    </div>
                                ) : managers.length === 0 ? (
                                    <p className="text-xs text-slate-500 px-4 py-2">No managers found</p>
                                ) : (
                                    managers.map((manager) => (
                                        <Link
                                            key={manager.id}
                                            href={`/dashboard/reports/${manager.id}`}
                                            className={cn(
                                                "flex items-center justify-between px-4 py-2 text-sm transition-all duration-150",
                                                pathname === `/dashboard/reports/${manager.id}`
                                                    ? "bg-[#eef4fb] font-medium text-[#1f3b57]"
                                                    : "text-[#34495e] hover:bg-[#dde4ec] hover:text-[#1f3b57]"
                                            )}
                                        >
                                            <span className="truncate">{manager.name}</span>
                                            <svg className="w-3.5 h-3.5 opacity-40 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                        </Link>
                                    ))
                                )}
                            </div>,
                            document.body
                        )}
                    </div>
                ))}

                {/* KPIs — visible to all users (the page itself scopes the
                    visible employees by role: self / team / all-departments).
                    Tab-permission still gates show/hide. */}
                {tabAllowed("departments") && (() => {
                    const isKpiActive = pathname.startsWith("/dashboard/kpis");
                    return (
                        <Link
                            href="/dashboard/kpis"
                            className={cn(
                                "flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]",
                                isKpiActive
                                    ? "bg-gradient-to-br from-[#e8f1fc] to-[#d9e7f8] text-[#0f4e93] shadow-[inset_0_0_0_1px_rgba(15,110,205,0.18),0_2px_8px_rgba(15,110,205,0.08)]"
                                    : "text-[#6e8297] hover:bg-[#eef3f8] hover:text-[#213446]"
                            )}
                        >
                            <span className={cn(isKpiActive ? "text-[#0f6ecd]" : "")}>
                                <Target size={18} strokeWidth={1.5} />
                            </span>
                            KPIs
                        </Link>
                    );
                })()}

                {/* System Violation Log — HR, Special Access, CEO, Developer
                    AND tab-permission allows it. */}
                {canSeeViolationLog && tabAllowed("violations") && (() => {
                    const isActive = pathname.startsWith("/dashboard/violations");
                    return (
                        <Link
                            href="/dashboard/violations"
                            className={cn(
                                "flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]",
                                isActive
                                    ? "bg-gradient-to-br from-[#e8f1fc] to-[#d9e7f8] text-[#0f4e93] shadow-[inset_0_0_0_1px_rgba(15,110,205,0.18),0_2px_8px_rgba(15,110,205,0.08)]"
                                    : "text-[#6e8297] hover:bg-[#eef3f8] hover:text-[#213446]"
                            )}
                        >
                            <span className={cn(isActive ? "text-[#0f6ecd]" : "")}>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </span>
                            Violation Log
                        </Link>
                    );
                })()}

                {/* ── HR & People Section ── */}
                {(() => {
                    const inboxCount = (inboxData?.total || 0) as number;
                    const E = "text-[#6e8297] hover:bg-[#eef3f8] hover:text-[#213446]";
                    const A = "bg-gradient-to-br from-[#e8f1fc] to-[#d9e7f8] text-[#0f4e93] shadow-[inset_0_0_0_1px_rgba(15,110,205,0.18),0_2px_8px_rgba(15,110,205,0.08)]";

                    const meHandlers   = makeHrHandlers(setHrMeOpen,   setHrMeY,   hrMeTrigger,   hrMeTimer);
                    const teamHandlers = makeHrHandlers(setHrTeamOpen, setHrTeamY, hrTeamTrigger, hrTeamTimer);

                    const isMeActive    = isHRPath && !pathname.startsWith("/dashboard/hr/my-team") && !pathname.startsWith("/dashboard/hr/inbox") && !pathname.startsWith("/dashboard/hr/people") && !pathname.startsWith("/dashboard/hr/org") && !pathname.startsWith("/dashboard/hr/engage") && !pathname.startsWith("/dashboard/hr/home") && !pathname.startsWith("/dashboard/hr/admin") && !pathname.startsWith("/dashboard/hr/assets") && pathname !== "/admin";
                    const isTeamActive  = pathname.startsWith("/dashboard/hr/my-team") || pathname.startsWith("/dashboard/hr/inbox");
                    const isAdminActive = pathname.startsWith("/dashboard/hr/admin") || pathname.startsWith("/dashboard/hr/assets");

                    // Flyout link
                    const fl = (href: string, label: string, badge?: ReactNode) => {
                        const active = pathname === href || pathname.startsWith(href + "/");
                        return (
                            <Link key={href} href={href}
                                className={cn(
                                    "flex items-center justify-between px-4 py-2 text-[13px] transition-all duration-150",
                                    active
                                        ? "bg-[#eef4fb] font-semibold text-[#1f3b57]"
                                        : "text-[#34495e] hover:bg-[#dde4ec] hover:text-[#1f2f3f]"
                                )}>
                                <span className="truncate">{label}</span>
                                {badge ?? (
                                    <svg className="w-3 h-3 opacity-30 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                )}
                            </Link>
                        );
                    };

                    // Shared flyout panel class
                    const panelCls = "w-56 rounded-xl border border-[#cfd8e3] bg-[#eef2f6] py-2 shadow-xl shadow-slate-300/30 animate-in fade-in slide-in-from-left-2 duration-150";

                    return (
                        <>
                            <p className="hidden text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-semibold mt-5 mb-2 px-1 text-center">HR & People</p>

                            {/* MY TEAM trigger — gated by hr_my_team toggle */}
                            {tabAllowed("hr_my_team") && (
                                <div ref={hrTeamTrigger} {...teamHandlers}
                                    className={cn("flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px] cursor-pointer", isTeamActive || hrTeamOpen ? A : E)}>
                                    <span className="relative inline-flex">
                                        <Users size={15} strokeWidth={1.75} className={isTeamActive || hrTeamOpen ? "text-[#0f6ecd]" : ""} />
                                        {inboxCount > 0 && (
                                            <span className="absolute -top-1.5 -right-2.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[#008CFF] px-[3px] text-[9px] font-bold leading-none text-white tabular-nums ring-2 ring-[#f7f9fc]">
                                                {inboxCount > 99 ? "99+" : inboxCount}
                                            </span>
                                        )}
                                    </span>
                                    My Team
                                </div>
                            )}

                            {/* ORGANISATION */}
                            <div className="mx-3 mt-4 mb-1.5 border-t border-[#e4ebf2]" />
                            <p className="hidden text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-semibold mb-1.5 px-1 text-center">Organisation</p>
                            {tabAllowed("hr_people") && [
                                { href: "/dashboard/hr/people", label: "People", Icon: Users },
                            ].map(({ href, label, Icon }) => {
                                const active = pathname === href || pathname.startsWith(href + "/");
                                return (
                                    <Link key={href} href={href}
                                        className={cn("flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]", active ? A : E)}>
                                        <Icon size={15} strokeWidth={1.75} className={active ? "text-[#0f6ecd]" : ""} />
                                        {label}
                                    </Link>
                                );
                            })}

                            {/* HR DASHBOARD — direct link to the tabbed hub
                                page. Role gate AND tab toggle must both pass. */}
                            {isHRAdmin && tabAllowed("hr_admin") && (
                                <>
                                    <div className="mx-3 mt-4 mb-1.5 border-t border-[#e4ebf2]" />
                                    <Link href="/dashboard/hr/admin"
                                        className={cn("flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]", isAdminActive ? A : E)}>
                                        <span className="relative inline-flex">
                                            <BarChart2 size={15} strokeWidth={1.75} className={isAdminActive ? "text-[#0f6ecd]" : ""} />
                                            {approvalsCount > 0 && (
                                                <span className="absolute -top-1.5 -right-2.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[#008CFF] px-[3px] text-[9px] font-bold leading-none text-white tabular-nums ring-2 ring-[#f7f9fc]">
                                                    {approvalsCount > 99 ? "99+" : approvalsCount}
                                                </span>
                                            )}
                                        </span>
                                        HR Dashboard
                                    </Link>
                                </>
                            )}

                            {/* ── Portal flyouts — escape overflow-y:auto, open sideways ── */}
                            {hrMeOpen && typeof document !== "undefined" && createPortal(
                                <div style={{ position: "fixed", left: 108, top: hrMeY, zIndex: 9999 }}
                                    className={panelCls} {...meHandlers}>
                                    <p className="text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-semibold mb-1 px-4 pt-1">My Space</p>
                                    {fl("/dashboard/hr/attendance", "Attendance"       )}
                                    {fl("/dashboard/hr/leaves",     "Leave"            )}
                                    <div className="my-1 mx-3 border-t border-[#d1dae5]" />
                                    {fl("/dashboard/hr/goals",      "Goals"            )}
                                    {fl("/dashboard/hr/documents",  "Documents"        )}
                                    {fl("/dashboard/hr/tickets",    "Helpdesk"         )}
                                </div>,
                                document.body
                            )}

                            {financesOpen && typeof document !== "undefined" && createPortal(
                                <div style={{ position: "fixed", left: 108, top: financesY, zIndex: 9999 }}
                                    className={panelCls}
                                    onMouseEnter={() => { if (financesTimer.current) clearTimeout(financesTimer.current); setFinancesOpen(true); }}
                                    onMouseLeave={() => { financesTimer.current = setTimeout(() => setFinancesOpen(false), 200); }}>
                                    <p className="text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-semibold mb-1 px-4 pt-1">My Finances</p>
                                    {fl("/dashboard/hr/payroll/summary", "Summary"   )}
                                    {/* My Pay — parent row with nested sub-flyout */}
                                    {(() => {
                                        const href = "/dashboard/hr/payroll";
                                        const active = pathname === href || pathname.startsWith(href + "/") || pathname.startsWith(href + "?");
                                        return (
                                            <div ref={myPayRowRef}
                                                onMouseEnter={() => {
                                                    if (myPaySubTimer.current) clearTimeout(myPaySubTimer.current);
                                                    if (myPayRowRef.current) setMyPaySubY(myPayRowRef.current.getBoundingClientRect().top);
                                                    setMyPaySubOpen(true);
                                                }}
                                                onMouseLeave={() => {
                                                    myPaySubTimer.current = setTimeout(() => setMyPaySubOpen(false), 200);
                                                }}
                                            >
                                                <Link href={href}
                                                    className={cn(
                                                        "flex items-center justify-between px-4 py-2 text-[13px] transition-all duration-150",
                                                        active
                                                            ? "bg-[#eef4fb] font-semibold text-[#1f3b57]"
                                                            : "text-[#34495e] hover:bg-[#dde4ec] hover:text-[#1f2f3f]"
                                                    )}>
                                                    <span className="truncate">My Pay</span>
                                                    <svg className="w-3 h-3 opacity-50 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                    </svg>
                                                </Link>
                                            </div>
                                        );
                                    })()}
                                    {fl("/dashboard/hr/payroll/tax",     "Manage Tax")}
                                </div>,
                                document.body
                            )}

                            {/* Nested sub-flyout for My Pay — positioned to the right of the finances panel */}
                            {myPaySubOpen && typeof document !== "undefined" && createPortal(
                                <div
                                    style={{ position: "fixed", left: 108 + 224 + 4, top: myPaySubY, zIndex: 10000 }}
                                    className={panelCls}
                                    onMouseEnter={() => {
                                        if (myPaySubTimer.current) clearTimeout(myPaySubTimer.current);
                                        setMyPaySubOpen(true);
                                        // Keep the parent flyout open while the sub is open.
                                        if (financesTimer.current) clearTimeout(financesTimer.current);
                                        setFinancesOpen(true);
                                    }}
                                    onMouseLeave={() => {
                                        myPaySubTimer.current = setTimeout(() => setMyPaySubOpen(false), 200);
                                    }}
                                >
                                    <p className="text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-semibold mb-1 px-4 pt-1">My Pay</p>
                                    {(() => {
                                        const onPayroll = pathname === "/dashboard/hr/payroll";
                                        const tabActive = (t: string) => onPayroll && (currentTab === t || (!currentTab && t === "my-salary"));
                                        const subItem = (tab: string, label: string) => {
                                            const active = tabActive(tab);
                                            return (
                                                <Link key={tab} href={`/dashboard/hr/payroll?tab=${tab}`}
                                                    className={cn(
                                                        "flex items-center justify-between px-4 py-2 text-[13px] transition-all duration-150 border-l-2",
                                                        active
                                                            ? "bg-[#e8f1fc] font-semibold text-[#0f4e93] border-[#0f4e93]"
                                                            : "text-[#34495e] border-transparent hover:bg-[#dde4ec] hover:text-[#1f2f3f]"
                                                    )}>
                                                    <span className="truncate">{label}</span>
                                                    {active ? (
                                                        <span className="h-1.5 w-1.5 rounded-full bg-[#0f4e93]" />
                                                    ) : (
                                                        <svg className="w-3 h-3 opacity-30 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                        </svg>
                                                    )}
                                                </Link>
                                            );
                                        };
                                        return (
                                            <>
                                                {subItem("my-salary",  "My Salary" )}
                                                {subItem("pay-slips",  "Pay Slips" )}
                                                {subItem("income-tax", "Income Tax")}
                                            </>
                                        );
                                    })()}
                                </div>,
                                document.body
                            )}

                            {hrTeamOpen && typeof document !== "undefined" && createPortal(
                                <div style={{ position: "fixed", left: 108, top: hrTeamY, zIndex: 9999 }}
                                    className={panelCls} {...teamHandlers}>
                                    <p className="text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-semibold mb-1 px-4 pt-1">My Team</p>
                                    {fl("/dashboard/hr/my-team", "Team Overview")}
                                    {fl("/dashboard/hr/inbox",   "Inbox",
                                        inboxCount > 0 ? (
                                            <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-[#008CFF] text-white text-[10px] font-bold flex items-center justify-center leading-none tabular-nums">
                                                {inboxCount > 99 ? "99+" : inboxCount}
                                            </span>
                                        ) : undefined
                                    )}
                                </div>,
                                document.body
                            )}

                        </>
                    );
                })()}

                {/* Items from Admin onward */}
                {afterAdmin.map((item) => {
                    const isActive =
                        pathname === item.href ||
                        (item.href !== "/dashboard" && pathname.startsWith(item.href));

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                "flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]",
                                isActive
                                    ? "bg-gradient-to-br from-[#e8f1fc] to-[#d9e7f8] text-[#0f4e93] shadow-[inset_0_0_0_1px_rgba(15,110,205,0.18),0_2px_8px_rgba(15,110,205,0.08)]"
                                    : "text-[#6e8297] hover:bg-[#eef3f8] hover:text-[#213446]"
                            )}
                        >
                            <span className={cn(isActive ? "text-[#0f6ecd]" : "")}>{item.icon}</span>
                            {item.label}
                        </Link>
                    );
                })}
            </nav>

            {/* Footer */}
            <div className="border-t border-[#e4ebf2] p-2.5">
                <div className="overflow-hidden rounded-md border border-[#dee6ee] bg-white px-1 py-2 text-center">
                    <p className="text-[7px] font-semibold uppercase leading-none tracking-[0.14em] text-[#94a3b3]">Workspace</p>
                    <p className="mt-1 truncate whitespace-nowrap text-[9px] font-extrabold leading-none text-[#243445]">NB Media</p>
                    <p className="mt-0.5 truncate whitespace-nowrap text-[6.5px] leading-none text-[#9aa9b8]">Productions</p>
                </div>
            </div>
        </aside>

        </>
    );
}
