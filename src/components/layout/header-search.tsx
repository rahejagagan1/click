"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";

// Master search in the global header. Typing ≥2 chars hits /api/search?q=…
// which fans out across Employees, Cases, Leaves, Expenses, Attendance
// requests, and Notifications. The dropdown is portalled to <body> so
// overflow:hidden on the header can't clip it.
export default function HeaderSearch() {
  const [query, setQuery]         = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen]           = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef  = useRef<HTMLDivElement>(null);
  const [, tick]  = useState(0);

  // Debounce to 220ms so we don't hammer the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 220);
    return () => clearTimeout(t);
  }, [query]);

  const shouldFetch = open && debounced.length >= 2;
  const { data, error } = useSWR(
    shouldFetch ? `/api/search?q=${encodeURIComponent(debounced)}&limit=5` : null,
    fetcher,
    { dedupingInterval: 500, keepPreviousData: true }
  );

  const groups = useMemo(() => {
    if (!data) return [];
    const g = [
      { key: "employees",     label: "People",         icon: PersonIcon,   items: data.employees     ?? [] },
      { key: "cases",         label: "Cases",          icon: FolderIcon,   items: data.cases         ?? [] },
      { key: "leaves",        label: "Leaves",         icon: LeafIcon,     items: data.leaves        ?? [] },
      { key: "expenses",      label: "Expenses",       icon: RupeeIcon,    items: data.expenses      ?? [] },
      { key: "attendance",    label: "Attendance",     icon: ClockIcon,    items: data.attendance    ?? [] },
      { key: "notifications", label: "Notifications",  icon: BellIcon,     items: data.notifications ?? [] },
    ];
    return g.filter(grp => grp.items.length > 0);
  }, [data]);

  useEffect(() => {
    if (!open) return;
    const bump = () => tick((n) => n + 1);
    window.addEventListener("resize", bump);
    window.addEventListener("scroll", bump, true);
    return () => {
      window.removeEventListener("resize", bump);
      window.removeEventListener("scroll", bump, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t))  return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const anchorRect = anchorRef.current?.getBoundingClientRect() ?? null;
  const showPanel  = open && debounced.length >= 1;
  const placeholder = useMemo(() => "Search employees or actions (Ex: Apply Leave)", []);
  const close = () => setOpen(false);
  const clear = () => { setQuery(""); setDebounced(""); };

  return (
    <div ref={anchorRef} className="relative">
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none"
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-56 rounded-full border border-white/35 bg-white px-9 py-[7px] text-[11px] text-[#1f2f3f] placeholder:text-slate-400 transition-all focus:border-white focus:outline-none focus:ring-4 focus:ring-white/20 md:w-64 lg:w-[300px]"
      />
      {query && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full text-slate-400 hover:text-slate-700 flex items-center justify-center"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      )}

      {showPanel && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            top:   (anchorRect?.bottom ?? 0) + 6,
            left:  anchorRect?.left  ?? 0,
            width: Math.max(anchorRect?.width ?? 320, 360),
            zIndex: 9999,
          }}
          className="max-h-[480px] overflow-y-auto bg-white dark:bg-[#0a1526] border border-slate-200 dark:border-white/[0.08] rounded-xl shadow-2xl"
        >
          {debounced.length < 2 ? (
            <p className="px-3 py-3 text-[12px] text-slate-400">Type at least 2 characters…</p>
          ) : error ? (
            <p className="px-3 py-3 text-[12px] text-red-500">Couldn't search</p>
          ) : !data ? (
            <p className="px-3 py-3 text-[12px] text-slate-400">Searching…</p>
          ) : groups.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-slate-400">No results for "{debounced}"</p>
          ) : (
            groups.map((grp, gi) => (
              <div key={grp.key} className={gi > 0 ? "border-t border-slate-100 dark:border-white/[0.05]" : ""}>
                <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5 bg-slate-50 dark:bg-white/[0.02]">
                  <grp.icon className="w-3 h-3 text-slate-400" />
                  <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500">
                    {grp.label} · {grp.items.length}
                  </p>
                </div>
                {grp.items.map((it: any) => (
                  <ResultRow key={`${grp.key}-${it.id}`} type={grp.key as any} item={it} onPick={close} />
                ))}
              </div>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// One row per hit — picks the right link target and subtitle per entity type.
// ─────────────────────────────────────────────────────────────────────────────
function ResultRow({ type, item, onPick }: { type: string; item: any; onPick: () => void }) {
  const { href, title, subtitle, tag } = rowInfo(type, item);

  return (
    <Link
      href={href}
      onClick={onPick}
      className="block px-3 py-2 hover:bg-[#008CFF]/[0.06] dark:hover:bg-[#008CFF]/[0.1] transition-colors"
    >
      <div className="flex items-center gap-2">
        <p className="text-[12.5px] font-medium text-slate-800 dark:text-white truncate flex-1 leading-snug">
          {title}
        </p>
        {tag && (
          <span className="text-[9.5px] uppercase tracking-wider font-semibold text-[#008CFF] shrink-0">
            {tag}
          </span>
        )}
      </div>
      {subtitle && (
        <p className="text-[10.5px] text-slate-500 truncate mt-0.5">{subtitle}</p>
      )}
    </Link>
  );
}

function rowInfo(type: string, it: any): { href: string; title: string; subtitle?: string; tag?: string } {
  const fmtDate = (s?: string) => s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "";
  switch (type) {
    case "employees":
      return {
        href: `/dashboard/hr/admin/people/${it.id}`,
        title: it.name,
        subtitle: [it.email, it.teamCapsule].filter(Boolean).join(" · "),
        tag: it.orgLevel && it.orgLevel !== "member" ? String(it.orgLevel).replace("_", " ") : undefined,
      };
    case "cases":
      return {
        href: `/cases/${it.id}`,
        title: it.name || "Untitled case",
        subtitle: [it.clickupTaskId && `#${String(it.clickupTaskId).slice(0, 10)}`, it.channel].filter(Boolean).join(" · "),
        tag: it.status,
      };
    case "leaves":
      return {
        href: `/dashboard/hr/leaves`,
        title: `${it.user?.name || "Employee"} · ${it.leaveType?.name || "Leave"}`,
        subtitle: `${fmtDate(it.fromDate)}${it.fromDate !== it.toDate ? ` → ${fmtDate(it.toDate)}` : ""}${it.reason ? ` · ${it.reason}` : ""}`,
        tag: it.status,
      };
    case "expenses":
      return {
        href: `/dashboard/hr/expenses`,
        title: `${it.title || "Expense"} — ₹${Number(it.amount || 0).toLocaleString("en-IN")}`,
        subtitle: `${it.user?.name || ""} · ${it.category || ""}`,
        tag: it.status,
      };
    case "attendance": {
      const label = it.kind === "wfh" ? "WFH" : it.kind === "on_duty" ? "On Duty" : "Regularize";
      return {
        href: `/dashboard/hr/attendance`,
        title: `${it.user?.name || "Employee"} · ${label}`,
        subtitle: `${fmtDate(it.date)}${it.reason ? ` · ${it.reason}` : it.purpose ? ` · ${it.purpose}` : ""}`,
        tag: it.status,
      };
    }
    case "notifications":
      return {
        href: it.linkUrl || "/dashboard/hr/inbox",
        title: it.title,
        subtitle: it.body || "",
        tag: it.isRead ? undefined : "NEW",
      };
  }
  return { href: "#", title: "Unknown" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny inline icons (no extra imports — keeps bundle slim).
// ─────────────────────────────────────────────────────────────────────────────
function PersonIcon(p: any) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...p}><circle cx="12" cy="8" r="3.5"/><path d="M4 20c1.5-4 5-6 8-6s6.5 2 8 6" strokeLinecap="round"/></svg>;
}
function FolderIcon(p: any) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...p}><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function LeafIcon(p: any) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...p}><path d="M4 20C4 12 10 4 20 4c0 10-6 16-14 16H4z" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function RupeeIcon(p: any) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...p}><path d="M7 5h10M7 9h10M7 13h3c3 0 5-1.5 5-4M7 19l7-6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function ClockIcon(p: any) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...p}><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2" strokeLinecap="round"/></svg>;
}
function BellIcon(p: any) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...p}><path d="M6 16V11a6 6 0 1112 0v5l2 2H4l2-2zM10 20a2 2 0 004 0" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
