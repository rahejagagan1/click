"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { fetcher } from "@/lib/swr";
import { X, Info, Search, Check, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";

// ── Shared types ─────────────────────────────────────────────────────────────
export type LeaveRequestKind = "wfh" | "on_duty" | "half_day" | "leave" | "regularize";

export type LeaveRequestFormProps = {
  kind: LeaveRequestKind;
  title: string;
  policyText?: string;
  /** For "leave": list of LeaveType rows {id,name}. Shown as a select. */
  leaveTypes?: { id: number; name: string }[];
  /** Prefill the date field (YYYY-MM-DD). */
  prefillDate?: string;
  onClose: () => void;
  /** Called after successful POST so the caller can refresh their SWR keys. */
  onSaved?: () => void;
};

// ── Leave type picker — shows per-type balance next to each option ────────
function LeaveTypePicker({
  leaveTypes,
  value,
  onChange,
}: {
  leaveTypes: { id: number; name: string }[];
  value: number | "";
  onChange: (v: number | "") => void;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: balances = [] } = useSWR<any[]>("/api/hr/leaves/balance", fetcher);
  const balanceByTypeId = useMemo(() => {
    const map = new Map<number, number>();
    for (const b of Array.isArray(balances) ? balances : []) {
      const available = parseFloat(b.totalDays ?? "0") - parseFloat(b.usedDays ?? "0") - parseFloat(b.pendingDays ?? "0");
      if (b.leaveTypeId) map.set(b.leaveTypeId, available);
    }
    return map;
  }, [balances]);

  useEffect(() => {
    if (!open) return;
    const recompute = () => { if (btnRef.current) setRect(btnRef.current.getBoundingClientRect()); };
    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t))   return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selected = leaveTypes.find((t) => t.id === value) || null;

  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
        Select type of leave you want to apply
      </label>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`mt-1.5 w-full h-11 px-3 rounded-lg border text-left flex items-center justify-between transition-colors
          bg-white dark:bg-[#0a1526] border-slate-200 dark:border-white/[0.08]
          text-[13px] text-slate-800 dark:text-white
          ${open ? "border-[#008CFF] dark:border-[#4a9cff] ring-1 ring-[#008CFF]/20" : "hover:border-[#008CFF]/40"}
        `}
      >
        <span className={selected ? "" : "text-slate-400"}>{selected?.name ?? "Select"}</span>
        <ChevronDown size={16} strokeWidth={2} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && rect && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            top:   rect.bottom + 6,
            left:  rect.left,
            width: rect.width,
            zIndex: 10000,
            maxHeight: 320,
          }}
          className="rounded-lg border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#0a1526] shadow-2xl overflow-y-auto"
        >
          {leaveTypes.map((t) => {
            const bal = balanceByTypeId.get(t.id);
            const isSelected = value === t.id;
            const available = bal != null && bal > 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => { onChange(t.id); setOpen(false); }}
                className={`w-full flex items-center justify-between px-4 py-3 text-left border-b border-slate-100 dark:border-white/[0.04] last:border-b-0 transition-colors
                  ${isSelected ? "bg-[#008CFF]/[0.08] dark:bg-[#4a9cff]/[0.1]" : "hover:bg-slate-50 dark:hover:bg-white/[0.03]"}
                `}
              >
                <span className={`text-[13px] font-medium ${isSelected ? "text-[#008CFF] dark:text-[#4a9cff]" : "text-slate-800 dark:text-white"}`}>
                  {t.name}
                </span>
                <span className={`text-[11.5px] ${available ? "text-slate-600 dark:text-slate-300 font-medium" : "text-slate-400 dark:text-slate-500"}`}>
                  {bal == null
                    ? "Not Available"
                    : bal > 0
                      ? `${bal % 1 === 0 ? bal.toFixed(0) : bal.toFixed(1)} day${bal === 1 ? "" : "s"} available`
                      : "Not Available"}
                </span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Employee autocomplete (Notify field) ─────────────────────────────────────
function EmployeePicker({ selected, onChange }: {
  selected: { id: number; name: string; email?: string; profilePictureUrl?: string | null }[];
  onChange: (next: { id: number; name: string; email?: string; profilePictureUrl?: string | null }[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen]   = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef    = useRef<HTMLDivElement>(null);
  // Tick state forces re-read of the anchor's rect after scroll / resize.
  const [, forceTick] = useState(0);

  const { data, error } = useSWR(
    open && query.trim().length >= 1
      ? `/api/hr/employees?search=${encodeURIComponent(query.trim())}&isActive=true`
      : null,
    fetcher,
    { dedupingInterval: 500 }
  );
  const all: any[] = Array.isArray(data) ? data : [];
  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);
  const results = all.filter((u) => !selectedIds.has(u.id)).slice(0, 8);

  // Re-render the popover when the modal scrolls or the window resizes so the
  // anchor rect stays in sync.
  useEffect(() => {
    if (!open) return;
    const bump = () => forceTick((n) => n + 1);
    window.addEventListener("resize", bump);
    window.addEventListener("scroll", bump, true);
    return () => {
      window.removeEventListener("resize", bump);
      window.removeEventListener("scroll", bump, true);
    };
  }, [open]);

  // Close when clicking outside both the anchor and the popover.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (popRef.current?.contains(t))    return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const add = (u: any) => {
    onChange([...selected, { id: u.id, name: u.name, email: u.email, profilePictureUrl: u.profilePictureUrl }]);
    setQuery("");
  };
  const remove = (id: number) => onChange(selected.filter((s) => s.id !== id));

  const trimmed = query.trim();
  // Read the rect fresh on every render (no state gap). Safe because the
  // anchor div is already mounted whenever the picker is visible.
  const anchorRect = anchorRef.current?.getBoundingClientRect() ?? null;
  const showPopover = open && trimmed.length >= 1;

  return (
    <div ref={anchorRef} className="relative">
      <div className={`flex flex-wrap items-center gap-1.5 w-full min-h-10 px-3 py-1.5 rounded-lg border bg-white dark:bg-[#0a1526] border-slate-200 dark:border-white/[0.08] focus-within:border-[#008CFF] dark:focus-within:border-[#4a9cff] transition-colors`}>
        {selected.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1.5 h-6 pl-1 pr-1.5 rounded-full bg-[#008CFF]/10 text-[#008CFF] dark:bg-[#4a9cff]/15 dark:text-[#4a9cff] text-[11px] font-medium">
            {s.profilePictureUrl ? (
              <img src={s.profilePictureUrl} alt="" className="w-4 h-4 rounded-full object-cover" />
            ) : (
              <span className="w-4 h-4 rounded-full bg-[#008CFF]/25 text-[9px] flex items-center justify-center">
                {s.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            {s.name}
            <button type="button" onClick={() => remove(s.id)} className="hover:opacity-80" aria-label={`Remove ${s.name}`}>
              <X size={11} strokeWidth={2.5} />
            </button>
          </span>
        ))}
        <div className="flex items-center flex-1 min-w-[120px]">
          <Search size={13} strokeWidth={2} className="text-slate-400 mr-1.5 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={selected.length === 0 ? "Search employee" : "Add another…"}
            className="flex-1 h-8 bg-transparent text-[13px] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none"
          />
        </div>
      </div>

      {showPopover && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          className="max-h-56 overflow-y-auto bg-white dark:bg-[#0a1526] border border-slate-200 dark:border-white/[0.08] rounded-lg shadow-2xl"
          style={{
            position: "fixed",
            top:   (anchorRect?.bottom ?? 0) + 4,
            left:  anchorRect?.left  ?? 0,
            width: anchorRect?.width ?? 240,
            zIndex: 10000,
          }}
        >
          {error ? (
            <p className="px-3 py-3 text-[12px] text-red-500">Couldn't load employees</p>
          ) : !data ? (
            <p className="px-3 py-3 text-[12px] text-slate-400">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-slate-400">No employees found for "{trimmed}"</p>
          ) : results.map((u) => (
            <button
              key={u.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); add(u); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#008CFF]/[0.06] dark:hover:bg-[#4a9cff]/[0.08]"
            >
              {u.profilePictureUrl ? (
                <img src={u.profilePictureUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
              ) : (
                <span className="w-7 h-7 rounded-full bg-[#008CFF]/20 text-[#008CFF] text-[11px] font-semibold flex items-center justify-center">
                  {u.name?.slice(0, 1).toUpperCase() || "?"}
                </span>
              )}
              <div className="min-w-0">
                <p className="text-[12.5px] text-slate-800 dark:text-white font-medium truncate">{u.name}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{u.email}</p>
              </div>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Main form ────────────────────────────────────────────────────────────────
export default function LeaveRequestForm({
  kind, title, policyText, leaveTypes, prefillDate, onClose, onSaved,
}: LeaveRequestFormProps) {
  const today = prefillDate || new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(today);
  const [toDate,   setToDate]   = useState(today);
  const [leaveTypeId, setLeaveTypeId] = useState<number | "">(leaveTypes?.[0]?.id ?? "");
  const [note, setNote]         = useState("");
  const [notify, setNotify]     = useState<{ id: number; name: string; email?: string; profilePictureUrl?: string | null }[]>([]);
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState("");

  const days = useMemo(() => {
    if (!fromDate || !toDate) return 0;
    const a = new Date(fromDate), b = new Date(toDate);
    if (isNaN(a.getTime()) || isNaN(b.getTime()) || a > b) return 0;
    return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
  }, [fromDate, toDate]);

  const submit = async () => {
    setErr("");
    if (!fromDate || !toDate) return setErr("Please select From and To dates");
    if (new Date(fromDate) > new Date(toDate)) return setErr("From date must be on/before To date");
    if (!note.trim()) return setErr("Please add a note / reason");
    if (kind === "leave" && !leaveTypeId) return setErr("Please choose a leave type");

    setSaving(true);
    const notifyUserIds = notify.map((u) => u.id);

    let url = "";
    let payload: Record<string, unknown> = {};
    let refreshKeys: string[] = [];

    if (kind === "wfh") {
      url = "/api/hr/attendance/wfh";
      payload = { date: fromDate, reason: note, notifyUserIds };
      refreshKeys = ["/api/hr/attendance/wfh"];
    } else if (kind === "on_duty") {
      url = "/api/hr/attendance/on-duty";
      payload = { date: fromDate, purpose: note, notifyUserIds };
      refreshKeys = ["/api/hr/attendance/on-duty"];
    } else if (kind === "regularize") {
      url = "/api/hr/attendance/regularize";
      payload = { date: fromDate, reason: note, notifyUserIds };
      refreshKeys = ["/api/hr/attendance/regularize"];
    } else if (kind === "half_day") {
      // Half-day = one-day leave of a half-day leave type if configured, else
      // fall back to a regularization so a request still reaches approvers.
      if (leaveTypeId) {
        url = "/api/hr/leaves";
        payload = { leaveTypeId, fromDate, toDate: fromDate, reason: `[Half Day] ${note}`, notifyUserIds };
        refreshKeys = ["/api/hr/leaves", "/api/hr/leaves/balance"];
      } else {
        url = "/api/hr/attendance/regularize";
        payload = { date: fromDate, reason: `[Half Day] ${note}`, notifyUserIds };
        refreshKeys = ["/api/hr/attendance/regularize"];
      }
    } else if (kind === "leave") {
      url = "/api/hr/leaves";
      payload = { leaveTypeId, fromDate, toDate, reason: note, notifyUserIds };
      refreshKeys = ["/api/hr/leaves", "/api/hr/leaves/balance"];
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setErr((data as any).error || "Failed to submit"); setSaving(false); return; }

    for (const k of refreshKeys) {
      globalMutate((key: any) => typeof key === "string" && key.startsWith(k));
    }
    globalMutate((k: any) => typeof k === "string" && k.startsWith("/api/hr/notifications"));
    onSaved?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md max-h-[90vh] flex flex-col rounded-2xl border bg-white dark:bg-[#0a1526] border-slate-200 dark:border-white/[0.08] shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-white/[0.06]">
          <h3 className="text-[14px] font-semibold text-slate-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-800 dark:hover:text-white" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {err && <p className="text-[12px] text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{err}</p>}

          {/* Date range card */}
          <div className="rounded-lg border border-slate-200 dark:border-white/[0.08] p-3">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <div>
                <p className="text-[10.5px] uppercase tracking-widest font-semibold text-slate-500 dark:text-slate-400">From</p>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => { setFromDate(e.target.value); if (!toDate || new Date(e.target.value) > new Date(toDate)) setToDate(e.target.value); }}
                  className="mt-1 w-full bg-transparent text-[13px] font-semibold text-slate-900 dark:text-white focus:outline-none"
                />
              </div>
              <div className="px-3 py-1.5 rounded-md bg-[#008CFF]/10 text-[#008CFF] dark:bg-[#4a9cff]/15 dark:text-[#4a9cff] text-[12px] font-semibold tabular-nums text-center whitespace-nowrap">
                {days} day{days === 1 ? "" : "s"}
              </div>
              <div className="text-right">
                <p className="text-[10.5px] uppercase tracking-widest font-semibold text-slate-500 dark:text-slate-400">To</p>
                <input
                  type="date"
                  value={toDate}
                  min={fromDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="mt-1 w-full bg-transparent text-[13px] font-semibold text-slate-900 dark:text-white text-right focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Policy */}
          {policyText && (
            <div className="rounded-lg border border-[#008CFF]/30 bg-[#008CFF]/[0.06] px-3 py-2.5 flex items-start gap-2">
              <Info size={14} strokeWidth={2} className="text-[#008CFF] mt-0.5 shrink-0" />
              <p className="text-[11.5px] leading-snug text-[#008CFF] dark:text-[#4a9cff]">{policyText}</p>
            </div>
          )}

          {/* Leave type — only for `kind=leave` + optional for half_day. Rich picker shows per-type balance. */}
          {(kind === "leave" || (kind === "half_day" && leaveTypes && leaveTypes.length > 0)) && leaveTypes && leaveTypes.length > 0 && (
            <LeaveTypePicker
              leaveTypes={leaveTypes}
              value={leaveTypeId}
              onChange={setLeaveTypeId}
            />
          )}

          {/* Note */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">Note</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Type here"
              className="mt-1.5 w-full px-3 py-2 rounded-lg border bg-white dark:bg-[#0a1526] border-slate-200 dark:border-white/[0.08] text-[13px] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#008CFF] dark:focus:border-[#4a9cff] resize-none"
            />
          </div>

          {/* Notify */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">Notify</label>
            <div className="mt-1.5">
              <EmployeePicker selected={notify} onChange={setNotify} />
            </div>
            <p className="text-[10.5px] text-slate-400 mt-1">Selected people will receive an in-app notification when you submit.</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-white/[0.06]">
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-[13px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-white">Cancel</button>
          <button
            onClick={submit}
            disabled={saving}
            className="h-9 px-5 rounded-lg text-[13px] font-semibold text-white bg-[#008CFF] hover:bg-[#0070cc] disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {saving ? "Submitting…" : (<><Check size={14} strokeWidth={2.5} /> Submit</>)}
          </button>
        </div>
      </div>
    </div>
  );
}
