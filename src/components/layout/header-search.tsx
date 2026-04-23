"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";

// Debounced live-search for cases in the global header.
// Typing >=2 chars hits /api/cases?search=…&limit=8; dropdown is portalled to
// body so overflow:hidden on the header can't clip it.
export default function HeaderSearch() {
  const [query, setQuery]     = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen]       = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef  = useRef<HTMLDivElement>(null);
  // Bump to force-rerender so the portalled panel re-reads the anchor rect
  // on scroll / resize.
  const [, tick]  = useState(0);

  // Debounce to 220ms so we don't hammer the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 220);
    return () => clearTimeout(t);
  }, [query]);

  const shouldFetch = open && debounced.length >= 2;
  const { data, error } = useSWR(
    shouldFetch ? `/api/cases?search=${encodeURIComponent(debounced)}&limit=8` : null,
    fetcher,
    { dedupingInterval: 500, keepPreviousData: true }
  );
  const results: any[] = Array.isArray(data?.cases) ? data.cases : Array.isArray(data) ? data : [];

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
  const showPanel = open && debounced.length >= 1;

  const placeholder = useMemo(() => "Search cases...", []);

  const close = () => { setOpen(false); };
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
        className="w-52 md:w-56 lg:w-64 pl-9 pr-8 py-1.5 bg-[#e9eef4] border border-[#c8d2de] rounded-full text-[12px] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2563eb]/15 focus:border-[#93c5fd] transition-all text-[#1f2f3f]"
      />
      {query && (
        <button
          type="button"
          onClick={() => { clear(); }}
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
            width: anchorRect?.width ?? 256,
            zIndex: 9999,
          }}
          className="max-h-[420px] overflow-y-auto bg-white dark:bg-[#0a1526] border border-slate-200 dark:border-white/[0.08] rounded-xl shadow-2xl"
        >
          {debounced.length < 2 ? (
            <p className="px-3 py-3 text-[12px] text-slate-400">Type at least 2 characters…</p>
          ) : error ? (
            <p className="px-3 py-3 text-[12px] text-red-500">Couldn't search cases</p>
          ) : !data ? (
            <p className="px-3 py-3 text-[12px] text-slate-400">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-slate-400">No cases found for "{debounced}"</p>
          ) : (
            <>
              <p className="px-3 py-2 text-[10px] uppercase tracking-widest font-semibold text-slate-400 border-b border-slate-100 dark:border-white/[0.05]">
                {results.length} case{results.length === 1 ? "" : "s"}
              </p>
              {results.map((c: any) => {
                const title = c.title || c.name || "Untitled";
                const status = c.status || c.statusType || "";
                return (
                  <Link
                    key={c.id}
                    href={`/cases/${c.id}`}
                    onClick={close}
                    className="block px-3 py-2.5 border-b border-slate-100 dark:border-white/[0.04] last:border-b-0 hover:bg-[#008CFF]/[0.06] dark:hover:bg-[#008CFF]/[0.1] transition-colors"
                  >
                    <p className="text-[13px] font-medium text-slate-800 dark:text-white truncate leading-snug">{title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {c.clickupTaskId && (
                        <span className="text-[10.5px] font-mono text-slate-400">#{String(c.clickupTaskId).slice(0, 10)}</span>
                      )}
                      {status && (
                        <span className="text-[10.5px] uppercase tracking-wide font-semibold text-[#008CFF]">{status}</span>
                      )}
                      {c.channel && (
                        <span className="text-[10.5px] text-slate-500 truncate">{c.channel}</span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
