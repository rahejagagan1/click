import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// BigInt serialization for JSON responses
export function serializeBigInt<T>(obj: T): T {
    return JSON.parse(
        JSON.stringify(obj, (_, value) =>
            typeof value === "bigint" ? value.toString() : value
        )
    );
}

// Delay helper for rate limiting
export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Average helper (ignores null/undefined/NaN values)
export function avg(values: (number | null | undefined)[]): number {
    const valid = values.filter(
        (v): v is number => v !== null && v !== undefined && !isNaN(v)
    );
    if (valid.length === 0) return 0;
    return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

// Format number for display
export function formatNumber(num: number | bigint | null | undefined): string {
    if (num === null || num === undefined) return "—";
    const n = typeof num === "bigint" ? Number(num) : num;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
}

// Date formatting
export function formatDate(date: Date | string | null | undefined): string {
    if (!date) return "—";
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

// Derive short name from ClickUp folder/list name
export function deriveShortName(name: string): string {
    // "01. CIA (NEW)" → "CIA"
    // "02. RAW6 (NEW)" → "RAW6"
    // "Production Dec 2025 To Jan 2026" → "Production Dec 2025 To Jan 2026"
    const match = name.match(/^\d+\.\s*(.+?)(?:\s*\(.*\))?$/);
    if (match) return match[1].trim();
    return name;
}

/**
 * Calculate TAT in business days with half-day precision.
 *
 * Rules:
 *  - Weekends (Sat/Sun) are skipped entirely.
 *  - Each full working day from start → day-before-done = 1 day.
 *  - On the done day: hour < 12 → +0 (morning); hour >= 12 → +0.5 (afternoon).
 *  - Same-day sub-hour completions: raw hours are returned as a decimal (e.g. 0.1).
 *
 * Examples:
 *   Mon 9am → Fri 2pm  = 4.5d
 *   Mon 9am → Mon 2pm  = 0.5d
 *   Mon 9am → Fri 9am  = 4.0d
 *   Mon 9am → Mon 9am  = 0.0d  (same moment)
 */
/** Returns total elapsed hours between start and done (calendar time). */
export function calcBusinessDaysTat(start: Date, done: Date): number {
    if (done <= start) return 0;
    return (done.getTime() - start.getTime()) / (1000 * 60 * 60);
}

/**
 * Format a TAT value (in hours) for display.
 * e.g.  15   → "15h"
 *        26   → "1d 2h"
 *        24   → "1d"
 *         0.5 → "30m"
 */
export function formatTatDays(hours: number): string {
    if (hours <= 0) return "Same day";
    const totalMins = Math.round(hours * 60);
    if (totalMins < 60) return `${totalMins}m`;
    const totalHours = Math.floor(totalMins / 60);
    const mins       = totalMins % 60;
    if (totalHours < 24) return mins > 0 ? `${totalHours}h ${mins}m` : `${totalHours}h`;
    const days       = Math.floor(totalHours / 24);
    const remHours   = totalHours % 24;
    if (remHours === 0) return mins > 0 ? `${days}d ${mins}m` : `${days}d`;
    return mins > 0 ? `${days}d ${remHours}h ${mins}m` : `${days}d ${remHours}h`;
}

// Status color mapping
export function getStatusColor(status: string): string {
    const normalized = status.toLowerCase();
    if (normalized === "complete" || normalized === "published" || normalized === "done")
        return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    if (normalized.includes("progress") || normalized.includes("editing") || normalized.includes("scripting"))
        return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    if (normalized.includes("qa") || normalized.includes("review") || normalized.includes("check"))
        return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    if (normalized.includes("revision"))
        return "bg-purple-500/20 text-purple-400 border-purple-500/30";
    if (normalized === "to do" || normalized === "open")
        return "bg-slate-500/20 text-slate-400 border-slate-500/30";
    return "bg-slate-500/20 text-slate-400 border-slate-500/30";
}

// Channel color mapping
export function getChannelColor(channel: string | null): string {
    switch (channel) {
        case "M7":
            return "bg-red-500/20 text-red-400 border-red-500/30";
        case "M7CS":
            return "bg-orange-500/20 text-orange-400 border-orange-500/30";
        case "Bodycam":
            return "bg-cyan-500/20 text-cyan-400 border-cyan-500/30";
        case "3D Documentry":
            return "bg-violet-500/20 text-violet-400 border-violet-500/30";
        case "New Channel":
            return "bg-green-500/20 text-green-400 border-green-500/30";
        default:
            return "bg-slate-500/20 text-slate-400 border-slate-500/30";
    }
}
