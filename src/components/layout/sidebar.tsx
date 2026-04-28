"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState, useEffect, useRef, useCallback, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
    const router   = useRouter();
    const { data: session } = useSession();
    const user = session?.user as any;

    const isAdmin = user?.orgLevel === "ceo" || user?.isDeveloper;
    const isHRAdmin = isAdmin || user?.orgLevel === "hr_manager";
    const isCeo = user?.orgLevel === "ceo" || user?.isDeveloper === true;
    const canSeeReports = isAdmin || user?.orgLevel === "manager" || user?.orgLevel === "hod";
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
        if ((item as any).ceoOnly && !isCeo) return false;
        if ((item as any).managersOnly && !canSeeReports) return false;
        if ((item as any).adminOnly && !isAdmin) return false;
        if ((item as any).developerOnly && user?.isDeveloper !== true) return false;
        if ((item as any).youtubeDashboardAccess && !userCanAccessYoutubeDashboard(user)) return false;
        // Per-user tab permission gates. Label-to-key mapping mirrors TAB_CATALOG.
        // Note: "Admin" isn't gated via permissions — it's governed by
        // orgLevel/isDeveloper only, same as before.
        const label = (item as any).label as string;
        const keyMap: Record<string, string> = {
            "Dashboard": "dashboard", "Cases": "cases", "Company": "company",
            "Scores": "scores", "YouTube": "youtube", "Feedback": "feedback",
        };
        const k = keyMap[label];
        if (k && !tabAllowed(k)) return false;
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
                            <Link href="/dashboard/hr/home"
                                className={cn("flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px]", homeActive ? A : E)}>
                                <Home size={15} strokeWidth={1.75} className={homeActive ? "text-[#0f6ecd]" : ""} />
                                Home
                            </Link>
                            <div ref={hrMeTrigger} {...meHandlers}
                                onDoubleClick={() => { setHrMeOpen(false); router.push("/dashboard/hr/attendance"); }}
                                className={cn("flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px] cursor-pointer select-none", isMeActive || hrMeOpen ? A : E)}>
                                <User size={15} strokeWidth={1.75} className={isMeActive || hrMeOpen ? "text-[#0f6ecd]" : ""} />
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
                {canSeeReports && (!isAdmin ? (
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
                                style={{ position: "fixed", left: 108, top: reportY, zIndex: 9999 }}
                                className="w-52 rounded-xl border border-[#cfd8e3] bg-[#eef2f6] py-2 shadow-xl shadow-slate-300/30 animate-in fade-in slide-in-from-left-2 duration-200"
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
                                    "flex flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 mx-0.5 rounded-xl text-[11px] font-medium transition-all duration-150 text-center leading-tight min-h-[54px] cursor-pointer",
                                    isDeptActive
                                        ? "bg-gradient-to-br from-[#e8f1fc] to-[#d9e7f8] text-[#0f4e93] shadow-[inset_0_0_0_1px_rgba(15,110,205,0.18),0_2px_8px_rgba(15,110,205,0.08)]"
                                        : "text-[#6e8297] hover:bg-[#eef3f8] hover:text-[#213446]"
                                )}
                            >
                                <span className="flex flex-col items-center gap-1">
                                    <span className={cn(isDeptActive ? "text-[#0f6ecd]" : "")}>
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
                            {deptHovered && typeof document !== "undefined" && createPortal(
                                <div
                                    style={{ position: "fixed", left: 108, top: deptY, zIndex: 9999 }}
                                    className="w-52 rounded-xl border border-[#cfd8e3] bg-[#eef2f6] py-2 shadow-xl shadow-slate-300/30 animate-in fade-in slide-in-from-left-2 duration-200"
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
                                                    ? "bg-[#eef4fb] font-medium text-[#1f3b57]"
                                                    : "text-[#34495e] hover:bg-[#dde4ec] hover:text-[#1f3b57]"
                                            )}
                                        >
                                            <span className="truncate">{dept.label}</span>
                                            <svg className="w-3.5 h-3.5 opacity-40 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                        </Link>
                                    ))}
                                </div>,
                                document.body
                            )}
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

                            {/* MY TEAM trigger */}
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

                            {/* ORGANISATION */}
                            <div className="mx-3 mt-4 mb-1.5 border-t border-[#e4ebf2]" />
                            <p className="hidden text-[9px] uppercase tracking-[0.14em] text-[#8a9caf] font-semibold mb-1.5 px-1 text-center">Organisation</p>
                            {[
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

                            {/* HR DASHBOARD — direct link to the tabbed hub page */}
                            {isHRAdmin && (
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
                                    {fl("/dashboard/hr/payroll",    "My Finances"      )}
                                    <div className="my-1 mx-3 border-t border-[#d1dae5]" />
                                    {fl("/dashboard/hr/goals",      "Goals"            )}
                                    {fl("/dashboard/hr/documents",  "Documents"        )}
                                    {fl("/dashboard/hr/tickets",    "Helpdesk"         )}
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
