"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState, useEffect, useRef, useCallback, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { canViewFeedbackInbox } from "@/lib/feedback-inbox-access";
import { userCanAccessYoutubeDashboard } from "@/lib/youtube-dashboard-access";
import { Users, Clock, TreePine, FileText, BarChart2, User, LifeBuoy, Target, IndianRupee, GitBranch, MessageCircle, Settings2, Package, FolderOpen, Inbox, Home, Plane, UserCircle, Building2, Sparkles, CalendarDays, Wallet } from "lucide-react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";

interface Manager {
    id: number;
    name: string;
    orgLevel: string;
}

const NAV_ITEMS = [
    {
        label: "Dashboard",
        href: "/dashboard",
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
        ),
        ceoOnly: true,
    },
    {
        label: "Cases",
        href: "/cases",
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
        ),
        adminOnly: true,
    },
    {
        label: "Company",
        href: "/dashboard/company",
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
        ),
        adminOnly: true,
    },
    {
        label: "Scores",
        href: "/dashboard/scores",
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
        ),
        managersOnly: true,
    },
    {
        label: "YouTube",
        href: "/dashboard/youtube",
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        ),
        youtubeDashboardAccess: true,
    },
    {
        label: "Feedback",
        href: "/dashboard/feedback",
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
        ),
    },
    {
        label: "Admin",
        href: "/admin",
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
        ),
        adminOnly: true,
    },
];

export default function Sidebar() {
    const pathname = usePathname();
    const { data: session } = useSession();
    const user = session?.user as any;

    const isAdmin = user?.orgLevel === "ceo" || user?.orgLevel === "special_access" || user?.isDeveloper;
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
    const [reportY, setReportY] = useState(0);
    const reportTrigger = useRef<HTMLDivElement>(null);
    const [managers, setManagers] = useState<Manager[]>([]);
    const [managersLoaded, setManagersLoaded] = useState(false);
    const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // HR sideways flyout state — portalled to body so overflow-y:auto can't clip them
    const isHRPath = pathname.startsWith("/dashboard/hr");
    const [hrMeOpen,    setHrMeOpen]    = useState(false);
    const [hrTeamOpen,  setHrTeamOpen]  = useState(false);
    const [hrAdminOpen, setHrAdminOpen] = useState(false);
    const [hrMeY,    setHrMeY]    = useState(0);
    const [hrTeamY,  setHrTeamY]  = useState(0);
    const [hrAdminY, setHrAdminY] = useState(0);
    const hrMeTrigger    = useRef<HTMLDivElement>(null);
    const hrTeamTrigger  = useRef<HTMLDivElement>(null);
    const hrAdminTrigger = useRef<HTMLDivElement>(null);
    const hrMeTimer    = useRef<NodeJS.Timeout | null>(null);
    const hrTeamTimer  = useRef<NodeJS.Timeout | null>(null);
    const hrAdminTimer = useRef<NodeJS.Timeout | null>(null);

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

    // Dept submenu state
    const [deptHovered, setDeptHovered] = useState(false);
    const [deptY, setDeptY] = useState(0);
    const deptTrigger = useRef<HTMLDivElement>(null);
    const deptHoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Feedback submenu (CEO / Developer / HR)
    const [feedbackHovered, setFeedbackHovered] = useState(false);
    const [feedbackY, setFeedbackY] = useState(0);
    const feedbackTrigger = useRef<HTMLDivElement>(null);
    const feedbackHoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
        if (deptTrigger.current) setDeptY(deptTrigger.current.getBoundingClientRect().top);
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
        if (reportTrigger.current) setReportY(reportTrigger.current.getBoundingClientRect().top);
        setReportHovered(true);
    };

    const handleReportMouseLeave = () => {
        hoverTimeoutRef.current = setTimeout(() => {
            setReportHovered(false);
        }, 200);
    };

    const handleFeedbackMouseEnter = () => {
        if (feedbackHoverTimeoutRef.current) clearTimeout(feedbackHoverTimeoutRef.current);
        if (feedbackTrigger.current) setFeedbackY(feedbackTrigger.current.getBoundingClientRect().top);
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
        <aside className="fixed left-0 top-0 z-40 h-screen w-64 bg-[#0a0a1a] border-r border-white/5 flex flex-col" style={{ background: 'var(--sidebar-bg)' }}>
            {/* Logo */}
            <div className="p-6 border-b border-white/5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-lg overflow-hidden shrink-0">
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
                        <h1 className="font-semibold text-white text-sm">NB Media</h1>
                        <p className="text-[11px] text-slate-500">Production Dashboard</p>
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 p-4 space-y-1 overflow-y-auto scrollbar-thin">
                <p className="text-[10px] uppercase tracking-widest text-slate-600 font-medium mb-3 px-3">
                    Main Menu
                </p>

                {/* Items before Admin */}
                {beforeAdmin.map((item) => {
                    if (item.label === "Feedback" && showFeedbackSubmenu) {
                        return (
                            <div
                                key={item.href}
                                ref={feedbackTrigger}
                                onMouseEnter={handleFeedbackMouseEnter}
                                onMouseLeave={handleFeedbackMouseLeave}
                            >
                                <div
                                    className={cn(
                                        "flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer",
                                        isFeedbackNavActive
                                            ? "bg-violet-500/15 text-violet-700 dark:text-white border border-violet-500/20 shadow-sm dark:shadow-lg dark:shadow-violet-500/5 dark:bg-gradient-to-r dark:from-violet-500/20 dark:to-fuchsia-500/10"
                                            : "text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
                                    )}
                                >
                                    <span className="flex items-center gap-3">
                                        <span className={cn(isFeedbackNavActive ? "text-violet-400" : "")}>
                                            {item.icon}
                                        </span>
                                        Feedback
                                    </span>
                                    <svg
                                        className={cn(
                                            "w-4 h-4 transition-transform duration-200",
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
                                        style={{ position: "fixed", left: 264, top: feedbackY, zIndex: 9999 }}
                                        className="w-56 bg-[#12122a] border border-white/10 rounded-xl shadow-2xl shadow-black/50 py-2 animate-in fade-in slide-in-from-left-2 duration-200"
                                        onMouseEnter={handleFeedbackMouseEnter}
                                        onMouseLeave={handleFeedbackMouseLeave}
                                    >
                                        <Link
                                            href="/dashboard/feedback"
                                            className={cn(
                                                "flex items-center justify-between px-4 py-2 text-sm transition-all duration-150",
                                                isFeedbackFormActive
                                                    ? "text-violet-700 dark:text-white bg-violet-100 dark:bg-violet-500/15 font-medium"
                                                    : "text-slate-700 dark:text-white hover:text-violet-700 dark:hover:text-white hover:bg-violet-50 dark:hover:bg-white/5"
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
                                                    ? "text-violet-700 dark:text-white bg-violet-100 dark:bg-violet-500/15 font-medium"
                                                    : "text-slate-700 dark:text-white hover:text-violet-700 dark:hover:text-white hover:bg-violet-50 dark:hover:bg-white/5"
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
                                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                                isActive
                                    ? "bg-violet-500/15 text-violet-700 dark:text-white border border-violet-500/20 shadow-sm dark:shadow-lg dark:shadow-violet-500/5 dark:bg-gradient-to-r dark:from-violet-500/20 dark:to-fuchsia-500/10"
                                    : "text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
                            )}
                        >
                            <span className={cn(isActive ? "text-violet-400" : "")}>{item.icon}</span>
                            {item.label}
                        </Link>
                    );
                })}

                {/* Report — visible to CEO, developers, managers only */}
                {canSeeReports && (!isAdmin ? (
                    <Link
                        href={`/dashboard/reports/${user?.dbId}`}
                        className={cn(
                            "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                            isReportActive
                                ? "bg-violet-500/15 text-violet-700 dark:text-white border border-violet-500/20 shadow-sm dark:shadow-lg dark:shadow-violet-500/5 dark:bg-gradient-to-r dark:from-violet-500/20 dark:to-fuchsia-500/10"
                                : "text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
                        )}
                    >
                        <span className={cn(isReportActive ? "text-violet-400" : "")}>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                        </span>
                        Report
                    </Link>
                ) : (
                    <div
                        ref={reportTrigger}
                        onMouseEnter={handleReportMouseEnter}
                        onMouseLeave={handleReportMouseLeave}
                    >
                        <div
                            className={cn(
                                "flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer",
                                isReportActive
                                    ? "bg-violet-500/15 text-violet-700 dark:text-white border border-violet-500/20 shadow-sm dark:shadow-lg dark:shadow-violet-500/5 dark:bg-gradient-to-r dark:from-violet-500/20 dark:to-fuchsia-500/10"
                                    : "text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
                            )}
                        >
                            <span className="flex items-center gap-3">
                                <span className={cn(isReportActive ? "text-violet-400" : "")}>
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                </span>
                                Report
                            </span>
                            <svg
                                className={cn(
                                    "w-4 h-4 transition-transform duration-200",
                                    reportHovered ? "rotate-90" : ""
                                )}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </div>

                        {/* Flyout submenu — admins only */}
                        {reportHovered && typeof document !== "undefined" && createPortal(
                            <div
                                style={{ position: "fixed", left: 264, top: reportY, zIndex: 9999 }}
                                className="w-52 bg-[#12122a] border border-white/10 rounded-xl shadow-2xl shadow-black/50 py-2 animate-in fade-in slide-in-from-left-2 duration-200"
                                onMouseEnter={handleReportMouseEnter}
                                onMouseLeave={handleReportMouseLeave}
                            >
                                <p className="text-[10px] uppercase tracking-widest text-slate-600 font-medium mb-1 px-4 py-1">
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
                                                    ? "text-violet-700 dark:text-white bg-violet-100 dark:bg-violet-500/15 font-medium"
                                                    : "text-slate-700 dark:text-white hover:text-violet-700 dark:hover:text-white hover:bg-violet-50 dark:hover:bg-white/5"
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
                            ref={deptTrigger}
                            onMouseEnter={handleDeptMouseEnter}
                            onMouseLeave={handleDeptMouseLeave}
                        >
                            <div
                                className={cn(
                                    "flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer",
                                    isDeptActive
                                        ? "bg-violet-500/15 text-violet-700 dark:text-white border border-violet-500/20 shadow-sm dark:shadow-lg dark:shadow-violet-500/5 dark:bg-gradient-to-r dark:from-violet-500/20 dark:to-fuchsia-500/10"
                                        : "text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
                                )}
                            >
                                <span className="flex items-center gap-3">
                                    <span className={cn(isDeptActive ? "text-violet-400" : "")}>
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                                        </svg>
                                    </span>
                                    Dept.
                                </span>
                                <svg
                                    className={cn(
                                        "w-4 h-4 transition-transform duration-200",
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
                                    style={{ position: "fixed", left: 264, top: deptY, zIndex: 9999 }}
                                    className="w-52 bg-[#12122a] border border-white/10 rounded-xl shadow-2xl shadow-black/50 py-2 animate-in fade-in slide-in-from-left-2 duration-200"
                                    onMouseEnter={handleDeptMouseEnter}
                                    onMouseLeave={handleDeptMouseLeave}
                                >
                                    <p className="text-[10px] uppercase tracking-widest text-slate-600 font-medium mb-1 px-4 py-1">
                                        Departments
                                    </p>
                                    {DEPARTMENTS.map((dept) => (
                                        <Link
                                            key={dept.slug}
                                            href={`/dashboard/departments/${dept.slug}`}
                                            className={cn(
                                                "flex items-center justify-between px-4 py-2 text-sm transition-all duration-150",
                                                pathname === `/dashboard/departments/${dept.slug}`
                                                    ? "text-violet-700 dark:text-white bg-violet-100 dark:bg-violet-500/15 font-medium"
                                                    : "text-slate-700 dark:text-white hover:text-violet-700 dark:hover:text-white hover:bg-violet-50 dark:hover:bg-white/5"
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
                                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                                isActive
                                    ? "bg-violet-500/15 text-violet-700 dark:text-white border border-violet-500/20 shadow-sm dark:shadow-lg dark:shadow-violet-500/5 dark:bg-gradient-to-r dark:from-violet-500/20 dark:to-fuchsia-500/10"
                                    : "text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
                            )}
                        >
                            <span className={cn(isActive ? "text-violet-400" : "")}>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </span>
                            Violation Log
                        </Link>
                    );
                })()}

                {/* ── HR & People Section ── developers only while under rollout */}
                {user?.isDeveloper === true && (() => {
                    const inboxCount = (inboxData?.total || 0) as number;
                    const E = "text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5";
                    const A = "bg-emerald-500/15 text-emerald-700 dark:text-white border border-emerald-500/20 dark:bg-gradient-to-r dark:from-emerald-500/20 dark:to-teal-500/10";

                    const meHandlers    = makeHrHandlers(setHrMeOpen,    setHrMeY,    hrMeTrigger,    hrMeTimer);
                    const teamHandlers  = makeHrHandlers(setHrTeamOpen,  setHrTeamY,  hrTeamTrigger,  hrTeamTimer);
                    const adminHandlers = makeHrHandlers(setHrAdminOpen, setHrAdminY, hrAdminTrigger, hrAdminTimer);

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
                                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 font-semibold"
                                        : "text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/5"
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
                    const panelCls = "w-56 bg-[#12122a] border border-white/10 rounded-xl shadow-2xl shadow-black/40 py-2 animate-in fade-in slide-in-from-left-2 duration-150";

                    return (
                        <>
                            <p className="text-[10px] uppercase tracking-widest text-slate-600 font-medium mt-6 mb-2 px-3">HR & People</p>

                            {/* HR Home — direct link */}
                            {(() => {
                                const active = pathname === "/dashboard/hr/analytics" || pathname.startsWith("/dashboard/hr/analytics/");
                                return (
                                    <Link href="/dashboard/hr/analytics"
                                        className={cn("flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200", active ? A : E)}>
                                        <Home size={15} strokeWidth={1.75} className={active ? "text-emerald-400" : ""} />
                                        Home
                                    </Link>
                                );
                            })()}

                            {/* ME trigger */}
                            <div ref={hrMeTrigger} {...meHandlers}
                                className={cn("flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer", isMeActive || hrMeOpen ? A : E)}>
                                <User size={15} strokeWidth={1.75} className={isMeActive || hrMeOpen ? "text-emerald-400" : ""} />
                                Me
                            </div>

                            {/* MY TEAM trigger */}
                            <div ref={hrTeamTrigger} {...teamHandlers}
                                className={cn("flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer", isTeamActive || hrTeamOpen ? A : E)}>
                                <span className="flex items-center gap-3">
                                    <Users size={15} strokeWidth={1.75} className={isTeamActive || hrTeamOpen ? "text-emerald-400" : ""} />
                                    My Team
                                </span>
                                {inboxCount > 0 && (
                                    <span className="text-[10px] font-bold bg-red-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                                        {inboxCount > 99 ? "99+" : inboxCount}
                                    </span>
                                )}
                            </div>

                            {/* ORGANISATION */}
                            <div className="mx-3 mt-4 mb-1.5 border-t border-white/5" />
                            <p className="text-[10px] uppercase tracking-widest text-slate-600 font-medium mb-1.5 px-3">Organisation</p>
                            {[
                                { href: "/dashboard/hr/people", label: "People",    Icon: Users     },
                                { href: "/dashboard/hr/engage", label: "Team Feed", Icon: Sparkles  },
                            ].map(({ href, label, Icon }) => {
                                const active = pathname === href || pathname.startsWith(href + "/");
                                return (
                                    <Link key={href} href={href}
                                        className={cn("flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200", active ? A : E)}>
                                        <Icon size={15} strokeWidth={1.75} className={active ? "text-emerald-400" : ""} />
                                        {label}
                                    </Link>
                                );
                            })}

                            {/* HR ADMIN trigger */}
                            {isHRAdmin && (
                                <>
                                    <div className="mx-3 mt-4 mb-1.5 border-t border-white/5" />
                                    <div ref={hrAdminTrigger} {...adminHandlers}
                                        className={cn("flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer", isAdminActive || hrAdminOpen ? A : E)}>
                                        <BarChart2 size={15} strokeWidth={1.75} className={isAdminActive || hrAdminOpen ? "text-emerald-400" : ""} />
                                        HR Admin
                                    </div>
                                </>
                            )}

                            {/* ── Portal flyouts — escape overflow-y:auto, open sideways ── */}
                            {hrMeOpen && typeof document !== "undefined" && createPortal(
                                <div style={{ position: "fixed", left: 264, top: hrMeY, zIndex: 9999 }}
                                    className={panelCls} {...meHandlers}>
                                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-medium mb-1 px-4 pt-1">My Space</p>
                                    {fl("/dashboard/hr/profile",    "My Profile"      )}
                                    <div className="my-1 mx-3 border-t border-white/[0.06]" />
                                    {fl("/dashboard/hr/attendance", "Attendance"       )}
                                    {fl("/dashboard/hr/leaves",     "Leave"            )}
                                    <div className="my-1 mx-3 border-t border-white/[0.06]" />
                                    {fl("/dashboard/hr/expenses",   "Expenses & Travel")}
                                    {fl("/dashboard/hr/payroll",    "My Finances"      )}
                                    <div className="my-1 mx-3 border-t border-white/[0.06]" />
                                    {fl("/dashboard/hr/goals",      "Goals"            )}
                                    {fl("/dashboard/hr/documents",  "Documents"        )}
                                    {fl("/dashboard/hr/tickets",    "Helpdesk"         )}
                                </div>,
                                document.body
                            )}

                            {hrTeamOpen && typeof document !== "undefined" && createPortal(
                                <div style={{ position: "fixed", left: 264, top: hrTeamY, zIndex: 9999 }}
                                    className={panelCls} {...teamHandlers}>
                                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-medium mb-1 px-4 pt-1">My Team</p>
                                    {fl("/dashboard/hr/my-team", "Team Overview")}
                                    {fl("/dashboard/hr/inbox",   "Inbox",
                                        inboxCount > 0 ? (
                                            <span className="text-[10px] font-bold bg-red-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                                                {inboxCount > 99 ? "99+" : inboxCount}
                                            </span>
                                        ) : undefined
                                    )}
                                </div>,
                                document.body
                            )}

                            {hrAdminOpen && isHRAdmin && typeof document !== "undefined" && createPortal(
                                <div style={{ position: "fixed", left: 264, top: hrAdminY, zIndex: 9999 }}
                                    className={panelCls} {...adminHandlers}>
                                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-medium mb-1 px-4 pt-1">HR Admin</p>
                                    {fl("/dashboard/hr/admin",  "Settings")}
                                    {fl("/dashboard/hr/assets", "Assets"  )}
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
                                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                                isActive
                                    ? "bg-violet-500/15 text-violet-700 dark:text-white border border-violet-500/20 shadow-sm dark:shadow-lg dark:shadow-violet-500/5 dark:bg-gradient-to-r dark:from-violet-500/20 dark:to-fuchsia-500/10"
                                    : "text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
                            )}
                        >
                            <span className={cn(isActive ? "text-violet-400" : "")}>{item.icon}</span>
                            {item.label}
                        </Link>
                    );
                })}
            </nav>

            {/* Footer */}
            <div className="p-4 border-t border-white/5">
                <div className="px-3 py-2 rounded-xl bg-gradient-to-r from-violet-500/10 to-transparent">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Workspace</p>
                    <p className="text-xs text-slate-300 mt-0.5">NB Media Productions</p>
                </div>
            </div>
        </aside>

        </>
    );
}
