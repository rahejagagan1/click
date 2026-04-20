"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
type UploadSnippet = { publishedAt: string; title: string; videoId: string };

export type AnalysisBucket = {
    key: string;
    label: string;
    endDay: string;
    views: number;
    uploads: UploadSnippet[];
};

type AnalysisPayload = {
    channelName: string;
    analyticsStartStr: string;
    analyticsEndStr: string;
    buckets: AnalysisBucket[];
    headlineViews: number;
    uploadsTotal: number;
    fetchedAt?: string | null;
    dataSource?: string;
    /** YoutubeDashboardQuarterMetrics — same as channel strip “quarter views”. */
    viewsGainedInQuarter: number | null;
    quarterAnalyticsStartStr: string | null;
    quarterAnalyticsEndStr: string | null;
    quarterMetricsFetchedAt: string | null;
};

function formatViews(n: number): string {
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function scopeKeyFor(channelId: string, year: number, quarter: number) {
    return `${channelId}:${year}:${quarter}`;
}

export type UserQuarterContribution = {
    videoCount: number;
    viewsOnVideos: number;
};

export default function ChannelQuarterAnalysisSection({
    channelId,
    channelLabel,
    year,
    quarter,
    quarterLabel,
    onDismiss,
    embedded,
    userContribution,
}: {
    channelId: string;
    channelLabel: string;
    year: number;
    quarter: number;
    quarterLabel: string;
    /** Collapse the inline panel (optional control in header). */
    onDismiss: () => void;
    /** When true, render inside the Studio channel card (no outer frame — tab row shows selection). */
    embedded?: boolean;
    /** Logged-in user: sum of stored views on your cases for this channel in this quarter (from quarterly payload). */
    userContribution?: UserQuarterContribution | null;
}) {
    const gradientId = `ytAreaFill-${useId().replace(/:/g, "")}`;
    const scopeKey = useMemo(() => scopeKeyFor(channelId, year, quarter), [channelId, year, quarter]);

    const [data, setData] = useState<AnalysisPayload | null>(null);
    /** Which `scopeKey` the current `data` belongs to (avoids flashing wrong channel during fetch). */
    const [dataScopeKey, setDataScopeKey] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const ac = new AbortController();
        setLoading(true);
        setErr(null);

        (async () => {
            try {
                const res = await fetch(
                    `/api/dashboard/youtube/channel-analysis?channelId=${encodeURIComponent(channelId)}&year=${year}&quarter=${quarter}`,
                    { credentials: "include", signal: ac.signal }
                );
                const json = await res.json().catch(() => null);
                if (ac.signal.aborted) return;
                if (!res.ok) {
                    setErr(typeof json?.error === "string" ? json.error : `Failed (${res.status})`);
                    setData(null);
                    setDataScopeKey(null);
                    return;
                }
                setData(json as AnalysisPayload);
                setDataScopeKey(scopeKeyFor(channelId, year, quarter));
            } catch (e) {
                if (ac.signal.aborted) return;
                setErr("Network error");
                setData(null);
                setDataScopeKey(null);
            } finally {
                if (!ac.signal.aborted) setLoading(false);
            }
        })();

        return () => ac.abort();
    }, [channelId, year, quarter]);

    const chartRows = useMemo(() => {
        const buckets = data?.buckets ?? [];
        const totalBucketViews = buckets.reduce((s, b) => s + b.views, 0);
        const contribTotal = userContribution?.viewsOnVideos ?? 0;

        return buckets.map((b) => ({
            label: b.label,
            views: b.views,
            uploads: b.uploads,
            contribution:
                contribTotal > 0 && totalBucketViews > 0
                    ? Math.round((b.views / totalBucketViews) * contribTotal)
                    : 0,
        }));
    }, [data?.buckets, userContribution?.viewsOnVideos]);

    const contentReady = !loading && !err && data && dataScopeKey === scopeKey;
    const showSkeleton = loading && dataScopeKey !== scopeKey;

    const shellClass = embedded
        ? "w-full"
        : "mt-4 w-full rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#12122a]";

    return (
        <div className={shellClass}>
            {embedded ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5 dark:border-white/10">
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Quarterly chart</p>
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{quarterLabel}</p>
                        <p className="sr-only">Channel: {channelLabel}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onDismiss}
                        className="shrink-0 text-xs font-semibold text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
                    >
                        Clear selection
                    </button>
                </div>
            ) : (
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-white/10">
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Quarterly analysis</p>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">{channelLabel}</h2>
                        <p className="mt-0.5 text-xs text-slate-500">{quarterLabel}</p>
                    </div>
                    <div className="flex shrink-0 items-start">
                        <button
                            type="button"
                            onClick={onDismiss}
                            className="text-xs font-semibold text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
                        >
                            Clear selection
                        </button>
                    </div>
                </div>
            )}

            <div className={embedded ? "px-4 pb-5 pt-4 sm:px-5 sm:pb-6" : "p-5 sm:p-6"}>
                {showSkeleton && (
                    <div
                        className="space-y-6 motion-safe:animate-yt-skeleton motion-reduce:animate-none"
                        aria-hidden
                    >
                        <div className="rounded-xl border border-slate-200/80 bg-slate-100/80 px-4 py-6 dark:border-white/10 dark:bg-white/[0.06]">
                            <div className="h-3 w-28 rounded bg-slate-300/80 dark:bg-white/20" />
                            <div className="mt-3 h-9 w-40 rounded-md bg-slate-300/70 dark:bg-white/15" />
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-slate-100/60 px-2 pb-3 pt-4 dark:border-white/10 dark:bg-white/[0.05]">
                            <div className="mx-auto h-[300px] max-w-full rounded-lg bg-gradient-to-b from-slate-200/50 to-slate-100/30 dark:from-white/10 dark:to-white/[0.03]" />
                        </div>
                    </div>
                )}

                {!showSkeleton && loading && (
                    <div className="flex flex-col items-center justify-center py-20 text-sm text-slate-500 transition-opacity duration-300">
                        <div className="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
                        Loading channel analytics…
                    </div>
                )}

                {!loading && err && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 motion-safe:animate-yt-section-reveal motion-reduce:animate-none dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                        {err}
                    </div>
                )}

                {contentReady && data && (
                    <div
                        key={scopeKey}
                        className="space-y-6 motion-safe:animate-yt-section-reveal motion-reduce:animate-none"
                    >
                        <div className={`grid grid-cols-1 gap-3${userContribution != null && userContribution.viewsOnVideos > 0 ? " sm:grid-cols-2" : ""}`}>
                            <div className="rounded-xl border border-slate-200/90 bg-slate-50/90 px-4 py-3 transition-colors duration-300 dark:border-white/10 dark:bg-white/[0.04]">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    Quarter views
                                </p>
                                {data.viewsGainedInQuarter != null ? (
                                    <p className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight text-sky-700 dark:text-sky-300">
                                        {formatViews(data.viewsGainedInQuarter)}
                                    </p>
                                ) : (
                                    <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
                                        No quarter total yet.
                                    </p>
                                )}
                            </div>
                            {userContribution != null && userContribution.viewsOnVideos > 0 && (
                                <div className="rounded-xl border border-violet-200/80 bg-gradient-to-br from-violet-50/90 to-white px-4 py-3 dark:border-violet-500/20 dark:from-violet-950/30 dark:to-[#12122a]">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
                                        Your contribution
                                    </p>
                                    <p className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight text-violet-700 dark:text-violet-300">
                                        {formatViews(userContribution.viewsOnVideos)}
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="rounded-2xl border border-slate-100 bg-gradient-to-b from-slate-50/80 to-white pb-2 pt-4 transition-shadow duration-300 dark:border-white/10 dark:from-white/[0.03] dark:to-[#12122a]">
                            <ResponsiveContainer width="100%" height={340} className="[&_.recharts-surface]:outline-none">
                                <AreaChart data={chartRows} margin={{ top: 12, right: 12, left: 4, bottom: 52 }}>
                                    <defs>
                                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.45} />
                                            <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02} />
                                        </linearGradient>
                                        <linearGradient id={`${gradientId}-contrib`} x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
                                            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="4 4" stroke="rgba(148,163,184,0.35)" vertical={false} />
                                    <XAxis
                                        dataKey="label"
                                        tick={(props: any) => {
                                            const { x, y, payload } = props;
                                            const v = payload?.value ?? payload?.payload;
                                            if (v == null) return <g />;
                                            return (
                                                <g transform={`translate(${x},${y})`}>
                                                    <text
                                                        textAnchor="end"
                                                        fill="#64748b"
                                                        fontSize={9}
                                                        transform="translate(-2,6) rotate(-32)"
                                                    >
                                                        {String(v).replace(/ – /g, "–")}
                                                    </text>
                                                </g>
                                            );
                                        }}
                                        height={48}
                                        interval={0}
                                    />
                                    <YAxis
                                        width={48}
                                        tick={{ fontSize: 10, fill: "#64748b" }}
                                        tickLine={false}
                                        axisLine={{ stroke: "rgba(148,163,184,0.35)" }}
                                        tickFormatter={(v) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
                                    />
                                    <Tooltip
                                        content={({ active, payload }) => {
                                            if (!active || !payload?.length) return null;
                                            const row = payload[0].payload as (typeof chartRows)[0];
                                            return (
                                                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-white/10 dark:bg-[#1a1a30]">
                                                    <p className="font-semibold text-slate-900 dark:text-white">{row.label}</p>
                                                    <p className="mt-1 tabular-nums text-sky-700 dark:text-sky-300">{formatViews(row.views)} views</p>
                                                    {userContribution != null && row.contribution > 0 && (
                                                        <p className="mt-0.5 tabular-nums text-violet-600 dark:text-violet-300">{formatViews(row.contribution)} your contribution</p>
                                                    )}
                                                </div>
                                            );
                                        }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="views"
                                        stroke="#0ea5e9"
                                        strokeWidth={2}
                                        fill={`url(#${gradientId})`}
                                        dot={{ r: 3, fill: "#0ea5e9", strokeWidth: 0 }}
                                        activeDot={{ r: 5 }}
                                        isAnimationActive
                                        animationDuration={520}
                                        animationEasing="ease-out"
                                    />
                                    {userContribution != null && userContribution.viewsOnVideos > 0 && (
                                        <Area
                                            type="monotone"
                                            dataKey="contribution"
                                            stroke="#8b5cf6"
                                            strokeWidth={2}
                                            fill={`url(#${gradientId}-contrib)`}
                                            dot={{ r: 3, fill: "#8b5cf6", strokeWidth: 0 }}
                                            activeDot={{ r: 5 }}
                                            isAnimationActive
                                            animationDuration={520}
                                            animationEasing="ease-out"
                                        />
                                    )}
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>

                    </div>
                )}
            </div>
        </div>
    );
}
