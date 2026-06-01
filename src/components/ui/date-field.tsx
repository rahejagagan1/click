"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Date input that ALWAYS displays as dd/mm/yyyy regardless of browser
 * locale, and opens a CUSTOM calendar popup (not the OS-native one).
 *
 * Why custom instead of <input type="date">: the native picker follows
 * the browser locale (mm/dd/yyyy on en-US) and — more importantly — has
 * no quick way to jump years, so picking a date of birth or an old
 * joining date meant clicking month-by-month. This popup has explicit
 * Month + Year dropdowns so any date (and any year) is two clicks away.
 *
 * Stores YYYY-MM-DD upstream (drop-in for the existing form state and
 * the API contract, which uses ISO date strings everywhere).
 *
 * The popup renders through a portal with fixed positioning so it is
 * never clipped by an `overflow-hidden` parent card / modal.
 *
 * Props:
 *   value     — current date as YYYY-MM-DD or "".
 *   onChange  — fired with the new YYYY-MM-DD (or "" when cleared).
 *   min       — earliest allowed date (YYYY-MM-DD).
 *   max       — latest allowed date (YYYY-MM-DD).
 *   disabled  — disables the field.
 *   className — extra classes on the outer wrapper.
 *   placeholder — text shown when empty (default "dd/mm/yyyy").
 *   compact   — h-8 instead of h-9 for tighter layouts.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const pad = (n: number) => String(n).padStart(2, "0");
const toISO = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
// m is 1-12. Compare dates as plain numbers to avoid any timezone drift.
const cmp = (y: number, m: number, d: number) => y * 10000 + m * 100 + d;

function parseISO(v: string | undefined): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "");
  if (!match) return null;
  return { y: +match[1], m: +match[2], d: +match[3] };
}

function daysInMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate(); // m is 1-12; day 0 of next month = last day of m
}
function firstWeekdayOf(y: number, m: number) {
  return new Date(y, m - 1, 1).getDay(); // 0=Sun..6=Sat
}

export function DateField({
  value,
  onChange,
  min,
  max,
  disabled,
  className,
  placeholder = "dd/mm/yyyy",
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  compact?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const selected = parseISO(value);
  const today = new Date();
  const todayParts = { y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() };

  const minP = parseISO(min);
  const maxP = parseISO(max);
  const minYear = minP ? minP.y : todayParts.y - 80;
  const maxYear = maxP ? maxP.y : todayParts.y + 10;
  // Year list, newest first so recent years are right at the top of the
  // dropdown (most date entry is "this year-ish", DOB scrolls down).
  const years: number[] = [];
  for (let y = maxYear; y >= minYear; y--) years.push(y);

  // The month currently being viewed in the popup. Seeded from the
  // selected value, else today (clamped into the allowed range).
  const seed = selected ?? todayParts;
  const [view, setView] = useState<{ y: number; m: number }>({ y: seed.y, m: seed.m });

  const display = selected ? `${pad(selected.d)}/${pad(selected.m)}/${selected.y}` : "";
  const h = compact ? "h-8" : "h-9";

  const computePosition = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const popHeight = 290; // approx; used only to decide above/below
    const below = window.innerHeight - r.bottom;
    const openUp = below < popHeight && r.top > below;
    const width = 236; // fixed compact width — never stretches to the field
    let left = r.left;
    // Keep the popup inside the viewport horizontally.
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    if (left < 8) left = 8;
    setPos({
      top: openUp ? Math.max(8, r.top - popHeight - 6) : r.bottom + 6,
      left,
      width,
    });
  };

  const openCalendar = () => {
    if (disabled) return;
    const base = parseISO(value) ?? todayParts;
    setView({ y: base.y, m: base.m });
    computePosition();
    setOpen(true);
  };

  // Reposition synchronously before paint so the popup never flashes in
  // the wrong spot when it first opens.
  useLayoutEffect(() => {
    if (open) computePosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => computePosition();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isDisabledDay = (y: number, m: number, d: number) => {
    if (minP && cmp(y, m, d) < cmp(minP.y, minP.m, minP.d)) return true;
    if (maxP && cmp(y, m, d) > cmp(maxP.y, maxP.m, maxP.d)) return true;
    return false;
  };

  const canGoPrev = () => {
    // disable the ◀ arrow once the whole previous month is before min
    if (!minP) return view.y > minYear || view.m > 1;
    const pm = view.m === 1 ? { y: view.y - 1, m: 12 } : { y: view.y, m: view.m - 1 };
    return cmp(pm.y, pm.m, daysInMonth(pm.y, pm.m)) >= cmp(minP.y, minP.m, minP.d);
  };
  const canGoNext = () => {
    if (!maxP) return view.y < maxYear || view.m < 12;
    const nm = view.m === 12 ? { y: view.y + 1, m: 1 } : { y: view.y, m: view.m + 1 };
    return cmp(nm.y, nm.m, 1) <= cmp(maxP.y, maxP.m, maxP.d);
  };

  const goPrev = () => setView((v) => (v.m === 1 ? { y: v.y - 1, m: 12 } : { y: v.y, m: v.m - 1 }));
  const goNext = () => setView((v) => (v.m === 12 ? { y: v.y + 1, m: 1 } : { y: v.y, m: v.m + 1 }));

  const pick = (d: number) => {
    onChange(toISO(view.y, view.m, d));
    setOpen(false);
  };

  // Build the day grid for the viewed month.
  const lead = firstWeekdayOf(view.y, view.m);
  const total = daysInMonth(view.y, view.m);
  const cells: (number | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);

  const popup = open && pos ? createPortal(
    <div
      ref={popRef}
      // The popup is portaled to <body>, but React events still bubble up
      // the React tree to the wrapper's onClick={openCalendar} — which
      // would reset the view (month/year) and reopen on every interaction.
      // Stop propagation here so the calendar's own clicks stay contained.
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
      className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-[0_8px_30px_rgba(15,23,42,0.18)]"
    >
      {/* Header: prev | month + year selects | next */}
      <div className="mb-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={goPrev}
          disabled={!canGoPrev()}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="Previous month"
        >
          <ChevronLeft size={16} />
        </button>
        <select
          value={view.m}
          onChange={(e) => setView((v) => ({ ...v, m: +e.target.value }))}
          className="h-7 flex-1 rounded-md border border-slate-200 bg-white px-1.5 text-[12.5px] font-medium text-slate-700 focus:border-[#3b82f6] focus:outline-none"
        >
          {MONTHS.map((name, i) => (
            <option key={name} value={i + 1}>{name}</option>
          ))}
        </select>
        <select
          value={view.y}
          onChange={(e) => setView((v) => ({ ...v, y: +e.target.value }))}
          className="h-7 w-[72px] shrink-0 rounded-md border border-slate-200 bg-white px-1.5 text-[12.5px] font-medium text-slate-700 focus:border-[#3b82f6] focus:outline-none"
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={goNext}
          disabled={!canGoNext()}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="Next month"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Weekday row */}
      <div className="mb-1 grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-0.5 text-center text-[10px] font-semibold uppercase text-slate-400">{w}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          if (d === null) return <div key={`b${i}`} />;
          const isSel = !!selected && selected.y === view.y && selected.m === view.m && selected.d === d;
          const isToday = todayParts.y === view.y && todayParts.m === view.m && todayParts.d === d;
          const off = isDisabledDay(view.y, view.m, d);
          return (
            <button
              key={d}
              type="button"
              disabled={off}
              onClick={() => pick(d)}
              className={[
                "flex h-7 items-center justify-center rounded-md text-[12px] tabular-nums transition-colors",
                off ? "cursor-not-allowed text-slate-300" : "text-slate-700 hover:bg-slate-100",
                isSel ? "!bg-[#3b82f6] font-semibold !text-white hover:!bg-[#2563eb]" : "",
                !isSel && isToday ? "font-semibold text-[#3b82f6] ring-1 ring-inset ring-[#3b82f6]/40" : "",
              ].join(" ")}
            >
              {d}
            </button>
          );
        })}
      </div>

      {/* Footer: Today + Clear */}
      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
        <button
          type="button"
          onClick={() => {
            if (!isDisabledDay(todayParts.y, todayParts.m, todayParts.d)) {
              onChange(toISO(todayParts.y, todayParts.m, todayParts.d));
              setOpen(false);
            }
          }}
          disabled={isDisabledDay(todayParts.y, todayParts.m, todayParts.d)}
          className="rounded-md px-2 py-1 text-[12px] font-medium text-[#3b82f6] hover:bg-[#3b82f6]/10 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => { onChange(""); setOpen(false); }}
          className="rounded-md px-2 py-1 text-[12px] font-medium text-slate-500 hover:bg-slate-100"
        >
          Clear
        </button>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div
      ref={wrapRef}
      onClick={openCalendar}
      style={className?.match(/\bw-/) ? undefined : { width: "160px" }}
      className={`relative inline-flex items-center ${disabled ? "" : "cursor-pointer"} ${className ?? ""}`}
    >
      <div
        className={`flex w-full items-center ${h} rounded-lg border px-3 pr-9 bg-white text-[13px] ${
          open ? "border-[#3b82f6] ring-2 ring-[#3b82f6]/15" : "border-slate-200"
        } ${disabled ? "opacity-60" : ""}`}
      >
        <span className={display ? "text-slate-800" : "text-slate-400"}>
          {display || placeholder}
        </span>
      </div>
      <Calendar size={14} className="pointer-events-none absolute right-3 text-slate-500" />
      {popup}
    </div>
  );
}
