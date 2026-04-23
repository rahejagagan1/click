"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState, useEffect, useLayoutEffect, useRef, useCallback, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FLYOUT_LEFT = 88;
const FLYOUT_MARGIN = 8;

function FlyoutPanel({
    open,
    triggerTop,
    className,
    onMouseEnter,
    onMouseLeave,
    children,
}: {
    open: boolean;
    triggerTop: number;
    className?: string;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    children: ReactNode;
}) {
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [style, setStyle] = useState<{ top: number; maxHeight?: number }>({ top: triggerTop });

    useLayoutEffect(() => {
        if (!open) return;
        const el = panelRef.current;
        if (!el) return;

        const adjust = () => {
            const node = panelRef.current;
            if (!node) return;
            const vh = window.innerHeight;
            const maxAvail = vh - 2 * FLYOUT_MARGIN;
            const h = node.getBoundingClientRect().height;

            let top = triggerTop;
            let maxHeight: number | undefined;

            if (h > maxAvail) {
                top = FLYOUT_MARGIN;
                maxHeight = maxAvail;
            } else if (triggerTop + h + FLYOUT_MARGIN > vh) {
                top = Math.max(FLYOUT_MARGIN, vh - h - FLYOUT_MARGIN);
            }
            setStyle({ top, maxHeight });
        };

        adjust();
        const ro = new ResizeObserver(adjust);
        ro.observe(el);
        window.addEventListener("resize", adjust);
        return () => {
            ro.disconnect();
            window.removeEventListener("resize", adjust);
        };
    }, [open, triggerTop]);

    if (!open || typeof document === "undefined") return null;

    return createPortal(
        <div
            ref={panelRef}
            style={{
                position: "fixed",
                left: FLYOUT_LEFT,
                top: style.top,
                zIndex: 9999,
                maxHeight: style.maxHeight,
                overflowY: style.maxHeight ? "auto" : undefined,
            }}
            className={className}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            {children}
        </div>,
        document.body,
    );
}
import { cn } from "@/lib/utils";
import { canViewFeedbackInbox } from "@/lib/feedback-inbox-access";
import { userCanAccessYoutubeDashboard } from "@/lib/youtube-dashboard-access";
import { Users, BarChart2, BarChart3, User, MessageCircle, Settings, Home, Building2, LayoutDashboard, FileText, Star, PlayCircle } from "lucide-react";

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
    { label: "Dashboard", href: "/dashboard",         icon: icon(LayoutDashboard),                             ceoOnly: true                },
    { label: "Cases",     href: "/cases",              icon: icon(FileText),       adminOnly: true                                           },
    { label: "Company",   href: "/dashboard/company",  icon: icon(Building2),      adminOnly: true                                           },
    { label: "Scores",    href: "/dashboard/scores",   icon: icon(Star),                                        managersOnly: true           },
    { label: "YouTube",   href: "/dashboard/youtube",  icon: icon(PlayCircle),     youtubeDashboardAccess: true                              },
    { label: "Feedback",  href: "/dashboard/feedback", icon: icon(MessageCircle)                                                             },
    { label: "Admin",     href: "/admin",              icon: icon(Settings),       adminOnly: true                                           },
];

export default function Sidebar() {
    const pathname = usePathname();
    const { data: session } = useSession();
    const user = session?.user as any;

    const isAdmin = user?.orgLevel === "ceo" || user?.isDeveloper;
    const isHRAdmin = isAdmin || user?.orgLevel === "hr_manager";
    const isCeo = user?.orgLevel === "ceo" || user?.isDeveloper === true;
    const canSeeReports = isAdmin || user?.orgLevel === "manager" || user?.orgLevel === "hod";
    const canSeeViolationLog = isAdmin || user?.orgLevel === "special_access" || user?.role === "hr_manager";
    const showFeedbackSubmenu = canViewFeedbackInbox(user);

    const visibleItems = NAV_ITEMS.filter((item) => {
        if ((item as any).ceoOnly && !isCeo) return false;
        if ((item as any).managersOnly && !canSeeReports) return false;
        if ((item as any).adminOnly && !isAdmin) return false;
        if ((item as any).developerOnly && user?.isDeveloper !== true) return false;
        if ((item as any).youtubeDashboardAccess && !userCanAccessYoutubeDashboard(user)) return false;
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
        if (deptTriggerRef.current) setDeptY(deptTriggerRef.current.getBoundingClientRect().top);
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
        if (reportTriggerRef.current) setReportY(reportTriggerRef.current.getBoundingClientRect().top);
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
        <aside className="fixed left-0 top-0 z-40 h-screen w-20 border-r border-[#c7d2df] flex flex-col bg-gradient-to-b from-[#e7edf4] to-[#dde6ef]">
            {/* Logo */}
            <div className="p-3 border-b border-[#cfd8e3]">
                <div className="flex flex-col items-center gap-1 text-center">
                    <div className="w-9 h-9 rounded-lg bg-white flex items-center justify-center shadow-md overflow-hidden shrink-0">
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
                        <h1
                            className="font-bold text-[11px] leading-none text-transparent bg-clip-text"
                            style={{ backgroundImage: "linear-gradient(90deg, #f59e0b 0%, #ef4444 50%, #dc2626 100%)" }}
                        >
                            NB Media
                        </h1>
                        <p className="text-[9px] text-[#73879c] mt-1 leading-none">Dashboard</p>
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto scrollbar-thin">
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
                        && !pathname.startsWith("/dashboard/hr/analytics")
                        && !pathname.startsWith("/dashboard/hr/admin")
                        && !pathname.startsWith("/dashboard/hr/assets")
                        && pathname !== "/admin";
                    const homeActive = pathname === "/dashboard/hr/analytics" || pathname.startsWith("/dashboard/hr/analytics/");
                    const E = "text-[#31485f] hover:text-[#1f2f3f] hover:bg-[#d2ddea]";
                    const A = "bg-[#dfe7f1] text-[#1f3b57] border border-[#c7d3e0]";
                    return (
                        <>
                            <Link href="/dashboard/hr/analytics"
                                className={cn("flex flex-col items-center justify-center gap-1 px-1 py-2.5 rounded-md text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]", homeActive ? A : E)}>
                                <Home size={15} strokeWidth={1.75} className={homeActive ? "text-[#3b82c4]" : ""} />
                                Home
                            </Link>
                            <div ref={hrMeTrigger} {...meHandlers}
                                className={cn("flex flex-col items-center justify-center gap-1 px-1 py-2.5 rounded-md text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px] cursor-pointer", isMeActive || hrMeOpen ? A : E)}>
                                <User size={15} strokeWidth={1.75} className={isMeActive || hrMeOpen ? "text-[#3b82c4]" : ""} />
                                Me
                            </div>
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
                                        "flex flex-col items-center justify-center gap-1 px-1 py-2.5 rounded-md text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px] cursor-pointer",
                                        isFeedbackNavActive
                                            ? "bg-[#cfdbe8] text-[#1f3b57] border border-[#b8c9db] shadow-sm"
                                            : "text-[#31485f] hover:text-[#1f2f3f] hover:bg-[#d2ddea]"
                                    )}
                                >
                                    <span className="flex flex-col items-center gap-1">
                                        <span className={cn(isFeedbackNavActive ? "text-[#3b82c4]" : "")}>
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

                                <FlyoutPanel
                                    open={feedbackHovered}
                                    triggerTop={feedbackY}
                                    className="w-56 bg-[#eef2f6] border border-[#cfd8e3] rounded-xl shadow-xl shadow-slate-300/30 py-2 animate-in fade-in slide-in-from-left-2 duration-200"
                                    onMouseEnter={handleFeedbackMouseEnter}
                                    onMouseLeave={handleFeedbackMouseLeave}
                                >
                                    <Link
                                        href="/dashboard/feedback"
                                        className={cn(
                                            "flex items-center justify-between px-4 py-2 text-sm transition-all duration-150",
                                            isFeedbackFormActive
                                                ? "text-[#1f3b57] bg-[#dfe7f1] font-medium"
                                                : "text-[#34495e] hover:text-[#1f3b57] hover:bg-[#dde4ec]"
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
                                                ? "text-[#1f3b57] bg-[#dfe7f1] font-medium"
                                                : "text-[#34495e] hover:text-[#1f3b57] hover:bg-[#dde4ec]"
                                        )}
                                    >
                                        <span className="truncate">NB Unplugged inbox</span>
                                        <svg className="w-3.5 h-3.5 opacity-40 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </Link>
                                </FlyoutPanel>
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
                                "flex flex-col items-center justify-center gap-1 px-1 py-2.5 rounded-md text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]",
                                isActive
                                    ? "bg-[#cfdbe8] text-[#1f3b57] border border-[#b8c9db] shadow-sm"
                                    : "text-[#31485f] hover:text-[#1f2f3f] hover:bg-[#d2ddea]"
                            )}
                        >
                            <span className={cn(isActive ? "text-[#3b82c4]" : "")}>{item.icon}</span>
                            {item.label}
                        </Link>
                    );
                })}

                {/* Report — visible to CEO, developers, managers, HODs only */}
                {canSeeReports && (!isAdmin ? (
                    <Link
                        href={`/dashboard/reports/${user?.dbId}`}
                        className={cn(
                            "flex flex-col items-center justify-center gap-1 px-1 py-2.5 rounded-md text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]",
                            isReportActive
                                ? "bg-[#cfdbe8] text-[#1f3b57] border border-[#b8c9db] shadow-sm"
                                : "text-[#31485f] hover:text-[#1f2f3f] hover:bg-[#d2ddea]"
                        )}
                    >
                        <span className={cn(isReportActive ? "text-[#3b82c4]" : "")}>
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
                                "flex flex-col items-center justify-center gap-1 px-1 py-2.5 rounded-md text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px] cursor-pointer",
                                isReportActive
                                    ? "bg-[#cfdbe8] text-[#1f3b57] border border-[#b8c9db] shadow-sm"
                                    : "text-[#31485f] hover:text-[#1f2f3f] hover:bg-[#d2ddea]"
                            )}
                        >
                            <span className="flex flex-col items-center gap-1">
                                <span className={cn(isReportActive ? "text-[#3b82c4]" : "")}>
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
                        <FlyoutPanel
                            open={reportHovered}
                            triggerTop={reportY}
                            className="w-52 bg-[#eef2f6] border border-[#cfd8e3] rounded-xl shadow-xl shadow-slate-300/30 py-2 animate-in fade-in slide-in-from-left-2 duration-200"
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
                                                ? "text-[#1f3b57] bg-[#dfe7f1] font-medium"
                                                : "text-[#34495e] hover:text-[#1f3b57] hover:bg-[#dde4ec]"
                                        )}
                                    >
                                        <span className="truncate">{manager.name}</span>
                                        <svg className="w-3.5 h-3.5 opacity-40 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </Link>
                                ))
                            )}
                        </FlyoutPanel>
                    </div>
                ))}

                {/* Dept. — visible to admins, hover submenu with department names */}
                {isAdmin && (() => {
                    const isDeptActive = pathname.startsWith("/dashboard/departments");
                    return (
                        <div
                            ref={deptTriggerRef}
                            className="relative"
                            onMouseEnter={handleDeptMouseEnter}
                            onMouseLeave={handleDeptMouseLeave}
                        >
                            <div
                                className={cn(
                                    "flex flex-col items-center justify-center gap-1 px-1 py-2.5 rounded-md text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px] cursor-pointer",
                                    isDeptActive
                                        ? "bg-[#cfdbe8] text-[#1f3b57] border border-[#b8c9db] shadow-sm"
                                        : "text-[#31485f] hover:text-[#1f2f3f] hover:bg-[#d2ddea]"
                                )}
                            >
                                <span className="flex flex-col items-center gap-1">
                                    <span className={cn(isDeptActive ? "text-[#3b82c4]" : "")}>
                                        <Users size={18} strokeWidth={1.5} />
                                    </span>
                                    Dept.
                                </span>
                                <svg
                                    className={cn(
                                        "hidden",
                                        deptHovered ? "rotate-90" : ""
                                    )}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                            </div>

                            {/* Flyout submenu */}
                            <FlyoutPanel
                                open={deptHovered}
                                triggerTop={deptY}
                                className="w-52 bg-[#eef2f6] border border-[#cfd8e3] rounded-xl shadow-xl shadow-slate-300/30 py-2 animate-in fade-in slide-in-from-left-2 duration-200"
                                onMouseEnter={handleDeptMouseEnter}
                                onMouseLeave={handleDeptMouseLeave}
                            >
                                <p className="text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-medium mb-1 px-4 py-1">
                                    Departments
                                </p>
                                {DEPARTMENTS.map((dept) => (
                                    <Link
                                        key={dept.slug}
                                        href={`/dashboard/departments/${dept.slug}`}
                                        className={cn(
                                            "flex items-center justify-between px-4 py-2 text-sm transition-all duration-150",
                                            pathname === `/dashboard/departments/${dept.slug}`
                                                ? "text-[#1f3b57] bg-[#dfe7f1] font-medium"
                                                : "text-[#34495e] hover:text-[#1f3b57] hover:bg-[#dde4ec]"
                                        )}
                                    >
                                        <span className="truncate">{dept.label}</span>
                                        <svg className="w-3.5 h-3.5 opacity-40 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </Link>
                                ))}
                            </FlyoutPanel>
                        </div>
                    );
                })()}

                {/* System Violation Log — HR, Special Access, CEO, Developer only */}
                {canSeeViolationLog && (() => {
                    const isActive = pathname.startsWith("/dashboard/violations");
                    return (
                        <Link
                            href="/dashboard/violations"
                            className={cn(
                                "flex flex-col items-center justify-center gap-1 px-1 py-2.5 rounded-md text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]",
                                isActive
                                    ? "bg-[#cfdbe8] text-[#1f3b57] border border-[#b8c9db] shadow-sm"
                                    : "text-[#31485f] hover:text-[#1f2f3f] hover:bg-[#d2ddea]"
                            )}
                        >
                            <span className={cn(isActive ? "text-[#3b82c4]" : "")}>
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
                    const E = "text-[#31485f] hover:text-[#1f2f3f] hover:bg-[#d2ddea]";
                    const A = "bg-[#dfe7f1] text-[#1f3b57] border border-[#c7d3e0]";

                    const meHandlers   = makeHrHandlers(setHrMeOpen,   setHrMeY,   hrMeTrigger,   hrMeTimer);
                    const teamHandlers = makeHrHandlers(setHrTeamOpen, setHrTeamY, hrTeamTrigger, hrTeamTimer);

                    const isMeActive    = isHRPath && !pathname.startsWith("/dashboard/hr/my-team") && !pathname.startsWith("/dashboard/hr/inbox") && !pathname.startsWith("/dashboard/hr/people") && !pathname.startsWith("/dashboard/hr/org") && !pathname.startsWith("/dashboard/hr/engage") && !pathname.startsWith("/dashboard/hr/analytics") && !pathname.startsWith("/dashboard/hr/admin") && !pathname.startsWith("/dashboard/hr/assets") && pathname !== "/admin";
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
                                        ? "bg-[#dfe7f1] text-[#1f3b57] font-semibold"
                                        : "text-[#34495e] hover:text-[#1f2f3f] hover:bg-[#dde4ec]"
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
                    const panelCls = "w-56 bg-[#eef2f6] border border-[#cfd8e3] rounded-xl shadow-xl shadow-slate-300/30 py-2 animate-in fade-in slide-in-from-left-2 duration-150";

                    return (
                        <>
                            <p className="hidden text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-semibold mt-5 mb-2 px-1 text-center">HR & People</p>

                            {/* MY TEAM trigger */}
                            <div ref={hrTeamTrigger} {...teamHandlers}
                                className={cn("flex flex-col items-center justify-center gap-1 px-1 py-2.5 rounded-md text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px] cursor-pointer", isTeamActive || hrTeamOpen ? A : E)}>
                                <span className="relative inline-flex">
                                    <Users size={15} strokeWidth={1.75} className={isTeamActive || hrTeamOpen ? "text-[#3b82c4]" : ""} />
                                    {inboxCount > 0 && (
                                        <span className="absolute -top-1.5 -right-2.5 min-w-[15px] h-[15px] px-[3px] rounded-full bg-[#008CFF] text-white text-[9px] font-bold flex items-center justify-center leading-none tabular-nums ring-2 ring-[#e7edf4]">
                                            {inboxCount > 99 ? "99+" : inboxCount}
                                        </span>
                                    )}
                                </span>
                                My Team
                            </div>

                            {/* ORGANISATION */}
                            <div className="mx-3 mt-4 mb-1.5 border-t border-[#d1dae5]" />
                            <p className="hidden text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-semibold mb-1.5 px-1 text-center">Organisation</p>
                            {[
                                { href: "/dashboard/hr/people", label: "People", Icon: Users },
                            ].map(({ href, label, Icon }) => {
                                const active = pathname === href || pathname.startsWith(href + "/");
                                return (
                                    <Link key={href} href={href}
                                        className={cn("flex flex-col items-center justify-center gap-1 px-1 py-2.5 rounded-md text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]", active ? A : E)}>
                                        <Icon size={15} strokeWidth={1.75} className={active ? "text-[#3b82c4]" : ""} />
                                        {label}
                                    </Link>
                                );
                            })}

                            {/* HR DASHBOARD — direct link to the tabbed hub page */}
                            {isHRAdmin && (
                                <>
                                    <div className="mx-3 mt-4 mb-1.5 border-t border-[#d1dae5]" />
                                    <Link href="/dashboard/hr/admin"
                                        className={cn("flex flex-col items-center justify-center gap-1 px-1 py-2.5 rounded-md text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]", isAdminActive ? A : E)}>
                                        <span className="relative inline-flex">
                                            <BarChart2 size={15} strokeWidth={1.75} className={isAdminActive ? "text-[#3b82c4]" : ""} />
                                            {approvalsCount > 0 && (
                                                <span className="absolute -top-1.5 -right-2.5 min-w-[15px] h-[15px] px-[3px] rounded-full bg-[#008CFF] text-white text-[9px] font-bold flex items-center justify-center leading-none tabular-nums ring-2 ring-[#e7edf4]">
                                                    {approvalsCount > 99 ? "99+" : approvalsCount}
                                                </span>
                                            )}
                                        </span>
                                        HR Dashboard
                                    </Link>
                                </>
                            )}

                            {/* ── Portal flyouts — escape overflow-y:auto, open sideways ── */}
                            <FlyoutPanel open={hrMeOpen} triggerTop={hrMeY} className={panelCls} {...meHandlers}>
                                <p className="text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-semibold mb-1 px-4 pt-1">My Space</p>
                                {fl("/dashboard/hr/attendance", "Attendance"       )}
                                {fl("/dashboard/hr/leaves",     "Leave"            )}
                                <div className="my-1 mx-3 border-t border-[#d1dae5]" />
                                {fl("/dashboard/hr/payroll",    "My Finances"      )}
                                <div className="my-1 mx-3 border-t border-[#d1dae5]" />
                                {fl("/dashboard/hr/goals",      "Goals"            )}
                                {fl("/dashboard/hr/documents",  "Documents"        )}
                                {fl("/dashboard/hr/tickets",    "Helpdesk"         )}
                            </FlyoutPanel>

                            <FlyoutPanel open={hrTeamOpen} triggerTop={hrTeamY} className={panelCls} {...teamHandlers}>
                                <p className="text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-semibold mb-1 px-4 pt-1">My Team</p>
                                {fl("/dashboard/hr/my-team", "Team Overview")}
                                {fl("/dashboard/hr/inbox",   "Inbox",
                                    inboxCount > 0 ? (
                                        <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-[#008CFF] text-white text-[10px] font-bold flex items-center justify-center leading-none tabular-nums">
                                            {inboxCount > 99 ? "99+" : inboxCount}
                                        </span>
                                    ) : undefined
                                )}
                            </FlyoutPanel>

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
                                "flex flex-col items-center justify-center gap-1 px-1 py-2.5 rounded-md text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]",
                                isActive
                                    ? "bg-[#cfdbe8] text-[#1f3b57] border border-[#b8c9db] shadow-sm"
                                    : "text-[#31485f] hover:text-[#1f2f3f] hover:bg-[#d2ddea]"
                            )}
                        >
                            <span className={cn(isActive ? "text-[#3b82c4]" : "")}>{item.icon}</span>
                            {item.label}
                        </Link>
                    );
                })}
            </nav>

            {/* Footer */}
            <div className="p-2.5 border-t border-[#cfd8e3]">
                <div className="px-1 py-1.5 rounded-md bg-gradient-to-br from-[#e6eef7] to-[#d5e0ec] border border-[#c7d2df] text-center overflow-hidden">
                    <p className="text-[7px] text-[#73879c] uppercase tracking-[0.14em] font-semibold leading-none">Workspace</p>
                    <p
                        className="text-[9px] font-extrabold mt-1 leading-none text-transparent bg-clip-text whitespace-nowrap truncate"
                        style={{ backgroundImage: "linear-gradient(90deg, #f59e0b 0%, #ef4444 50%, #dc2626 100%)" }}
                    >
                        NB Media
                    </p>
                    <p className="text-[6.5px] text-[#73879c] mt-0.5 leading-none whitespace-nowrap truncate">Productions</p>
                </div>
            </div>
        </aside>

        </>
    );
}
