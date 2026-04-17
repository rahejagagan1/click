"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { canViewFeedbackInbox } from "@/lib/feedback-inbox-access";
import { userCanAccessYoutubeDashboard } from "@/lib/youtube-dashboard-access";

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

    const isAdmin = user?.orgLevel === "ceo" || user?.isDeveloper;
    const canSeeReports = isAdmin || user?.orgLevel === "manager" || user?.orgLevel === "hod";
    const canSeeViolationLog = isAdmin || user?.orgLevel === "special_access" || user?.role === "hr_manager";
    const showFeedbackSubmenu = canViewFeedbackInbox(user);

    const isCeo = user?.orgLevel === "ceo" || user?.isDeveloper === true;

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

    // Dept submenu state
    const [deptHovered, setDeptHovered] = useState(false);
    const deptHoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Feedback submenu (CEO / Developer / HR)
    const [feedbackHovered, setFeedbackHovered] = useState(false);
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
        setReportHovered(true);
    };

    const handleReportMouseLeave = () => {
        hoverTimeoutRef.current = setTimeout(() => {
            setReportHovered(false);
        }, 200);
    };

    const handleFeedbackMouseEnter = () => {
        if (feedbackHoverTimeoutRef.current) clearTimeout(feedbackHoverTimeoutRef.current);
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
            <nav className="flex-1 p-4 space-y-1">
                <p className="text-[10px] uppercase tracking-widest text-slate-600 font-medium mb-3 px-3">
                    Main Menu
                </p>

                {/* Items before Admin */}
                {beforeAdmin.map((item) => {
                    if (item.label === "Feedback" && showFeedbackSubmenu) {
                        return (
                            <div
                                key={item.href}
                                className="relative"
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

                                {feedbackHovered && (
                                    <div
                                        className="absolute left-full top-0 ml-1 w-56 bg-[#12122a] border border-white/10 rounded-xl shadow-2xl shadow-black/50 py-2 z-50 animate-in fade-in slide-in-from-left-2 duration-200"
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
                                            <span className="truncate">Anonymous feedback</span>
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
                                            <span className="truncate">Feedback inbox</span>
                                            <svg className="w-3.5 h-3.5 opacity-40 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                        </Link>
                                    </div>
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
                        className="relative"
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
                        {reportHovered && (
                            <div
                                className="absolute left-full top-0 ml-1 w-52 bg-[#12122a] border border-white/10 rounded-xl shadow-2xl shadow-black/50 py-2 z-50 animate-in fade-in slide-in-from-left-2 duration-200"
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
                            </div>
                        )}
                    </div>
                ))}

                {/* Dept. — visible to admins, hover submenu with department names */}
                {isAdmin && (() => {
                    const isDeptActive = pathname.startsWith("/dashboard/departments");
                    return (
                        <div
                            className="relative"
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
                            {deptHovered && (
                                <div
                                    className="absolute left-full top-0 ml-1 w-52 bg-[#12122a] border border-white/10 rounded-xl shadow-2xl shadow-black/50 py-2 z-50 animate-in fade-in slide-in-from-left-2 duration-200"
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
                                </div>
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
    );
}
