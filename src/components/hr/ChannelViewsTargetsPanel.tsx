"use client";

// Employee-side panel showing per-channel quarterly view targets vs current views.
// Fetches /api/me/view-targets and lets the viewer toggle between
// the current quarter and the full year. Pure read-only display.

import { useState } from "react";
import useSWR from "swr";
import { ArrowUp } from "lucide-react";
import { fetcher } from "@/lib/swr";

type ChannelRow = {
  channelId: string;
  channelName: string;
  // Current quarter
  quarterViews: number;
  quarterTarget: number | null;
  // Full year
  yearViews: number;
  yearTarget: number | null;
};

type Payload = {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  channels: ChannelRow[];
};

const QUARTER_LABEL: Record<1 | 2 | 3 | 4, string> = {
  1: "Jan-Mar",
  2: "Apr-Jun",
  3: "Jul-Sep",
  4: "Oct-Dec",
};

// Small palette for the channel initials chip — keep brand-friendly tones.
const CIRCLE_PALETTE: Array<{ bg: string; text: string }> = [
  { bg: "bg-blue-100", text: "text-blue-700" },
  { bg: "bg-violet-100", text: "text-violet-700" },
  { bg: "bg-rose-100", text: "text-rose-700" },
  { bg: "bg-amber-100", text: "text-amber-700" },
  { bg: "bg-emerald-100", text: "text-emerald-700" },
  { bg: "bg-cyan-100", text: "text-cyan-700" },
];

function hashToPalette(name: string): { bg: string; text: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return CIRCLE_PALETTE[h % CIRCLE_PALETTE.length];
}

function initials(name: string): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "··";
  // First two visible chars (after collapsing whitespace).
  const compact = trimmed.replace(/\s+/g, "");
  return compact.slice(0, 2).toUpperCase();
}

function formatLocale(n: number): string {
  return Number(n || 0).toLocaleString("en-IN");
}

function formatAbbrev(n: number): string {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(v);
}

function clampPct(views: number, target: number | null): number {
  if (!target || target <= 0) return 0;
  const pct = (views / target) * 100;
  if (!Number.isFinite(pct)) return 0;
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

function rawPct(views: number, target: number | null): number {
  if (!target || target <= 0) return 0;
  const pct = (views / target) * 100;
  return Number.isFinite(pct) ? pct : 0;
}

type Mode = "quarter" | "year";

export default function ChannelViewsTargetsPanel() {
  const { data, error, isLoading } = useSWR<Payload>(
    "/api/me/view-targets",
    fetcher,
    { refreshInterval: 300_000 }
  );
  const [mode, setMode] = useState<Mode>("quarter");

  const year = data?.year ?? new Date().getFullYear();
  const quarter = (data?.quarter ?? 1) as 1 | 2 | 3 | 4;
  const subtitle = `Q${quarter} ${year} · ${QUARTER_LABEL[quarter]}`;

  return (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 overflow-hidden">
      {/* Header strip */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-4 border-b border-slate-100">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Quarterly Targets</h2>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        <div
          role="tablist"
          aria-label="Targets period"
          className="inline-flex items-center rounded-full bg-slate-100 p-1 text-xs font-medium"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "quarter"}
            onClick={() => setMode("quarter")}
            className={
              "px-3 py-1.5 rounded-full transition-all " +
              (mode === "quarter"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700")
            }
          >
            This Quarter
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "year"}
            onClick={() => setMode("year")}
            className={
              "px-3 py-1.5 rounded-full transition-all " +
              (mode === "year"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700")
            }
          >
            This Year
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-4">
        {isLoading && !data ? (
          <SkeletonRows />
        ) : error ? (
          <div className="py-10 text-center text-sm text-rose-600">
            Could not load targets right now.
          </div>
        ) : !data || data.channels.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">
            No channels configured yet.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.channels.map((c) => (
              <ChannelRowItem key={c.channelId} row={c} mode={mode} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ChannelRowItem({ row, mode }: { row: ChannelRow; mode: Mode }) {
  const views = mode === "quarter" ? row.quarterViews : row.yearViews;
  const target = mode === "quarter" ? row.quarterTarget : row.yearTarget;
  const hasTarget = !!target && target > 0;
  const pctClamped = clampPct(views, target);
  const pctRaw = rawPct(views, target);
  const reached = hasTarget && pctRaw >= 100;
  const palette = hashToPalette(row.channelName);
  const viewsLocale = formatLocale(views);
  const targetLocale = target != null ? formatLocale(target) : "—";

  return (
    <li className="py-4 first:pt-2 last:pb-2">
      <div className="flex items-start gap-3">
        {/* Initials chip */}
        <div
          className={
            "flex-none h-10 w-10 rounded-full flex items-center justify-center text-xs font-semibold " +
            palette.bg +
            " " +
            palette.text
          }
          aria-hidden
        >
          {initials(row.channelName)}
        </div>

        <div className="flex-1 min-w-0">
          {/* Top line: name + headline number + percent */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 truncate">
                {row.channelName}
              </div>
              <div
                className="text-xl font-bold text-slate-900 leading-tight mt-0.5"
                title={viewsLocale}
              >
                {formatAbbrev(views)}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                Target {hasTarget ? formatAbbrev(target!) : "—"}
                {hasTarget ? (
                  <span className="sr-only"> ({targetLocale})</span>
                ) : null}
              </div>
            </div>

            <div className="flex-none flex items-center gap-1 text-right">
              {hasTarget ? (
                <>
                  <span
                    className={
                      "text-sm font-semibold " +
                      (reached ? "text-emerald-600" : "text-slate-700")
                    }
                  >
                    {Math.round(pctRaw)}%
                  </span>
                  {reached ? (
                    <ArrowUp className="h-4 w-4 text-emerald-600" aria-hidden />
                  ) : null}
                </>
              ) : (
                <span className="text-xs italic text-slate-400">No target set</span>
              )}
            </div>
          </div>

          {/* Progress / no-target */}
          <div className="mt-2">
            {hasTarget ? (
              <div
                className="h-2.5 rounded-full bg-slate-100 overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(pctClamped)}
                aria-label={`${row.channelName} progress`}
              >
                <div
                  className={
                    "h-full rounded-full transition-all duration-500 " +
                    (reached ? "bg-emerald-500" : "")
                  }
                  style={{
                    width: `${pctClamped}%`,
                    backgroundColor: reached ? undefined : "#3b82f6",
                  }}
                />
              </div>
            ) : (
              <div className="text-xs italic text-slate-400">No target set</div>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function SkeletonRows() {
  return (
    <ul className="divide-y divide-slate-100">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="py-4 first:pt-2 last:pb-2">
          <div className="flex items-start gap-3 animate-pulse">
            <div className="h-10 w-10 rounded-full bg-slate-100 flex-none" />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="h-3 w-32 rounded bg-slate-100" />
              <div className="h-5 w-24 rounded bg-slate-100" />
              <div className="h-2.5 w-full rounded-full bg-slate-100" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
