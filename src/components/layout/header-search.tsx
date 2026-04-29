"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";

// Static jump list — common dashboard pages that should be reachable
// from search-as-you-type. Filtered by substring match on `label` so
// typing "att" surfaces Attendance, "leav" surfaces Leaves, etc.
const PAGE_LINKS: { label: string; href: string; hint?: string }[] = [
  { label: "Home",               href: "/dashboard/hr/home",            hint: "Dashboard"  },
  { label: "Attendance",         href: "/dashboard/hr/attendance",      hint: "Logs / clock-in" },
  { label: "Leaves",             href: "/dashboard/hr/leaves",          hint: "Apply / balances" },
  { label: "Approvals",          href: "/dashboard/hr/approvals",       hint: "Manager / HR" },
  { label: "People",             href: "/dashboard/hr/people",          hint: "Directory" },
  { label: "HR Dashboard",       href: "/dashboard/hr/admin",           hint: "Admin"      },
  { label: "Holidays",           href: "/dashboard/hr/admin/holidays",  hint: "Calendar"   },
  { label: "Inbox",              href: "/dashboard/hr/inbox",           hint: "Pending requests" },
  { label: "My Team",            href: "/dashboard/hr/my-team",                            },
  { label: "Goals",              href: "/dashboard/hr/goals",                              },
  { label: "Documents",          href: "/dashboard/hr/documents",                          },
  { label: "Tickets",            href: "/dashboard/hr/tickets",                            },
  { label: "Tools",              href: "/dashboard/tools",                                 },
];

// Global header search — multi-source, debounced, keyboard-friendly.
// Hits People (/api/hr/employees) and Cases (/api/cases) in parallel
// once the user has typed ≥ 2 chars, plus a static Pages jump list.
// Dropdown portals to body so overflow:hidden on the header can't clip it.
export default function HeaderSearch() {
  const [query, setQuery]         = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen]           = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef  = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);
  // Bump tick on resize/scroll so the portalled panel re-reads anchor rect.
  const [, tick]  = useState(0);

  // Debounce to 220ms so we don't hammer the APIs on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 220);
    return () => clearTimeout(t);
  }, [query]);

  // Cmd/Ctrl+K focuses the search bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const shouldFetch = open && debounced.length >= 2;

  const { data: peopleData, error: peopleErr } = useSWR(
    shouldFetch ? `/api/hr/employees?search=${encodeURIComponent(debounced)}` : null,
    fetcher,
    { dedupingInterval: 500, keepPreviousData: true },
  );
  const { data: casesData, error: casesErr } = useSWR(
    shouldFetch ? `/api/cases?search=${encodeURIComponent(debounced)}&limit=6` : null,
    fetcher,
    { dedupingInterval: 500, keepPreviousData: true },
  );

  const people: any[] = Array.isArray(peopleData) ? peopleData.slice(0, 6) : [];
  const cases:  any[] = Array.isArray(casesData?.cases) ? casesData.cases
                       : Array.isArray(casesData) ? casesData : [];
  const pageMatches = useMemo(() => {
    if (debounced.length < 2) return [];
    const q = debounced.toLowerCase();
    return PAGE_LINKS.filter((p) =>
      p.label.toLowerCase().includes(q) || (p.hint && p.hint.toLowerCase().includes(q)),
    ).slice(0, 5);
  }, [debounced]);

  const totalResults = people.length + cases.length + pageMatches.length;
  const isLoading    = shouldFetch && !peopleData && !casesData;
  const hasError     = peopleErr || casesErr;

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
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search people, pages, cases…"
        className="w-52 md:w-64 lg:w-80 pl-9 pr-12 py-1.5 bg-[#e9eef4] border border-[#c8d2de] rounded-full text-[12px] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2563eb]/15 focus:border-[#93c5fd] transition-all text-[#1f2f3f]"
      />
      {query ? (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full text-slate-400 hover:text-slate-700 flex items-center justify-center"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      ) : (
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 hidden md:inline-flex items-center gap-0.5 rounded border border-slate-300/70 bg-white/60 px-1.5 py-0.5 text-[9.5px] font-medium text-slate-500 pointer-events-none">
          ⌘K
        </kbd>
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
          ) : isLoading ? (
            <p className="px-3 py-3 text-[12px] text-slate-400">Searching…</p>
          ) : hasError && totalResults === 0 ? (
            <p className="px-3 py-3 text-[12px] text-rose-500">Search failed — try again.</p>
          ) : totalResults === 0 ? (
            <p className="px-3 py-3 text-[12px] text-slate-400">No results for "{debounced}"</p>
          ) : (
            <>
              {/* People */}
              {people.length > 0 && (
                <Section label={`People · ${people.length}`}>
                  {people.map((u: any) => {
                    const initials = (u.name || "?").split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase();
                    const dept = u.employeeProfile?.department;
                    const desg = u.employeeProfile?.designation;
                    return (
                      <Link
                        key={`p-${u.id}`}
                        href={`/dashboard/hr/people/${u.id}`}
                        onClick={close}
                        className="flex items-center gap-2.5 px-3 py-2 border-b border-slate-100 dark:border-white/[0.04] last:border-b-0 hover:bg-[#008CFF]/[0.06] dark:hover:bg-[#008CFF]/[0.1] transition-colors"
                      >
                        {u.profilePictureUrl ? (
                          <img src={u.profilePictureUrl} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />
                        ) : (
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#008CFF] text-[10px] font-bold text-white">{initials}</span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-[12.5px] font-medium text-slate-800 dark:text-white truncate leading-snug">{u.name}</p>
                          <p className="text-[10.5px] text-slate-500 truncate">
                            {desg ? `${desg}${dept ? ` · ${dept}` : ""}` : u.email}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </Section>
              )}

              {/* Pages */}
              {pageMatches.length > 0 && (
                <Section label={`Pages · ${pageMatches.length}`}>
                  {pageMatches.map((p) => (
                    <Link
                      key={`g-${p.href}`}
                      href={p.href}
                      onClick={close}
                      className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-100 dark:border-white/[0.04] last:border-b-0 hover:bg-[#008CFF]/[0.06] dark:hover:bg-[#008CFF]/[0.1] transition-colors"
                    >
                      <span className="text-[12.5px] font-medium text-slate-800 dark:text-white">{p.label}</span>
                      {p.hint && <span className="text-[10.5px] text-slate-400 truncate">{p.hint}</span>}
                    </Link>
                  ))}
                </Section>
              )}

              {/* Cases */}
              {cases.length > 0 && (
                <Section label={`Cases · ${cases.length}`}>
                  {cases.map((c: any) => {
                    const title  = c.title || c.name || "Untitled";
                    const status = c.status || c.statusType || "";
                    return (
                      <Link
                        key={`c-${c.id}`}
                        href={`/cases/${c.id}`}
                        onClick={close}
                        className="block px-3 py-2 border-b border-slate-100 dark:border-white/[0.04] last:border-b-0 hover:bg-[#008CFF]/[0.06] dark:hover:bg-[#008CFF]/[0.1] transition-colors"
                      >
                        <p className="text-[12.5px] font-medium text-slate-800 dark:text-white truncate leading-snug">{title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {c.clickupTaskId && (
                            <span className="text-[10px] font-mono text-slate-400">#{String(c.clickupTaskId).slice(0, 10)}</span>
                          )}
                          {status && (
                            <span className="text-[10px] uppercase tracking-wide font-semibold text-[#008CFF]">{status}</span>
                          )}
                          {c.channel && (
                            <span className="text-[10px] text-slate-500 truncate">{c.channel}</span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </Section>
              )}
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="px-3 py-1.5 text-[10px] uppercase tracking-widest font-semibold text-slate-400 border-b border-slate-100 dark:border-white/[0.05] bg-slate-50/60 dark:bg-white/[0.02]">
        {label}
      </p>
      {children}
    </div>
  );
}
