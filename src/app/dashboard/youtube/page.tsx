"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
    userCanAccessYoutubeDeveloperAnalytics,
    type YoutubeDashUserLike,
} from "@/lib/youtube-dashboard-access";
import ChannelQuarterAnalysisSection from "./channel-quarter-modal";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Legend,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

type ChannelRow = {
    name: string;
    channelId: string;
    viewsGainedInQuarter: number | null;
    viewsPreviousQuarter?: number | null;
    quarterOverQuarterDelta?: number | null;
    error: string | null;
};

type QuarterlyPayload = {
    year: number;
    quarter: number;
    label: string;
    startStr: string;
    endStr: string;
    configured: boolean;
    dataSource?: "database";
    lastQuarterViewsSyncedAt?: string | null;
    note?: string;
    channels: ChannelRow[];
    totalViewsGainedInQuarter?: number | null;
    analyticsStartStr?: string;
    analyticsEndStr?: string;
    analyticsNote?: string;
    message?: string;
};

function formatViews(n: number | null | undefined): string {
    if (n == null) return "—";
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** YouTube Studio–style compact metric (e.g. 3.4K) */
function formatCompactViews(n: number | null | undefined): string {
    if (n == null) return "—";
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
    if (abs >= 1000) return `${(n / 1000).toFixed(abs >= 10000 ? 0 : 1)}K`;
    return String(Math.round(n));
}

function studioComparisonLine(ch: ChannelRow): string {
    const cur = ch.viewsGainedInQuarter;
    if (cur == null) return "No quarter data yet — wait for the next sync.";
    if (ch.quarterOverQuarterDelta == null) return "No prior quarter stored to compare.";
    const d = ch.quarterOverQuarterDelta;
    if (d === 0) return "Flat vs last quarter.";
    if (d > 0) return `${formatViews(d)} more views than last quarter`;
    return `${formatViews(-d)} fewer views than last quarter`;
}

const BAR_PALETTE = ["#7c3aed", "#8b5cf6", "#a78bfa", "#c4b5fd", "#a855f7", "#9333ea", "#6d28d9"];

function useChartTheme() {
    const [isDark, setIsDark] = useState(false);
    useEffect(() => {
        const el = document.documentElement;
        const sync = () => setIsDark(el.classList.contains("dark"));
        sync();
        const obs = new MutationObserver(sync);
        obs.observe(el, { attributes: true, attributeFilter: ["class"] });
        return () => obs.disconnect();
    }, []);
    return {
        tick: isDark ? "#94a3b8" : "#64748b",
        grid: isDark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)",
        tooltipBg: isDark ? "#12122a" : "#ffffff",
        tooltipBorder: isDark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.1)",
        tooltipLabel: isDark ? "#f1f5f9" : "#0f172a",
        mutedBar: isDark ? "#475569" : "#94a3b8",
    };
}

function truncateLabel(s: string, max = 22): string {
    if (s.length <= max) return s;
    return `${s.slice(0, max - 1)}…`;
}

/** YouTube Studio–style blue accent for the selected “tab” (channel). */
const STUDIO_TAB_ACCENT = "#065fd4";

/** Production: merged card — four channel tabs + optional chart/analysis below (same shell). */
function StudioStyleChannelStrip({
    channels,
    periodLabel,
    onSelectChannel,
    selectedChannelId,
    children,
}: {
    channels: ChannelRow[];
    periodLabel: string;
    onSelectChannel?: (ch: ChannelRow) => void;
    /** Which channel tab shows white + blue top bar (Studio selection). */
    selectedChannelId?: string | null;
    /** Renders inside the same card under the tab row (e.g. quarter chart). */
    children?: ReactNode;
}) {
    const slots = Array.from({ length: 4 }, (_, i) => channels[i] ?? null);
    const extra = channels.length > 4 ? channels.length - 4 : 0;

    return (
        <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-100/90 dark:bg-[#0e0e1a] shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 bg-white dark:border-white/10 dark:bg-[#12122a] px-5 py-3">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Current quarter views</h2>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{periodLabel}</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4">
                {slots.map((ch, idx) => {
                    const selected = !!ch && !!selectedChannelId && ch.channelId === selectedChannelId;
                    const inner = (
                        <>
                            <p
                                className={cn(
                                    "mb-1.5 line-clamp-2 text-sm font-medium leading-snug tracking-tight sm:text-[15px]",
                                    selected
                                        ? "text-slate-600 dark:text-slate-300"
                                        : "text-slate-500 dark:text-slate-400"
                                )}
                            >
                                {ch?.name ?? "—"}
                            </p>
                            <div className="flex flex-wrap items-center justify-center gap-1.5">
                                <span
                                    className={cn(
                                        "text-2xl font-bold tabular-nums tracking-tight sm:text-3xl sm:leading-none",
                                        selected
                                            ? "text-slate-900 dark:text-white"
                                            : "text-slate-800 dark:text-slate-100"
                                    )}
                                >
                                    {ch ? formatCompactViews(ch.viewsGainedInQuarter) : "—"}
                                </span>
                                {ch && ch.viewsGainedInQuarter != null && ch.quarterOverQuarterDelta != null && ch.quarterOverQuarterDelta !== 0 && (
                                    <span
                                        className={cn(
                                            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full shadow-sm sm:h-7 sm:w-7",
                                            ch.quarterOverQuarterDelta > 0
                                                ? "bg-emerald-500 text-white"
                                                : "bg-rose-500 text-white"
                                        )}
                                        title="Change vs previous calendar quarter (same DB as developer dashboard)"
                                    >
                                        <svg className="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden>
                                            {ch.quarterOverQuarterDelta > 0 ? (
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                                            ) : (
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                                            )}
                                        </svg>
                                    </span>
                                )}
                            </div>
                            <p
                                className={cn(
                                    "mt-2 max-w-[200px] text-[11px] leading-snug italic sm:max-w-[220px] sm:text-xs",
                                    selected ? "text-slate-500 dark:text-slate-400" : "text-slate-500/90 dark:text-slate-500"
                                )}
                            >
                                {ch ? studioComparisonLine(ch) : "No channel configured in this slot."}
                            </p>
                        </>
                    );

                    const tabShell = cn(
                        "relative flex min-h-[138px] w-full flex-col items-center justify-center border-slate-200/90 px-3 py-6 text-center transition-[background-color,box-shadow] duration-300 ease-out sm:min-h-[148px] sm:px-4 sm:py-7 dark:border-white/10",
                        "border-r max-lg:[&:nth-child(2n)]:border-r-0 lg:[&:nth-child(4n)]:border-r-0",
                        "max-lg:[&:nth-child(-n+2)]:border-b lg:border-b-0",
                        selected
                            ? "bg-white dark:bg-[#12122a]"
                            : "bg-slate-100/95 dark:bg-white/[0.055]"
                    );

                    return (
                        <div key={ch?.channelId ?? `slot-${idx}`} className={tabShell}>
                            {selected && (
                                <div
                                    className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-[3px]"
                                    style={{ backgroundColor: STUDIO_TAB_ACCENT }}
                                    aria-hidden
                                />
                            )}
                            {ch && onSelectChannel ? (
                                <button
                                    type="button"
                                    onClick={() => onSelectChannel(ch)}
                                    className={cn(
                                        "relative z-[2] flex h-full min-h-[138px] w-full flex-col items-center justify-center px-1 py-1 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/35 sm:min-h-[148px]",
                                        selected ? "" : "hover:bg-slate-200/40 dark:hover:bg-white/[0.06]"
                                    )}
                                    aria-pressed={selected}
                                    aria-label={`${selected ? "Selected" : "Select"} ${ch.name} for quarterly chart`}
                                >
                                    {inner}
                                </button>
                            ) : (
                                <div className="relative z-[2] flex min-h-[138px] flex-col items-center justify-center px-1 py-1 sm:min-h-[148px]">{inner}</div>
                            )}
                        </div>
                    );
                })}
            </div>
            {children != null && (
                <div className="border-t border-slate-200/90 bg-white dark:border-white/10 dark:bg-[#12122a]">{children}</div>
            )}
            {extra > 0 && (
                <p className="border-t border-slate-200/80 bg-slate-100/90 px-4 py-2.5 text-center text-[11px] text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400">
                    +{extra} more channel{extra === 1 ? "" : "s"} — open <strong className="text-slate-700 dark:text-slate-300">Developer analytics</strong> for the full list.
                </p>
            )}
        </div>
    );
}

export default function YoutubeDashboardPage() {
    const { data: session } = useSession();
    const sessionUser = session?.user as YoutubeDashUserLike | undefined;
    const showDeveloperTab = userCanAccessYoutubeDeveloperAnalytics(sessionUser);
    const [viewMode, setViewMode] = useState<"production" | "developer">("production");

    const chartTheme = useChartTheme();
    const now = useMemo(() => new Date(), []);
    const defaultYear = now.getUTCFullYear();
    const defaultQuarter = Math.floor(now.getUTCMonth() / 3) + 1;

    const [year, setYear] = useState(defaultYear);
    const [quarter, setQuarter] = useState(defaultQuarter);
    const [data, setData] = useState<QuarterlyPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [analysisChannel, setAnalysisChannel] = useState<ChannelRow | null>(null);

    const yearOptions = useMemo(() => {
        const ys: number[] = [];
        for (let y = defaultYear + 1; y >= defaultYear - 5; y--) ys.push(y);
        return ys;
    }, [defaultYear]);

    const load = useCallback(async () => {
        setLoading(true);
        setFetchError(null);
        try {
            const res = await fetch(
                `/api/dashboard/youtube/quarterly?year=${year}&quarter=${quarter}`,
                { credentials: "include" }
            );
            const json = await res.json().catch(() => null);
            if (!res.ok) {
                setFetchError(typeof json?.error === "string" ? json.error : `Request failed (${res.status})`);
                setData(null);
                return;
            }
            setData(json as QuarterlyPayload);
        } catch {
            setFetchError("Network error");
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [year, quarter]);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        setAnalysisChannel(null);
    }, [year, quarter]);

    const periodNote =
        data && data.configured
            ? `${data.startStr} → ${data.endStr} (UTC).`
            : null;

    const lastQuarterViewsLabel = data?.lastQuarterViewsSyncedAt
        ? new Date(data.lastQuarterViewsSyncedAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
        })
        : "Never — run Admin → Crons → YouTube dashboard quarter sync";

    const barChartData = useMemo(() => {
        if (!data?.configured || !data.channels.length) return [];
        return [...data.channels]
            .map((c) => ({
                name: truncateLabel(c.name),
                fullName: c.name,
                gainedInQuarter: c.error ? 0 : c.viewsGainedInQuarter ?? 0,
                gainedOk: !c.error && c.viewsGainedInQuarter != null,
            }))
            .sort((a, b) => b.gainedInQuarter - a.gainedInQuarter);
    }, [data]);

    const pieData = useMemo(() => {
        if (!data?.configured) return [];
        return data.channels
            .filter((c) => !c.error && c.viewsGainedInQuarter != null && c.viewsGainedInQuarter > 0)
            .map((c, i) => ({
                name: truncateLabel(c.name, 18),
                fullName: c.name,
                value: c.viewsGainedInQuarter as number,
                fill: BAR_PALETTE[i % BAR_PALETTE.length],
            }));
    }, [data]);

    const pieSum = useMemo(() => pieData.reduce((s, p) => s + p.value, 0), [pieData]);

    const barChartHeight = Math.min(420, Math.max(200, barChartData.length * 44));

    return (
        <div className="min-h-[calc(100vh-4rem)] w-full">
            {/* Top band */}
            <div className="relative overflow-hidden border-b border-slate-200/80 dark:border-white/10 bg-gradient-to-br from-slate-50 via-white to-violet-50/60 dark:from-[#0c0c18] dark:via-[#0f0f22] dark:to-violet-950/40">
                <div
                    className="pointer-events-none absolute inset-0 opacity-[0.35] dark:opacity-20"
                    style={{
                        backgroundImage: `radial-gradient(circle at 20% 20%, rgba(139,92,246,0.25), transparent 45%),
              radial-gradient(circle at 80% 0%, rgba(236,72,153,0.12), transparent 40%)`,
                    }}
                />
                <div className="relative mx-auto max-w-6xl px-4 sm:px-6 py-10 md:py-12">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-600 dark:text-violet-400 mb-2">
                        Performance
                    </p>
                    <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
                        YouTube dashboard
                    </h1>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
                        {showDeveloperTab
                            ? "Production view is for the team; developer analytics use the same quarter totals from the database (written by the scheduled YouTube dashboard sync)."
                            : "Quarter view totals per channel from the dashboard database (synced from YouTube Analytics by your admin / cron)."}
                    </p>

                    {showDeveloperTab && (
                        <div className="mt-5 inline-flex rounded-xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#12122a]/90 p-1 shadow-sm">
                            <button
                                type="button"
                                onClick={() => setViewMode("production")}
                                className={cn(
                                    "rounded-lg px-4 py-2 text-xs font-semibold transition-colors",
                                    viewMode === "production"
                                        ? "bg-slate-900 text-white dark:bg-violet-600 dark:text-white"
                                        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
                                )}
                            >
                                Production
                            </button>
                            <button
                                type="button"
                                onClick={() => setViewMode("developer")}
                                className={cn(
                                    "rounded-lg px-4 py-2 text-xs font-semibold transition-colors",
                                    viewMode === "developer"
                                        ? "bg-slate-900 text-white dark:bg-violet-600 dark:text-white"
                                        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
                                )}
                            >
                                Developer analytics
                            </button>
                        </div>
                    )}

                    <div className="mt-8 flex flex-wrap items-end gap-4">
                        <div>
                            <label htmlFor="yt-year" className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                                Year
                            </label>
                            <select
                                id="yt-year"
                                value={year}
                                onChange={(e) => setYear(Number(e.target.value))}
                                className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#12122a] px-4 py-2.5 text-sm font-medium text-slate-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 min-w-[120px]"
                            >
                                {yearOptions.map((y) => (
                                    <option key={y} value={y}>
                                        {y}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="yt-q" className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                                Quarter
                            </label>
                            <select
                                id="yt-q"
                                value={quarter}
                                onChange={(e) => setQuarter(Number(e.target.value))}
                                className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#12122a] px-4 py-2.5 text-sm font-medium text-slate-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 min-w-[140px]"
                            >
                                <option value={1}>Q1 · Jan–Mar</option>
                                <option value={2}>Q2 · Apr–Jun</option>
                                <option value={3}>Q3 · Jul–Sep</option>
                                <option value={4}>Q4 · Oct–Dec</option>
                            </select>
                        </div>
                        <button
                            type="button"
                            onClick={() => load()}
                            disabled={loading}
                            className="mb-0.5 rounded-xl border border-violet-500/40 bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-500 disabled:opacity-50"
                        >
                            {loading ? "Refreshing…" : "Refresh"}
                        </button>
                    </div>


                </div>
            </div>

            <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 md:py-10 space-y-8">
                {fetchError && (
                    <div className="rounded-2xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 px-5 py-4 text-sm text-rose-800 dark:text-rose-200">
                        {fetchError}
                    </div>
                )}

                {data && !data.configured && (
                    <div className="rounded-2xl border border-amber-200/80 dark:border-amber-500/25 bg-amber-50/90 dark:bg-amber-500/10 px-6 py-5">
                        <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">Channels not configured</h2>
                        <p className="mt-2 text-sm text-amber-800/90 dark:text-amber-100/80 max-w-xl">
                            {data.message ||
                                "Add the YOUTUBE_CHANNELS JSON to your environment (same setup as Admin → YT Views) to see quarterly totals here."}
                        </p>
                    </div>
                )}

                {data?.configured && (
                    <>
                        {(viewMode === "production" || !showDeveloperTab) && (
                            <div className="space-y-4">
                                <StudioStyleChannelStrip
                                    channels={data.channels}
                                    periodLabel={data.label}
                                    selectedChannelId={analysisChannel?.channelId ?? null}
                                    onSelectChannel={(ch) => setAnalysisChannel(ch)}
                                >
                                    {analysisChannel ? (
                                        <ChannelQuarterAnalysisSection
                                            embedded
                                            channelId={analysisChannel.channelId}
                                            channelLabel={analysisChannel.name}
                                            year={year}
                                            quarter={quarter}
                                            quarterLabel={data.label}
                                            onDismiss={() => setAnalysisChannel(null)}
                                        />
                                    ) : null}
                                </StudioStyleChannelStrip>
                                {data.analyticsNote && (
                                    <p className="rounded-xl border border-sky-200/80 bg-sky-50/90 px-4 py-3 text-sm text-sky-900 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-100/90">
                                        {data.analyticsNote}
                                    </p>
                                )}
                                {data.note && (
                                    <p className="rounded-xl border border-slate-200/80 bg-slate-100/80 px-4 py-3 text-sm text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
                                        {data.note}
                                    </p>
                                )}
                                
                            </div>
                        )}

                        {showDeveloperTab && viewMode === "developer" && (
                            <>
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            <div className="rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white dark:bg-[#12122a] p-5 shadow-sm">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Period</p>
                                <p className="mt-2 text-xl font-bold text-slate-900 dark:text-white">{data.label}</p>
                                <p className="mt-1 text-xs text-slate-500 leading-relaxed">{periodNote}</p>
                            </div>
                            <div className="rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white dark:bg-[#12122a] p-5 shadow-sm">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Channels</p>
                                <p className="mt-2 text-xl font-bold text-slate-900 dark:text-white">{data.channels.length}</p>
                                <p className="mt-1 text-xs text-slate-500">From YOUTUBE_CHANNELS</p>
                            </div>
                            <div className="rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white dark:bg-[#12122a] p-5 shadow-sm">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Last Analytics sync (cron)</p>
                                <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                                    <span className="font-semibold text-slate-800 dark:text-slate-200">Quarter metrics:</span>{" "}
                                    <span className="text-slate-900 dark:text-white">{lastQuarterViewsLabel}</span>
                                </p>
                                <p className="mt-2 text-xs text-slate-500">Written by Admin → Crons</p>
                            </div>
                            <div className="rounded-2xl border border-emerald-200/80 dark:border-emerald-500/20 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-500/10 dark:to-[#12122a] p-5 shadow-sm xl:col-span-2">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                                    Quarter views (YouTube Analytics)
                                </p>
                                <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-900 dark:text-emerald-100">
                                    {formatViews(data.totalViewsGainedInQuarter ?? undefined)}
                                </p>
                                <p className="mt-1 text-xs text-emerald-800/70 dark:text-emerald-200/70">
                                    Stored Analytics range {data.analyticsStartStr ?? "—"} → {data.analyticsEndStr ?? "—"} (UTC; range is from last sync)
                                </p>
                            </div>
                        </div>

                        {data.note && (
                            <p className="text-sm text-slate-600 dark:text-slate-400 bg-slate-100/80 dark:bg-white/5 rounded-xl px-4 py-3 border border-slate-200/80 dark:border-white/10">
                                {data.note}
                            </p>
                        )}
                        {data.analyticsNote && (
                            <p className="text-sm text-sky-900 dark:text-sky-100/90 bg-sky-50/90 dark:bg-sky-500/10 rounded-xl px-4 py-3 border border-sky-200/80 dark:border-sky-500/25">
                                {data.analyticsNote}
                            </p>
                        )}

                        {/* Charts */}
                        {barChartData.length > 0 && (
                            <div className="grid gap-6 lg:grid-cols-2">
                                <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#12122a] p-5 shadow-sm">
                                    <div className="mb-1 flex items-start justify-between gap-2">
                                        <div>
                                            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                                                Quarter views by channel
                                            </h2>
                                            <p className="mt-0.5 text-xs text-slate-500">
                                                YouTube Analytics for {data.label} (stored on last cron sync).
                                            </p>
                                        </div>
                                    </div>
                                    <ResponsiveContainer width="100%" height={barChartHeight} className="mt-2 [&_.recharts-surface]:outline-none">
                                        <BarChart
                                            layout="vertical"
                                            data={barChartData}
                                            margin={{ top: 8, right: 16, left: 4, bottom: 8 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} horizontal={false} />
                                            <XAxis
                                                type="number"
                                                tick={{ fill: chartTheme.tick, fontSize: 11 }}
                                                tickLine={false}
                                                axisLine={{ stroke: chartTheme.grid }}
                                                tickFormatter={(v) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
                                            />
                                            <YAxis
                                                type="category"
                                                dataKey="name"
                                                width={108}
                                                tick={{ fill: chartTheme.tick, fontSize: 11 }}
                                                tickLine={false}
                                                axisLine={{ stroke: chartTheme.grid }}
                                            />
                                            <Tooltip
                                                cursor={{ fill: "rgba(5, 150, 105, 0.06)" }}
                                                content={({ active, payload }) => {
                                                    if (!active || !payload?.length) return null;
                                                    const row = payload[0].payload as (typeof barChartData)[0];
                                                    return (
                                                        <div
                                                            className="rounded-lg border px-3 py-2 text-xs shadow-lg"
                                                            style={{
                                                                backgroundColor: chartTheme.tooltipBg,
                                                                borderColor: chartTheme.tooltipBorder,
                                                                color: chartTheme.tooltipLabel,
                                                            }}
                                                        >
                                                            <p className="font-semibold">{row.fullName}</p>
                                                            <p className="mt-1 tabular-nums opacity-90">
                                                                Quarter views:{" "}
                                                                {row.gainedOk ? formatViews(row.gainedInQuarter) : "—"}
                                                            </p>
                                                        </div>
                                                    );
                                                }}
                                            />
                                            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                                            <Bar
                                                dataKey="gainedInQuarter"
                                                name="Quarter views (Analytics)"
                                                fill="#059669"
                                                radius={[0, 4, 4, 0]}
                                                maxBarSize={22}
                                            >
                                                {barChartData.map((entry, i) => (
                                                    <Cell
                                                        key={`gain-${entry.fullName}-${i}`}
                                                        fill={entry.gainedOk ? "#059669" : chartTheme.mutedBar}
                                                        fillOpacity={entry.gainedOk ? 0.85 : 0.35}
                                                    />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>

                                <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#12122a] p-5 shadow-sm">
                                    <div className="mb-1">
                                        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Share of quarter views</h2>
                                        <p className="mt-0.5 text-xs text-slate-500">
                                            YouTube Analytics channel views in {data.label} (where data loaded)
                                        </p>
                                    </div>
                                    {pieData.length === 0 ? (
                                        <div className="flex h-[240px] items-center justify-center text-sm text-slate-500">
                                            No Analytics quarter views to chart — check OAuth tokens in YOUTUBE_CHANNELS.
                                        </div>
                                    ) : (
                                        <ResponsiveContainer width="100%" height={260} className="mt-2 [&_.recharts-surface]:outline-none">
                                            <PieChart>
                                                <Pie
                                                    data={pieData}
                                                    dataKey="value"
                                                    nameKey="name"
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={58}
                                                    outerRadius={88}
                                                    paddingAngle={2}
                                                >
                                                    {pieData.map((entry, i) => (
                                                        <Cell key={`pie-${entry.fullName}-${i}`} fill={entry.fill} stroke="transparent" />
                                                    ))}
                                                </Pie>
                                                <Tooltip
                                                    content={({ active, payload }) => {
                                                        if (!active || !payload?.length) return null;
                                                        const p = payload[0].payload as (typeof pieData)[0];
                                                        const pct =
                                                            pieSum > 0
                                                                ? ((p.value / pieSum) * 100).toFixed(1)
                                                                : null;
                                                        return (
                                                            <div
                                                                className="rounded-lg border px-3 py-2 text-xs shadow-lg"
                                                                style={{
                                                                    backgroundColor: chartTheme.tooltipBg,
                                                                    borderColor: chartTheme.tooltipBorder,
                                                                    color: chartTheme.tooltipLabel,
                                                                }}
                                                            >
                                                                <p className="font-semibold">{p.fullName}</p>
                                                                <p className="mt-1 tabular-nums">{formatViews(p.value)} quarter views</p>
                                                                {pct != null && (
                                                                    <p className="mt-0.5 opacity-70">{pct}% of total</p>
                                                                )}
                                                            </div>
                                                        );
                                                    }}
                                                />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#12122a] shadow-sm overflow-hidden">
                            <div className="flex items-center justify-between gap-4 border-b border-slate-100 dark:border-white/5 px-5 py-4">
                                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Quarterly metrics by channel</h2>
                                <span className="text-[10px] uppercase tracking-wider text-slate-400">YouTube Analytics (DB)</span>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-100 dark:border-white/5 text-[10px] uppercase tracking-wider text-slate-500">
                                            <th className="px-5 py-3 font-semibold">Channel</th>
                                            <th className="px-5 py-3 font-semibold text-right">Quarter views (YT Analytics)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                                        {loading ? (
                                            <tr>
                                                <td colSpan={2} className="px-5 py-12 text-center text-slate-500">
                                                    Loading…
                                                </td>
                                            </tr>
                                        ) : (
                                            data.channels.map((row) => (
                                                <tr
                                                    key={row.channelId}
                                                    className="text-slate-800 dark:text-slate-200 hover:bg-slate-50/80 dark:hover:bg-white/[0.02]"
                                                >
                                                    <td className="px-5 py-4">
                                                        <div className="font-medium text-slate-900 dark:text-white">{row.name}</div>
                                                        <div className="text-[11px] text-slate-400 font-mono truncate max-w-[280px]">
                                                            {row.channelId}
                                                        </div>
                                                    </td>
                                                    <td className="px-5 py-4 text-right tabular-nums text-base font-semibold text-emerald-700 dark:text-emerald-300">
                                                        {row.viewsGainedInQuarter == null
                                                            ? "—"
                                                            : formatViews(row.viewsGainedInQuarter)}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                            {!loading && !data.lastQuarterViewsSyncedAt && (
                                <div className="border-t border-slate-100 dark:border-white/5 px-5 py-3 text-xs text-amber-700 dark:text-amber-200/90">
                                    No quarter metrics yet — open <strong>Admin → Crons</strong> to run manually or enable auto-sync, or POST{" "}
                                    <code className="text-[10px]">/api/cron/youtube-dashboard-sync</code> with{" "}
                                    <code className="text-[10px]">CRON_SECRET</code>.
                                </div>
                            )}
                        </div>
                            </>
                        )}

                    </>
                )}

                {loading && !data && (
                    <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#12122a] px-5 py-16 text-center text-slate-500 text-sm">
                        Loading dashboard…
                    </div>
                )}
            </div>
        </div>
    );
}
