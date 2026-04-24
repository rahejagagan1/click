"use client";

import Link from "next/link";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
    Bell,
    BookOpenText,
    CheckCircle2,
    ChevronRight,
    FileText,
    FolderKanban,
    Layers3,
    MessageSquareText,
    Sparkles,
    Users,
} from "lucide-react";
import { fetcher, swrConfig } from "@/lib/swr";
import { DashboardSkeleton } from "@/components/ui/loading-spinner";
import { formatDate, formatNumber, getStatusColor } from "@/lib/utils";

type DashboardData = {
    summary?: {
        totalCases?: number;
        activeCases?: number;
        completedCases?: number;
    };
    recentCases?: Array<{
        id: number;
        name: string;
        status: string;
        channel?: string | null;
        writer?: { name: string } | null;
        editor?: { name: string } | null;
        productionList?: { name: string } | null;
    }>;
    recentActivity?: Array<{
        id: number;
        name: string;
        status: string;
        dateDone?: string | null;
        case?: { name?: string | null } | null;
        assignee?: { name?: string | null } | null;
    }>;
};

export default function DashboardPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const [now, setNow] = useState(() => new Date());
    const sessionUser = session?.user as
        | { name?: string | null; orgLevel?: string | null; isDeveloper?: boolean | null }
        | undefined;
    const isCeo = sessionUser?.orgLevel === "ceo" || sessionUser?.isDeveloper === true;

    useEffect(() => {
        const timer = window.setInterval(() => setNow(new Date()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        if (status === "loading") return;
        if (!isCeo) {
            router.replace("/dashboard/youtube");
        }
    }, [status, isCeo, router]);

    const { data, error, isLoading } = useSWR<DashboardData>(
        isCeo ? "/api/dashboard/my" : null,
        fetcher,
        swrConfig
    );

    if (status === "loading" || isLoading) {
        return <DashboardSkeleton cards={4} />;
    }

    if (!isCeo) return null;

    if (error) {
        return (
            <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-[28px] border border-[#d6e0eb] bg-white p-10 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
                <p className="text-sm font-medium text-[#a33b3b]">Failed to load dashboard data.</p>
                <button
                    onClick={() => window.location.reload()}
                    className="rounded-full bg-[#0f6ecd] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0c5eb2]"
                >
                    Retry
                </button>
            </div>
        );
    }

    const summary = data?.summary || {};
    const recentCases = data?.recentCases || [];
    const recentActivity = data?.recentActivity || [];
    const completionRate = summary.totalCases
        ? Math.round(((summary.completedCases || 0) / summary.totalCases) * 100)
        : 0;

    const featuredCase = recentCases[0];
    const spotlightPeople = Array.from(
        new Map(
            [
                ...recentCases.flatMap((item) =>
                    [item.writer?.name, item.editor?.name].filter(Boolean).map((name) => ({
                        name: name as string,
                        role: item.writer?.name === name ? "Writer" : "Editor",
                    }))
                ),
                ...recentActivity
                    .filter((item) => item.assignee?.name)
                    .map((item) => ({ name: item.assignee?.name as string, role: "Closer" })),
            ].map((person) => [person.name, person])
        ).values()
    ).slice(0, 4);

    const quickLinks = [
        { label: "All Cases", href: "/cases" },
        { label: "Company", href: "/dashboard/company" },
        { label: "Scores", href: "/dashboard/scores" },
        { label: "Reports", href: "/dashboard/reports" },
    ];

    const timeParts = new Intl.DateTimeFormat("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    }).formatToParts(now);
    const hourMinute = `${timeParts.find((part) => part.type === "hour")?.value || "00"}:${timeParts.find((part) => part.type === "minute")?.value || "00"}`;
    const seconds = timeParts.find((part) => part.type === "second")?.value || "00";
    const dayPeriod = timeParts.find((part) => part.type === "dayPeriod")?.value || "";
    const timeTodayLabel = now.toLocaleDateString("en-IN", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
    });

    return (
        <div className="space-y-6 pb-4">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr),308px]">
                <section className="overflow-hidden rounded-[28px] border border-[#d7e3ef] bg-white shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
                    <div className="relative min-h-[154px] overflow-hidden bg-[radial-gradient(circle_at_15%_20%,rgba(93,178,255,0.75),transparent_28%),radial-gradient(circle_at_68%_20%,rgba(16,68,126,0.72),transparent_30%),linear-gradient(135deg,#132b49_0%,#274f83_45%,#18365e_100%)] px-8 py-7 text-white">
                        <div className="absolute inset-0 opacity-40">
                            <div className="absolute -left-10 top-8 h-40 w-52 rounded-full bg-white/10 blur-3xl" />
                            <div className="absolute right-16 top-2 h-28 w-40 rounded-full bg-[#7dc6ff]/35 blur-2xl" />
                            <div className="absolute bottom-0 right-0 h-32 w-72 bg-[linear-gradient(135deg,transparent_0%,rgba(255,255,255,0.06)_45%,transparent_100%)]" />
                        </div>
                        <div className="relative flex h-full flex-col justify-between gap-4 md:flex-row md:items-end">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-white/70">
                                    Home Dashboard
                                </p>
                                <h1 className="mt-4 text-[34px] font-semibold tracking-[-0.03em]">
                                    Welcome {sessionUser?.name || "back"}!
                                </h1>
                                <p className="mt-2 max-w-2xl text-sm text-white/80">
                                    Keep production moving with a Keka-style snapshot of your case flow,
                                    recent completions, and the team members driving today&apos;s momentum.
                                </p>
                            </div>
                            <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/70">
                                    Today
                                </p>
                                <p className="mt-2 text-lg font-semibold">
                                    {now.toLocaleDateString("en-IN", {
                                        weekday: "long",
                                        day: "numeric",
                                        month: "short",
                                        year: "numeric",
                                    })}
                                </p>
                            </div>
                        </div>
                    </div>
                </section>

                <aside className="rounded-[28px] border border-[#d7e3ef] bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
                    <div className="flex items-start gap-3">
                        <div className="mt-0.5 rounded-full bg-[#fff6df] p-2 text-[#d79a00]">
                            <Bell size={18} strokeWidth={2} />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-[#1c2834]">
                                Enable notifications
                            </h2>
                            <p className="mt-2 text-sm leading-6 text-[#738296]">
                                Stay on top of case movement, completed subtasks, and team updates with the
                                same gentle prompt pattern you liked on Keka.
                            </p>
                        </div>
                    </div>
                    <div className="mt-5 flex gap-3">
                        <button className="rounded-xl border border-[#d8e1ea] px-4 py-2 text-sm font-semibold text-[#607284] transition hover:bg-[#f7f9fc]">
                            Not now
                        </button>
                        <button className="rounded-xl bg-[#0f6ecd] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0c5eb2]">
                            Enable
                        </button>
                    </div>
                </aside>
            </div>

            <div className="grid gap-6 xl:grid-cols-[324px,minmax(0,1fr),320px]">
                <section className="space-y-4">
                    <Panel title="Quick Access">
                        <div className="space-y-4">
                            <div className="rounded-[3px] bg-[#9e8ac8] px-4 py-3 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[13px] font-medium text-white/90">
                                            Time Today - {timeTodayLabel}
                                        </p>
                                        <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.16em] text-white/80">
                                            Current Time
                                        </p>
                                        <div className="mt-1 flex items-end gap-[2px]">
                                            <span className="text-[43px] font-normal leading-none tracking-[-0.05em]">
                                                {hourMinute}
                                            </span>
                                            <span className="pb-[5px] text-[18px] font-normal leading-none text-white/90">
                                                .{seconds}
                                            </span>
                                            <span className="pb-[7px] pl-1 text-[14px] font-medium leading-none text-white/90">
                                                {dayPeriod}
                                            </span>
                                        </div>
                                    </div>
                                    <Link
                                        href="/dashboard/company"
                                        className="text-[13px] font-medium text-white/95 transition hover:text-white"
                                    >
                                        View All
                                    </Link>
                                </div>
                                <div className="mt-5 flex items-center justify-end gap-1.5">
                                    <button className="rounded-[4px] bg-[#ff6d5f] px-4 py-[7px] text-[13px] font-medium text-white shadow-sm transition hover:bg-[#f35d50]">
                                        Clock-out
                                    </button>
                                    <button className="inline-flex items-center gap-1 rounded-[4px] bg-white px-3 py-[7px] text-[13px] font-medium text-[#4e5661] transition hover:bg-[#f5f5f7]">
                                        Other
                                        <svg className="mt-px h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                                            <path d="M5.5 7.5L10 12l4.5-4.5" />
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            <InfoCard
                                title="Inbox"
                                icon={<MessageSquareText size={16} strokeWidth={1.8} />}
                                tone="default"
                            >
                                {recentActivity.length > 0 ? (
                                    <>
                                        <p className="text-sm font-semibold text-[#3a4b5a]">
                                            {recentActivity.length} recent closures landed in the pipeline
                                        </p>
                                        <p className="mt-1 text-sm text-[#7c8da0]">
                                            Last update: {recentActivity[0]?.name}
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-sm font-semibold text-[#3a4b5a]">
                                            Good job! You have no pending actions
                                        </p>
                                        <p className="mt-1 text-sm text-[#7c8da0]">
                                            Fresh activity will appear here as soon as the team closes work.
                                        </p>
                                    </>
                                )}
                            </InfoCard>

                            <InfoCard
                                title="Pipeline Health"
                                icon={<Sparkles size={16} strokeWidth={1.8} />}
                                tone="success"
                            >
                                <p className="text-[36px] font-semibold tracking-[-0.05em] text-white">
                                    {completionRate}%
                                </p>
                                <p className="mt-1 text-sm text-white/85">
                                    Completion rate based on {formatNumber(summary.totalCases || 0)} total cases
                                </p>
                            </InfoCard>

                            <InfoCard
                                title="Team Spotlight"
                                icon={<Users size={16} strokeWidth={1.8} />}
                                tone="plain"
                            >
                                <div className="flex flex-wrap gap-2">
                                    {spotlightPeople.length > 0 ? spotlightPeople.map((person) => (
                                        <div
                                            key={person.name}
                                            className="inline-flex items-center gap-2 rounded-full border border-[#d8e3ec] bg-[#f7f9fc] px-3 py-2"
                                        >
                                            <AvatarSeed name={person.name} />
                                            <div>
                                                <p className="text-xs font-semibold text-[#31414f]">{person.name}</p>
                                                <p className="text-[11px] text-[#7b8ca0]">{person.role}</p>
                                            </div>
                                        </div>
                                    )) : (
                                        <p className="text-sm text-[#7c8da0]">No active teammates to surface yet.</p>
                                    )}
                                </div>
                            </InfoCard>

                            <InfoCard
                                title="Quick Links"
                                icon={<ChevronRight size={16} strokeWidth={1.8} />}
                                tone="plain"
                            >
                                <div className="grid grid-cols-2 gap-2">
                                    {quickLinks.map((item) => (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            className="rounded-xl border border-[#dbe4ed] bg-[#fbfcfd] px-3 py-2 text-sm font-medium text-[#37506a] transition hover:border-[#bfd0e2] hover:bg-white"
                                        >
                                            {item.label}
                                        </Link>
                                    ))}
                                </div>
                            </InfoCard>
                        </div>
                    </Panel>
                </section>

                <section className="space-y-4">
                    <Panel>
                        <div className="flex flex-wrap items-center gap-3">
                            <button className="rounded-xl border border-[#9ebbe0] bg-[#f5f9ff] px-4 py-2 text-sm font-semibold text-[#235d99]">
                                Organization
                            </button>
                            <button className="rounded-xl border border-[#dce5ef] bg-white px-4 py-2 text-sm font-medium text-[#738296]">
                                NB Production Intelligence
                            </button>
                        </div>

                        <div className="mt-4 overflow-hidden rounded-[22px] border border-[#e2e8f0] bg-white">
                            <div className="flex gap-6 border-b border-[#ebeff4] px-4 py-3 text-sm">
                                <span className="border-b-2 border-[#0f6ecd] pb-2 font-semibold text-[#0f6ecd]">
                                    Post
                                </span>
                                <span className="pb-2 text-[#8a99aa]">Poll</span>
                                <span className="pb-2 text-[#8a99aa]">Praise</span>
                            </div>
                            <div className="px-4 py-5">
                                <div className="rounded-2xl border border-dashed border-[#d9e3ee] bg-[#fbfcfd] px-4 py-5 text-sm text-[#8392a4]">
                                    Write your production update here and mention your peers
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 rounded-[22px] border border-[#e2e8f0] bg-[#fbfcfd] p-4">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold text-[#334454]">Today&apos;s Snapshot</p>
                                    <p className="mt-1 text-sm text-[#7c8da0]">
                                        A quick Keka-style summary powered by your existing dashboard data.
                                    </p>
                                </div>
                                <div className="rounded-xl bg-[#0f6ecd] p-2 text-white">
                                    <Layers3 size={16} strokeWidth={1.8} />
                                </div>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-3">
                                <MiniMetric
                                    label="Total Cases"
                                    value={formatNumber(summary.totalCases || 0)}
                                    accent="bg-[#eef5ff] text-[#0f6ecd]"
                                />
                                <MiniMetric
                                    label="Active Pipeline"
                                    value={formatNumber(summary.activeCases || 0)}
                                    accent="bg-[#edf8f3] text-[#0f8c5d]"
                                />
                                <MiniMetric
                                    label="Completed"
                                    value={formatNumber(summary.completedCases || 0)}
                                    accent="bg-[#fff7e7] text-[#d18f0a]"
                                />
                            </div>
                        </div>
                    </Panel>

                    <Panel title="Recent Activity Feed">
                        <div className="space-y-4">
                            {recentActivity.length > 0 ? recentActivity.map((activity) => (
                                <article
                                    key={activity.id}
                                    className="rounded-[22px] border border-[#e2e8f0] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]"
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex items-start gap-3">
                                            <AvatarSeed name={activity.assignee?.name || activity.name} />
                                            <div>
                                                <p className="text-sm text-[#7b8ca0]">
                                                    <span className="font-semibold text-[#324352]">
                                                        {activity.assignee?.name || "Team member"}
                                                    </span>{" "}
                                                    completed a step
                                                </p>
                                                <h3 className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-[#1f2f3d]">
                                                    {activity.name}
                                                </h3>
                                            </div>
                                        </div>
                                        <span className="rounded-full bg-[#f4f7fb] px-3 py-1 text-xs font-semibold text-[#7f91a4]">
                                            {activity.dateDone ? formatDate(activity.dateDone) : "Recently"}
                                        </span>
                                    </div>
                                    <p className="mt-4 text-sm leading-6 text-[#57697c]">
                                        {activity.case?.name || "General pipeline work"} moved forward with status{" "}
                                        <span className="font-semibold text-[#334656]">{activity.status}</span>.
                                    </p>
                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                        <span className="rounded-full bg-[#edf4ff] px-3 py-1 text-xs font-semibold text-[#0f6ecd]">
                                            {activity.case?.name || "Unlinked case"}
                                        </span>
                                        <span className="rounded-full bg-[#f6f8fb] px-3 py-1 text-xs font-semibold text-[#718396]">
                                            {activity.assignee?.name || "Unassigned"}
                                        </span>
                                    </div>
                                </article>
                            )) : (
                                <EmptyState
                                    title="No recent activity"
                                    body="Once subtasks start closing, they’ll appear here in a clean Keka-style activity feed."
                                />
                            )}
                        </div>
                    </Panel>
                </section>

                <section className="space-y-4">
                    <Panel title="Highlights">
                        <div className="space-y-4">
                            <InfoCard
                                title="Featured Case"
                                icon={<FolderKanban size={16} strokeWidth={1.8} />}
                                tone="plain"
                            >
                                {featuredCase ? (
                                    <>
                                        <Link
                                            href={`/cases/${featuredCase.id}`}
                                            className="text-lg font-semibold tracking-[-0.02em] text-[#20313f] transition hover:text-[#0f6ecd]"
                                        >
                                            {featuredCase.name}
                                        </Link>
                                        <div className="mt-3 flex flex-wrap items-center gap-2">
                                            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getStatusColor(featuredCase.status)}`}>
                                                {featuredCase.status}
                                            </span>
                                            {featuredCase.channel ? (
                                                <span className="rounded-full bg-[#f5f8fb] px-3 py-1 text-xs font-semibold text-[#6f8294]">
                                                    {featuredCase.channel}
                                                </span>
                                            ) : null}
                                        </div>
                                        <p className="mt-3 text-sm leading-6 text-[#708397]">
                                            Writer: {featuredCase.writer?.name || "Not assigned"} • Editor:{" "}
                                            {featuredCase.editor?.name || "Not assigned"}
                                        </p>
                                    </>
                                ) : (
                                    <p className="text-sm text-[#7c8da0]">No cases are available yet.</p>
                                )}
                            </InfoCard>

                            <InfoCard
                                title="Knowledge Board"
                                icon={<BookOpenText size={16} strokeWidth={1.8} />}
                                tone="plain"
                            >
                                <div className="space-y-3">
                                    <MetricRow
                                        label="Recent case entries"
                                        value={formatNumber(recentCases.length)}
                                    />
                                    <MetricRow
                                        label="Recent completed steps"
                                        value={formatNumber(recentActivity.length)}
                                    />
                                    <MetricRow
                                        label="Open pipeline load"
                                        value={formatNumber(summary.activeCases || 0)}
                                    />
                                </div>
                            </InfoCard>

                            <InfoCard
                                title="Recent Cases"
                                icon={<FileText size={16} strokeWidth={1.8} />}
                                tone="plain"
                            >
                                <div className="space-y-3">
                                    {recentCases.slice(0, 6).map((item) => (
                                        <Link
                                            key={item.id}
                                            href={`/cases/${item.id}`}
                                            className="flex items-start justify-between gap-3 rounded-2xl border border-[#e5ebf2] bg-[#fbfcfd] px-4 py-3 transition hover:border-[#cad7e4] hover:bg-white"
                                        >
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-semibold text-[#223442]">
                                                    {item.name}
                                                </p>
                                                <p className="mt-1 truncate text-xs text-[#7d8fa2]">
                                                    {item.productionList?.name || item.channel || "Production pipeline"}
                                                </p>
                                            </div>
                                            <ChevronRight
                                                size={16}
                                                strokeWidth={1.8}
                                                className="mt-0.5 shrink-0 text-[#9cadbf]"
                                            />
                                        </Link>
                                    ))}
                                    {recentCases.length === 0 ? (
                                        <EmptyState
                                            title="No recent cases"
                                            body="Your case feed is empty right now, but this section is ready to display it without changing any logic."
                                        />
                                    ) : null}
                                </div>
                            </InfoCard>

                            <InfoCard
                                title="Completion Pulse"
                                icon={<CheckCircle2 size={16} strokeWidth={1.8} />}
                                tone="plain"
                            >
                                <div className="space-y-3">
                                    <ProgressLine
                                        label="Completed"
                                        value={summary.completedCases || 0}
                                        total={summary.totalCases || 0}
                                        color="bg-[#62b66d]"
                                    />
                                    <ProgressLine
                                        label="Active"
                                        value={summary.activeCases || 0}
                                        total={summary.totalCases || 0}
                                        color="bg-[#0f6ecd]"
                                    />
                                </div>
                            </InfoCard>
                        </div>
                    </Panel>
                </section>
            </div>
        </div>
    );
}

function Panel({
    title,
    children,
}: {
    title?: string;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-[28px] border border-[#d8e2ec] bg-[#f7f9fc] p-5 shadow-[0_12px_36px_rgba(15,23,42,0.05)]">
            {title ? (
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-[22px] font-semibold tracking-[-0.03em] text-[#1d2d3b]">
                        {title}
                    </h2>
                </div>
            ) : null}
            {children}
        </section>
    );
}

function InfoCard({
    title,
    icon,
    tone,
    children,
}: {
    title: string;
    icon: React.ReactNode;
    tone: "default" | "success" | "plain";
    children: React.ReactNode;
}) {
    const toneClasses =
        tone === "success"
            ? "border-[#7fbf89] bg-[linear-gradient(135deg,#88c46f_0%,#70b85c_100%)] text-white"
            : tone === "default"
              ? "border-[#e1e8f0] bg-white text-[#314352]"
              : "border-[#e1e8f0] bg-white text-[#314352]";

    const iconClasses =
        tone === "success"
            ? "bg-white/20 text-white"
            : "bg-[#edf4ff] text-[#0f6ecd]";

    return (
        <div className={`rounded-[24px] border p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)] ${toneClasses}`}>
            <div className="mb-3 flex items-center justify-between gap-3">
                <p className={`text-sm font-semibold ${tone === "success" ? "text-white" : "text-[#304150]"}`}>
                    {title}
                </p>
                <span className={`rounded-full p-2 ${iconClasses}`}>{icon}</span>
            </div>
            {children}
        </div>
    );
}

function MiniMetric({
    label,
    value,
    accent,
}: {
    label: string;
    value: string;
    accent: string;
}) {
    return (
        <div className="rounded-2xl border border-[#e3eaf2] bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8b9aab]">{label}</p>
            <div className={`mt-3 inline-flex rounded-full px-3 py-1 text-lg font-semibold ${accent}`}>
                {value}
            </div>
        </div>
    );
}

function MetricRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#e6ecf3] bg-[#fbfcfd] px-4 py-3">
            <span className="text-sm text-[#627487]">{label}</span>
            <span className="text-sm font-semibold text-[#20313f]">{value}</span>
        </div>
    );
}

function ProgressLine({
    label,
    value,
    total,
    color,
}: {
    label: string;
    value: number;
    total: number;
    color: string;
}) {
    const pct = total > 0 ? Math.max(6, Math.round((value / total) * 100)) : 0;

    return (
        <div>
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-[#415463]">{label}</span>
                <span className="text-[#708397]">
                    {formatNumber(value)} / {formatNumber(total)}
                </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-[#e9eef4]">
                <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

function AvatarSeed({ name }: { name: string }) {
    const initials = name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("");

    const palette = ["#0f6ecd", "#7a67c7", "#3ea66b", "#e38c3a", "#cf5f76"];
    const color = palette[name.length % palette.length];

    return (
        <div
            className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{ backgroundColor: color }}
        >
            {initials || "NB"}
        </div>
    );
}

function EmptyState({ title, body }: { title: string; body: string }) {
    return (
        <div className="rounded-2xl border border-dashed border-[#dbe4ec] bg-[#fbfcfd] px-4 py-6 text-center">
            <p className="text-sm font-semibold text-[#314352]">{title}</p>
            <p className="mt-2 text-sm leading-6 text-[#7c8da0]">{body}</p>
        </div>
    );
}
