"use client";
import { useEffect, useState } from "react";

/**
 * Three-dropdown date picker (Day / Month / Year) used everywhere a
 * native `<input type="date">` would otherwise pop a clunky browser
 * widget. Each select holds its own state so partial picks stick
 * before all three are filled. Once complete it emits `YYYY-MM-DD` —
 * drop-in compatible with the existing date-string form storage.
 *
 * Props:
 *   value      — current date as YYYY-MM-DD or "".
 *   onChange   — fired with the new YYYY-MM-DD (or "" while incomplete).
 *   yearStart  — first year shown in the dropdown (default 1900).
 *   yearEnd    — last year shown (default currentYear).
 *   futureYears— if set, extends yearEnd to currentYear + futureYears
 *                (handy for joining/expense/leave dates).
 *   className  — custom class on each <select> (defaults to a brand-blue
 *                outlined input style).
 */
export function DatePicker({
  value,
  onChange,
  yearStart = 1900,
  yearEnd,
  futureYears,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  yearStart?: number;
  yearEnd?: number;
  futureYears?: number;
  className?: string;
}) {
  const today = new Date();
  const thisYear = today.getFullYear();
  const effectiveEnd =
    yearEnd ?? (futureYears != null ? thisYear + futureYears : thisYear);

  const parse = (v: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "");
    return m ? { y: m[1], m: m[2], d: m[3] } : { y: "", m: "", d: "" };
  };
  const initial = parse(value);
  const [yy, setYy] = useState(initial.y);
  const [mm, setMm] = useState(initial.m);
  const [dd, setDd] = useState(initial.d);

  // Sync from prop changes (modal reopen, form reset, etc.) without
  // clobbering in-progress local edits.
  useEffect(() => {
    const here = yy && mm && dd ? `${yy}-${mm}-${dd}` : "";
    if (value === here) return;
    const next = parse(value);
    setYy(next.y); setMm(next.m); setDd(next.d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Whenever any field changes, emit a complete date or "" upstream.
  useEffect(() => {
    if (yy && mm && dd) {
      // Clamp the day if the new month/year doesn't accommodate it
      // (e.g. picked Feb 31 then switched to a non-leap year).
      const last = new Date(parseInt(yy, 10), parseInt(mm, 10), 0).getDate();
      const safe = parseInt(dd, 10) > last ? String(last).padStart(2, "0") : dd;
      const next = `${yy}-${mm}-${safe}`;
      if (safe !== dd) setDd(safe);
      if (next !== value) onChange(next);
    } else if (value) {
      onChange("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yy, mm, dd]);

  const months = [
    { v: "01", n: "January"   }, { v: "02", n: "February" }, { v: "03", n: "March"     },
    { v: "04", n: "April"     }, { v: "05", n: "May"      }, { v: "06", n: "June"      },
    { v: "07", n: "July"      }, { v: "08", n: "August"   }, { v: "09", n: "September" },
    { v: "10", n: "October"   }, { v: "11", n: "November" }, { v: "12", n: "December"  },
  ];

  // Years descending so today / recent years sit at the top.
  const years: string[] = [];
  for (let y = effectiveEnd; y >= yearStart; y--) years.push(String(y));

  // Days adjust to chosen month/year (28-31; handles leap Februarys).
  const daysInMonth = (() => {
    if (!mm) return 31;
    const monthNum = parseInt(mm, 10);
    const yearNum  = parseInt(yy || String(thisYear), 10);
    return new Date(yearNum, monthNum, 0).getDate();
  })();
  const days = Array.from({ length: daysInMonth }, (_, i) => String(i + 1).padStart(2, "0"));

  const cls = className ?? "h-9 px-2 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none focus:border-[#008CFF] cursor-pointer";

  return (
    <div className="grid grid-cols-3 gap-2">
      <select value={dd} onChange={(e) => setDd(e.target.value)} className={cls} aria-label="Day">
        <option value="">Day</option>
        {days.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      <select value={mm} onChange={(e) => setMm(e.target.value)} className={cls} aria-label="Month">
        <option value="">Month</option>
        {months.map((m) => <option key={m.v} value={m.v}>{m.n}</option>)}
      </select>
      <select value={yy} onChange={(e) => setYy(e.target.value)} className={cls} aria-label="Year">
        <option value="">Year</option>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}

export default DatePicker;
