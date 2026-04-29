"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Home, Briefcase, ShieldCheck, Info, User, Users, Clock3, Plus, X, MapPin, MoreVertical, Coffee, AlertCircle, CheckCircle2, XCircle, Calendar, CalendarDays } from "lucide-react";
import { parseAttLoc, captureClockInGeo } from "@/lib/attendance-location";
import LeaveRequestForm, { LeaveRequestKind } from "@/components/LeaveRequestForm";

// ── Form copy per kind ───────────────────────────────────────────────────────
const FORM_TITLE: Record<LeaveRequestKind, string> = {
  wfh:        "Request Work From Home",
  on_duty:    "Apply for On Duty",
  half_day:   "Apply for Half Day",
  leave:      "Request Leave",
  regularize: "Request Regularization",
};
const FORM_POLICY: Record<LeaveRequestKind, string | undefined> = {
  wfh:        "As per the policy assigned only Monday, Tuesday, Wednesday, Thursday, Friday, Saturday will be considered for WFH. Clock in is necessary on WFH days to avoid being marked absent.",
  on_duty:    "On-duty time counts as working hours. Log the purpose clearly — your manager will review before approval.",
  half_day:   "Half day leave covers either the first (9:00 AM – 2:00 PM) or second half (2:00 PM – 6:00 PM) of the day.",
  leave:      undefined,
  regularize: "Use this to fix missed punches or incorrect clock-in/out. Attach a clear reason so approval is quick.",
};

// ── Tab config ────────────────────────────────────────────────────────────────
const TOP_TABS = [
  { key: "home",             label: "HOME",               href: "/dashboard/hr/home"  },
  { key: "attendance",       label: "ATTENDANCE",         href: "/dashboard/hr/attendance" },
  { key: "leave",            label: "LEAVE",              href: "/dashboard/hr/leaves"     },
  { key: "performance",      label: "PERFORMANCE",        href: "/dashboard/hr/goals"      },
  { key: "apps",             label: "APPS",               href: "/dashboard/hr/apps"       },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtMins(m: number) { return `${Math.floor(m / 60)}h ${m % 60}m`; }

// ── Kebab row menu with Regularize / WFH / On Duty / Leave actions ──────────
type RowMenuProps = {
  onRegularize: () => void;
  onWFH:        () => void;
  onOnDuty:     () => void;
  onLeave:      () => void;
  disableRegularize?: boolean;
  disableRegularizeReason?: string;
};
function RowMenu({ onRegularize, onWFH, onOnDuty, onLeave, disableRegularize, disableRegularizeReason }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  // When a regularization is already in flight for this date, drop the
  // "Regularize" option from the menu entirely instead of greying it out —
  // a pending request can't be re-submitted, so showing it is just noise.
  const items: { label: string; Icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>; onSelect: () => void; disabled?: boolean; title?: string }[] = [
    ...(disableRegularize
      ? []
      : [{ label: "Regularize", Icon: ShieldCheck, onSelect: onRegularize, title: disableRegularizeReason }]),
    { label: "Apply WFH Request", Icon: Home,        onSelect: onWFH        },
    { label: "Apply On Duty",     Icon: Briefcase,   onSelect: onOnDuty     },
    { label: "Request Leave",     Icon: Coffee,      onSelect: onLeave      },
  ];

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        className="w-7 h-7 rounded hover:bg-slate-100 dark:hover:bg-white/[0.06] flex items-center justify-center text-slate-500 hover:text-slate-800 dark:text-slate-300 dark:hover:text-white"
        aria-label="Row actions"
        aria-expanded={open}
      >
        <MoreVertical size={16} strokeWidth={2.25} />
      </button>
      {open && (
        <div className="absolute z-40 right-0 top-8 w-[210px] bg-white dark:bg-[#0a1526] border border-slate-200 dark:border-white/[0.08] rounded-lg shadow-2xl py-1">
          {items.map(({ label, Icon, onSelect, disabled, title }, i) => {
            // Hairline divider after "Regularize" — separates "fix the past"
            // from "request the future". Skip when Regularize was filtered out.
            const showDivider = i === 0 && label === "Regularize";
            return (
              <button
                key={label}
                type="button"
                disabled={disabled}
                title={disabled ? title : undefined}
                onClick={() => { if (disabled) return; setOpen(false); onSelect(); }}
                className={`w-full text-left px-3 py-2 text-[12.5px] text-slate-700 dark:text-slate-200 transition-colors flex items-center gap-2.5 ${
                  showDivider ? "border-b border-slate-200 dark:border-white/[0.06]" : ""
                } ${
                  disabled
                    ? "opacity-40 cursor-not-allowed"
                    : "hover:bg-[#008CFF]/[0.06] dark:hover:bg-[#008CFF]/[0.1] hover:text-[#008CFF] dark:hover:text-[#4a9cff]"
                }`}
              >
                <Icon size={14} strokeWidth={2} className="text-[#008CFF] dark:text-[#4a9cff] shrink-0" />
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Location pin with click-to-view popover (Keka-style) ─────────────────────
// Shows whatever location was captured at clock-in. Location is mandatory at
// clock-in (enforced client + server), so new rows will always have coords.
// Older rows created before that rule may have no location — we just say so.
function LocationPin({ raw }: { raw?: string | null }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const info = parseAttLoc(raw);
  const hasAddress = !!info.address;
  const hasCoords  = typeof info.lat === "number" && typeof info.lng === "number";
  const has        = hasAddress || hasCoords;
  const tint = has
    ? (info.mode === "remote" ? "#008CFF" : "#10b981")
    : "#94a3b8";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t))   return;
      if (panelRef.current?.contains(t)) return;
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

  const rect = btnRef.current?.getBoundingClientRect() ?? null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={has ? (info.address || `${info.lat!.toFixed(4)}, ${info.lng!.toFixed(4)}`) : "No location recorded for this entry"}
        className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full border border-[#008CFF]/20 bg-[#008CFF]/5 text-[#008CFF] cursor-pointer transition-all hover:bg-[#008CFF]/15 hover:border-[#008CFF]/40 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-[#008CFF]/30"
        style={has ? { color: tint, borderColor: `${tint}33`, background: `${tint}14` } : undefined}
        aria-label="Clock-in location"
      >
        <MapPin size={14} strokeWidth={2} />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            top:   (rect?.bottom ?? 0) + 6,
            left:  Math.min((rect?.left ?? 0), (typeof window !== "undefined" ? window.innerWidth - 260 : 0)),
            zIndex: 10000,
          }}
          className="w-[260px] bg-white dark:bg-[#0a1526] border border-slate-200 dark:border-white/[0.08] rounded-lg shadow-2xl p-3"
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: tint }} />
            <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: tint }}>
              {info.mode === "remote" ? "Remote Clock-in" : info.mode === "office" ? "Office Clock-in" : "Clock-in"}
            </span>
          </div>

          {info.address && (
            <p className="text-[12px] text-slate-700 dark:text-slate-200 leading-snug mb-1">{info.address}</p>
          )}
          {hasCoords && (
            <>
              <p className="text-[11px] text-slate-400 font-mono">{info.lat!.toFixed(5)}, {info.lng!.toFixed(5)}</p>
              <a
                href={`https://www.google.com/maps?q=${info.lat},${info.lng}`}
                target="_blank" rel="noopener noreferrer"
                className="text-[11px] text-[#008CFF] hover:underline mt-1.5 inline-block"
              >Open in Maps ↗</a>
            </>
          )}

          {!has && (
            <p className="text-[11.5px] text-slate-500 leading-snug">
              No location recorded for this entry. (Older records may not have one — new clock-ins always do.)
            </p>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

// ── Timeline bar (same proportional grid as Keka) ────────────────────────────
// Shift-progress bar: fills from 0 → 100% of a 9h shift based on elapsed minutes.
// Orange < 50% · blue < 100% · green once the full 9h is met.
function TimelineBar({ liveMins }: { liveMins: number }) {
  if (!liveMins || liveMins <= 0) return <span className="text-[11px] text-slate-400">—</span>;
  const SHIFT_LEN = 540; // 9h in minutes
  const pct = Math.min((liveMins / SHIFT_LEN) * 100, 100);
  const color = pct >= 100 ? "bg-emerald-400" : pct >= 50 ? "bg-[#008CFF]" : "bg-orange-400";
  return (
    <div className="relative w-full max-w-[280px] h-2 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} rounded-full transition-[width] duration-500`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const C = {
  card:    "bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl",
  t1:      "text-slate-800 dark:text-white",
  t2:      "text-slate-600 dark:text-slate-300",
  t3:      "text-slate-400 dark:text-slate-500",
};

// Predefined reason categories for regularization. Picking one is required;
// the free-text "note" below it is optional context for the approver.
const REGULARIZATION_REASONS = [
  "Early check-in and out",
  "Late check-in and out",
  "Early check-in",
  "Late check-in",
  "Early check-out",
  "Late check-out",
] as const;

function RegularizeModal({ onClose, prefillDate }: { onClose: () => void; prefillDate?: string }) {
  const [form, setForm] = useState({ date: prefillDate || "", reasonCategory: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // Monthly regularization quota for the selected date's IST month. Uses the
  // same SWR key as the prefetch on the parent page so the first open is
  // instant; changing the date triggers a fresh fetch for that month.
  const balanceUrl = form.date
    ? `/api/hr/attendance/regularize/balance?date=${form.date}`
    : `/api/hr/attendance/regularize/balance`;
  const { data: balance } = useSWR<{ used: number; limit: number; remaining: number; month: string }>(
    balanceUrl, fetcher, { keepPreviousData: true, revalidateOnFocus: false }
  );

  const submit = async () => {
    setErr("");
    if (!form.date || !form.reasonCategory) return setErr("Date and reason are required");
    setSaving(true);
    // Combine the dropdown reason + optional note into a single `reason`
    // string for the API. Format: "<Reason>" or "<Reason> — <note>".
    const reason = form.note.trim()
      ? `${form.reasonCategory} — ${form.note.trim()}`
      : form.reasonCategory;
    const res = await fetch("/api/hr/attendance/regularize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: form.date, reason }),
    });
    const data = await res.json();
    if (!res.ok) { setErr(data.error || "Failed"); setSaving(false); return; }
    mutate((k: string) => typeof k === "string" && k.includes("/api/hr/attendance/regularize"));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.08] rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
          <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">Request Regularization</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {err && <p className="text-[12px] text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{err}</p>}
          {balance && (
            <div className={`flex items-center justify-between px-3 py-2 rounded-lg text-[12px] ${
              balance.remaining === 0
                ? "bg-red-500/10 text-red-500"
                : balance.remaining === 1
                ? "bg-amber-500/10 text-amber-600"
                : "bg-[#008CFF]/10 text-[#008CFF]"
            }`}>
              <span className="font-semibold">{balance.used} of {balance.limit} used · {balance.month}</span>
              <span>{balance.remaining} left</span>
            </div>
          )}
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Date *</label>
            <input type="date" value={form.date} onChange={e => set("date", e.target.value)}
              className="mt-1 w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none focus:border-[#008CFF]" />
          </div>
          {/* Reason category dropdown — required */}
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Reason for Regularisation *</label>
            <select
              value={form.reasonCategory}
              onChange={e => set("reasonCategory", e.target.value)}
              className="mt-1 w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none focus:border-[#008CFF]"
            >
              <option value="">Select a reason…</option>
              {REGULARIZATION_REASONS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          {/* Optional free-text note for the approver */}
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Note</label>
            <textarea value={form.note} onChange={e => set("note", e.target.value)} rows={3}
              placeholder="Any additional context for the approver (optional)…"
              className="mt-1 w-full px-3 py-2 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none resize-none" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-white/[0.06]">
          <button onClick={onClose} className="h-8 px-4 text-[13px] font-medium text-slate-500">Cancel</button>
          <button onClick={submit} disabled={saving || balance?.remaining === 0}
            className="h-8 px-5 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[13px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
            {saving ? "Submitting..." : balance?.remaining === 0 ? "Quota exhausted" : "Submit Request"}
          </button>
        </div>
      </div>
    </div>
  );
}

function WFHModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0,10), reason: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // WFH allowance is 2 per calendar month (resets each month, no carry-over).
  // We re-fetch whenever `form.date` changes so the chip reflects the
  // month the user is actually picking — picking a future month with 0
  // usage shouldn't show the current month's count.
  const monthKey = form.date.slice(0, 7);
  const { data: balance } = useSWR<{ used: number; limit: number; remaining: number }>(
    `/api/hr/attendance/wfh/balance?month=${monthKey}`,
    fetcher,
  );
  const atCap = !!balance && balance.remaining <= 0;

  const submit = async () => {
    setErr("");
    if (!form.reason) return setErr("Reason is required");
    setSaving(true);
    const res = await fetch("/api/hr/attendance/wfh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = await res.json();
    if (!res.ok) { setErr(data.error || "Failed"); setSaving(false); return; }
    mutate((k: string) => typeof k === "string" && k.includes("/api/hr/attendance/wfh"));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.08] rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
          <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">Work From Home Request</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {err && <p className="text-[12px] text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{err}</p>}
          {balance && (
            <div className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-[12px] ${
              atCap
                ? "border-rose-200 bg-rose-50 dark:border-rose-500/20 dark:bg-rose-500/10"
                : "border-slate-200 bg-slate-50 dark:border-white/[0.06] dark:bg-white/[0.03]"
            }`}>
              <div>
                <span className={`font-semibold ${atCap ? "text-rose-700 dark:text-rose-300" : "text-slate-700 dark:text-slate-200"}`}>
                  {balance.remaining} of {balance.limit} WFH left
                </span>
                <span className="ml-1 text-slate-500 dark:text-slate-400">
                  this month
                </span>
              </div>
              <span className="text-[10.5px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {balance.used}/{balance.limit} used
              </span>
            </div>
          )}
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Date *</label>
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              className="mt-1 w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none focus:border-[#008CFF]" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Reason *</label>
            <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} rows={3}
              placeholder="Why are you working from home today?"
              className="mt-1 w-full px-3 py-2 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none resize-none" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-white/[0.06]">
          <button onClick={onClose} className="h-8 px-4 text-[13px] text-slate-500">Cancel</button>
          <button onClick={submit} disabled={saving || atCap}
            title={atCap ? "WFH limit reached for the selected month" : undefined}
            className="h-8 px-5 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[13px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
            {saving ? "Submitting..." : atCap ? "Limit reached" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OnDutyModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0,10), fromTime: "", toTime: "", purpose: "", location: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    setErr("");
    if (!form.purpose) return setErr("Purpose is required");
    setSaving(true);
    const res = await fetch("/api/hr/attendance/on-duty", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = await res.json();
    if (!res.ok) { setErr(data.error || "Failed"); setSaving(false); return; }
    mutate((k: string) => typeof k === "string" && k.includes("/api/hr/attendance/on-duty"));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.08] rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
          <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">On Duty Request</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {err && <p className="text-[12px] text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{err}</p>}
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Date *</label>
            <input type="date" value={form.date} onChange={e => set("date", e.target.value)}
              className="mt-1 w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none focus:border-[#008CFF]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">From Time</label>
              <input type="time" value={form.fromTime} onChange={e => set("fromTime", e.target.value)}
                className="mt-1 w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">To Time</label>
              <input type="time" value={form.toTime} onChange={e => set("toTime", e.target.value)}
                className="mt-1 w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Purpose *</label>
            <textarea value={form.purpose} onChange={e => set("purpose", e.target.value)} rows={2}
              placeholder="Purpose of official duty..."
              className="mt-1 w-full px-3 py-2 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none resize-none" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Location</label>
            <input value={form.location} onChange={e => set("location", e.target.value)}
              placeholder="e.g. Client office, Mumbai"
              className="mt-1 w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#008CFF]" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-white/[0.06]">
          <button onClick={onClose} className="h-8 px-4 text-[13px] text-slate-500">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="h-8 px-5 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[13px] font-semibold disabled:opacity-50">
            {saving ? "Submitting..." : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AttendancePage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const isAdmin = user?.orgLevel === "ceo" || user?.isDeveloper || user?.orgLevel === "hr_manager";

  // `now` ticks with the clock so week-day highlight, calendar "today", and
  // month default all track the actual wall-clock time rather than mount time.
  const [clock, setClock] = useState<Date | null>(null);
  const now = clock ?? new Date();
  const [month, setMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  );
  const [subTab, setSubTab] = useState<"log" | "calendar" | "requests">("log");
  const [reqType, setReqType] = useState<"punch" | "wfh" | "od">("punch");
  const [use24, setUse24] = useState(false);
  const [period, setPeriod] = useState<"30d" | "month">("30d");
  const [showRegModal, setShowRegModal] = useState(false);
  const [regPrefillDate, setRegPrefillDate] = useState<string | undefined>(undefined);
  // New unified form (WFH / On-Duty / Half Day / Leave / Regularize-via-form).
  const [formState, setFormState] = useState<{ kind: LeaveRequestKind; prefillDate?: string } | null>(null);
  const openForm = (kind: LeaveRequestKind, prefillDate?: string) => setFormState({ kind, prefillDate });

  // Deep-link support: `?apply=wfh|on_duty|leave|half_day|regularize` opens
  // the matching apply form on first paint. Used by the Home page's
  // "Other" menu so users land directly on the form they want.
  //
  // We strip the query string with `window.history.replaceState` rather
  // than `router.replace` — the latter dispatches a Next.js router action
  // and in Next 16 that fires "Router action dispatched before initialization"
  // when called from a layout-level effect. The native History API is
  // a no-op for routing and just rewrites the URL bar.
  const searchParams = useSearchParams();
  useEffect(() => {
    const v = searchParams?.get("apply");
    const valid: LeaveRequestKind[] = ["wfh", "on_duty", "leave", "half_day", "regularize"];
    if (v && (valid as string[]).includes(v)) {
      openForm(v as LeaveRequestKind);
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", "/dashboard/hr/attendance");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [regView, setRegView] = useState<"my" | "team">("my");

  // Browser geolocation permission state. Attendance needs location, so we
  // check this up-front and show a banner + disable the clock-in button when
  // permission has been permanently blocked. "prompt" is fine — clicking the
  // button will trigger the browser's native ask.
  type LocPerm = "granted" | "denied" | "prompt" | "unsupported" | "checking";
  const [locPerm, setLocPerm] = useState<LocPerm>("checking");
  // Shows a "Getting location…" label on the clock-in button so users know
  // the browser is busy asking the OS for coordinates (first-time GPS/Wi-Fi
  // lookup on Windows can take 10–15s).
  const [clockingIn, setClockingIn] = useState(false);

  useEffect(() => {
    setClock(new Date());
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) {
      setLocPerm("unsupported");
      return;
    }
    let status: PermissionStatus | null = null;
    const check = () => {
      navigator.permissions.query({ name: "geolocation" as PermissionName })
        .then((s) => {
          if (status) status.onchange = null;
          status = s;
          setLocPerm(s.state as LocPerm);
          // `onchange` fires reliably in some cases but Chrome won't always
          // fire it when the user toggles permission from the address-bar
          // popup. The focus listener below covers that gap.
          s.onchange = () => setLocPerm(s.state as LocPerm);
        })
        .catch(() => setLocPerm("unsupported"));
    };
    check();
    // When the user closes the browser's site-settings popup, focus returns
    // to this window — re-query so the banner clears immediately.
    window.addEventListener("focus", check);
    return () => {
      window.removeEventListener("focus", check);
      if (status) status.onchange = null;
    };
  }, []);

  // Build the attendance query: rolling 30-day window when period="30d",
  // otherwise the currently-selected month.
  const attendanceQs = (() => {
    if (period === "30d") {
      const end = clock ?? new Date();
      const start = new Date(end); start.setDate(start.getDate() - 29);
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      return `from=${iso(start)}&to=${iso(end)}`;
    }
    return `month=${month}`;
  })();
  const { data: myData }    = useSWR(`/api/hr/attendance?${attendanceQs}`, fetcher);
  const { data: boardData } = useSWR(`/api/hr/attendance/board`, fetcher);
  const { data: regsData = [] } = useSWR(`/api/hr/attendance/regularize?view=${regView}`, fetcher);
  // Prefetch regularization balance so the modal shows it instantly on open.
  // Same key the modal uses — SWR dedupes and serves from cache.
  useSWR(`/api/hr/attendance/regularize/balance`, fetcher);
  const { data: wfhData  = [] } = useSWR(`/api/hr/attendance/wfh?view=${regView}`, fetcher);
  const { data: odData   = [] } = useSWR(`/api/hr/attendance/on-duty?view=${regView}`, fetcher);
  // My pending leave applications — used to show "Pending leave" on affected days.
  const { data: leavesData } = useSWR(`/api/hr/leaves?view=my`, fetcher);
  const myLeaves: any[] = Array.isArray(leavesData) ? leavesData : (leavesData?.applications ?? leavesData?.items ?? []);
  const { data: leaveTypesData = [] } = useSWR(`/api/hr/admin/leave-types`, fetcher);
  // Rolling team-stats comparison: me vs everyone sharing my `teamCapsule`.
  const { data: teamStats } = useSWR(`/api/hr/attendance/team-stats?period=week`, fetcher);
  // My profile — used to clamp the attendance log to the day my account
  // was first created so we don't render "Absent" rows for days before I
  // started using the app. `createdAt` is always populated (set to now()
  // on the first sign-in), so no fallback is needed.
  const { data: profileData } = useSWR(`/api/hr/profile`, fetcher);
  const appStartIso: string | null = (() => {
    const c = (profileData as any)?.createdAt;
    if (!c) return null;
    return String(c).slice(0, 10); // YYYY-MM-DD (UTC component is fine — User.createdAt is a timestamp)
  })();
  const leaveTypes: { id: number; name: string }[] = Array.isArray(leaveTypesData)
    ? leaveTypesData.map((t: any) => ({ id: t.id, name: t.name }))
    : [];

  const clockIn  = async () => {
    // Location is mandatory. Always attempt a fresh geolocation read — the
    // cached `locPerm` state can lag (Chrome doesn't always fire `onchange`
    // when permission is toggled from the address-bar popup), so the real
    // source of truth is whether coordinates come back.
    setClockingIn(true);
    try {
      const geo = await captureClockInGeo();
      if (!geo.ok) {
        alert(`Can't clock in — ${geo.message}`);
        return;
      }
      const res = await fetch("/api/hr/attendance/clock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: geo.lat, lng: geo.lng, address: geo.address }),
      });
      const d = await res.json();
      if (!res.ok) { alert(d.error); return; }
      mutate(`/api/hr/attendance?${attendanceQs}`);
    } finally {
      setClockingIn(false);
    }
  };
  const clockOut = async () => { const res = await fetch("/api/hr/attendance/clock-out", { method: "POST" }); const d = await res.json(); if (!res.ok) return alert(d.error); mutate(`/api/hr/attendance?${attendanceQs}`); };

  const todayRec  = myData?.todayRecord;
  const summary   = myData?.summary || {};
  const records   = myData?.records  || [];
  const days      = ["M","T","W","T","F","S","S"];
  const todayDow  = now.getDay() === 0 ? 6 : now.getDay() - 1;

  const presentRecs = records.filter((r: any) => r.totalMinutes > 0);
  const avgMins     = presentRecs.length > 0
    ? Math.round(presentRecs.reduce((s: number, r: any) => s + r.totalMinutes, 0) / presentRecs.length) : 0;
  const onTimePct   = summary.present > 0
    ? Math.round(((summary.present - (summary.late || 0)) / summary.present) * 100) : 0;

  // Elapsed since clock-in (live while open; snapshot after clock-out).
  const elapsedMins = todayRec?.clockIn && !todayRec?.clockOut && clock
    ? Math.floor((clock.getTime() - new Date(todayRec.clockIn).getTime()) / 60000)
    : todayRec?.totalMinutes || 0;
  const elapsedStr  = fmtMins(elapsedMins);

  // IST minutes-since-midnight for an arbitrary instant (live clock tick).
  const toIstMinutes = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata", hour12: false, hour: "2-digit", minute: "2-digit",
    }).formatToParts(d).reduce<Record<string, string>>((a, p) => { a[p.type] = p.value; return a; }, {});
    return parseInt(parts.hour || "0", 10) * 60 + parseInt(parts.minute || "0", 10);
  };
  const istMinsSinceMidnight = clock ? toIstMinutes(clock) : 0;

  const SHIFT_START = 9  * 60;  // 9:00 AM IST
  const SHIFT_END   = 18 * 60;  // 6:00 PM IST
  const SHIFT_MID   = 14 * 60;  // 2:00 PM IST \u2014 first/second half boundary
  const SHIFT_LEN   = SHIFT_END - SHIFT_START;        // 540
  const MID_POS     = SHIFT_MID - SHIFT_START;        // 300 (bar position of 2 PM)
  const MID_PCT     = (MID_POS / SHIFT_LEN) * 100;    // ~55.56% of the bar

  // Map an IST minutes value to a 0..540 position within the shift window.
  const toShiftPos = (m: number) => Math.max(0, Math.min(SHIFT_LEN, m - SHIFT_START));

  // Worked span inside the shift window. Null when not clocked in \u2014 bar stays empty.
  let workedStartPos: number | null = null;
  let workedEndPos:   number | null = null;
  if (todayRec?.clockIn) {
    workedStartPos = toShiftPos(toIstMinutes(new Date(todayRec.clockIn)));
    const endIst = todayRec.clockOut
      ? toIstMinutes(new Date(todayRec.clockOut))
      : istMinsSinceMidnight;
    workedEndPos = toShiftPos(endIst);
    if (workedEndPos < workedStartPos) workedEndPos = workedStartPos;
  }

  // Half-day yellow bands (boundary = 2:00 PM IST):
  //  \u2022 first half  (9:00\u20132:00)  yellow when user clocked in on/after 14:00 IST.
  //  \u2022 second half (2:00\u20136:00)  yellow when clock-out landed on/before 14:00 IST.
  const missedFirstHalf  = workedStartPos !== null && workedStartPos >= MID_POS;
  const missedSecondHalf = !!todayRec?.clockOut && workedEndPos !== null && workedEndPos <= MID_POS;

  const progressMins = todayRec?.clockIn ? elapsedMins : 0;

  // "Time left" is relative to a full 9-hour (SHIFT_LEN) shift counted from the
  // employee's actual clock-in, not a wall-clock countdown to 6 PM. If they
  // clock in late, they still owe 9 hours.
  const remainingLabel = !todayRec?.clockIn
    ? "not clocked in"
    : todayRec.clockOut
      ? "\u2713 done"
      : elapsedMins >= SHIFT_LEN
        ? `+${fmtMins(elapsedMins - SHIFT_LEN)} OT`
        : `${fmtMins(SHIFT_LEN - elapsedMins)} left`;

  // Synthesize a "today" row at the top of the log if the server returned none
  // (user hasn't clocked in yet today). Keeps the current day always visible.
  const istTodayIso = (() => {
    const d = clock ?? new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(d);
    const y = parts.find(p => p.type === "year")!.value;
    const m = parts.find(p => p.type === "month")!.value;
    const dd = parts.find(p => p.type === "day")!.value;
    return `${y}-${m}-${dd}`;
  })();
  const recsWithToday = (() => {
    // Build the list of every IST calendar day in the current view, then fill
    // each day with the matching server record (if any) or a synthetic empty
    // row. This way weekends, holidays, and absent days all appear in the log
    // — the rendering layer already knows how to label W-OFF and Holiday rows.
    const byDate = new Map<string, any>();
    for (const r of records) {
      const k = String(r.date).slice(0, 10);
      byDate.set(k, r);
    }

    // View bounds — start / end IST calendar days, inclusive.
    let start: Date, end: Date;
    if (period === "30d") {
      end = new Date(`${istTodayIso}T00:00:00Z`);
      start = new Date(end.getTime());
      start.setUTCDate(start.getUTCDate() - 29);
    } else {
      const [yy, mm] = month.split("-").map(Number);
      start = new Date(Date.UTC(yy, mm - 1, 1));
      end   = new Date(Date.UTC(yy, mm, 0)); // last day of month
      // Cap month view at today — we don't show future dates.
      const today = new Date(`${istTodayIso}T00:00:00Z`);
      if (end.getTime() > today.getTime()) end = today;
    }

    // Clamp the start to the day my account was created so we don't
    // render "Absent" rows for days before I started using the app.
    // If my account was created mid-period, the log starts at that day.
    // If `appStartIso` is past `end`, the loop yields no rows.
    if (appStartIso) {
      const appStart = new Date(`${appStartIso}T00:00:00Z`);
      if (appStart.getTime() > start.getTime()) start = appStart;
    }

    const out: any[] = [];
    for (let d = new Date(start.getTime()); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const rec = byDate.get(iso);
      if (rec) {
        out.push(rec);
      } else {
        const dow = d.getUTCDay(); // 0 = Sun, 6 = Sat
        const isWeekend = dow === 0 || dow === 6;
        const isToday = iso === istTodayIso;
        out.push({
          id: `synthetic-${iso}`,
          date: `${iso}T00:00:00.000Z`,
          clockIn: null,
          clockOut: null,
          totalMinutes: 0,
          // For today with no record yet → "pending" so the existing
          // "Not clocked in yet" branch renders. Weekends → "weekly_off"
          // (rendering looks at isWeekend, not status, but this keeps the
          // status field meaningful for any future consumers). Other gaps →
          // "absent" (no clock-in on a working day).
          status: isToday ? "pending" : isWeekend ? "weekly_off" : "absent",
          location: null,
        });
      }
    }
    // Newest first, matching the original ordering.
    out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return out;
  })();

  // Month period buttons (30 DAYS + last 6 months). Each month carries its
  // YYYY-MM key so December/November correctly fall into the previous year
  // when we're early in the current year.
  type PeriodBtn = { kind: "30d" } | { kind: "month"; label: string; key: string };
  const periodBtns: PeriodBtn[] = [
    { kind: "30d" },
    ...Array.from({ length: 6 }, (_, i): PeriodBtn => {
      const anchor = clock ?? new Date();
      const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
      return {
        kind: "month",
        label: d.toLocaleString("default", { month: "short" }).toUpperCase(),
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      };
    }),
  ];

  const periodLabel = (() => {
    if (period === "30d") return "Last 30 Days";
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });
  })();

  return (
    <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">

      {/* ── Top Module Tabs ── */}
      <div className="flex items-center bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-4">
        {TOP_TABS.map((t) => (
          <Link key={t.key} href={t.href}
            className={`px-4 py-3 text-[11px] font-bold tracking-widest transition-colors border-b-2 whitespace-nowrap ${
              t.key === "attendance"
                ? "border-[#008CFF] text-[#008CFF]"
                : "border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
            }`}>
            {t.label}
          </Link>
        ))}
      </div>

      {/* ── 3-Panel Header ── */}
      <div className="grid grid-cols-3 bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06]">

        {/* ── Panel 1: Attendance Stats ── */}
        <div className="p-5 border-r border-slate-200 dark:border-white/[0.06]">
          <h3 className="text-[13px] font-bold text-slate-800 dark:text-white mb-3">Attendance Stats</h3>

          {/* Period label (matches the API window) + info icon */}
          <div className="flex items-center justify-between mb-3">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-700 dark:text-white">
              {teamStats?.period?.label || "Last 7 Days"}
            </span>
            <span title="Average effective hours and on-time arrival across the window.">
              <Info size={13} strokeWidth={1.75} className="text-slate-400" />
            </span>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[1fr_90px_90px] mb-1 px-3">
            <span />
            <span className="text-[9px] uppercase tracking-widest text-slate-400 font-bold text-right">AVG HRS / DAY</span>
            <span className="text-[9px] uppercase tracking-widest text-slate-400 font-bold text-right">ON TIME ARRIVAL</span>
          </div>

          {/* Me row — falls back to local calc if the team-stats request is still loading. */}
          <div className="grid grid-cols-[1fr_90px_90px] items-center py-3 px-3 rounded-lg bg-slate-50 dark:bg-[#002140]/60 mb-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center shrink-0">
                <User size={14} strokeWidth={2} className="text-white" />
              </div>
              <span className="text-[13px] font-semibold text-slate-800 dark:text-white">Me</span>
            </div>
            <span className="text-[15px] font-bold text-slate-800 dark:text-white text-right">
              {fmtMins(teamStats?.me?.avgMinutes ?? avgMins)}
            </span>
            <span className="text-[15px] font-bold text-slate-800 dark:text-white text-right">
              {(teamStats?.me?.onTimePct ?? onTimePct)}%
            </span>
          </div>

          {/* My Team row — resolves peers by matching teamCapsule. */}
          <div className="grid grid-cols-[1fr_90px_90px] items-center py-3 px-3 rounded-lg bg-slate-50 dark:bg-[#002140]/60">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-[#008CFF] flex items-center justify-center shrink-0">
                <Users size={13} strokeWidth={2} className="text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-slate-800 dark:text-white leading-tight">My Team</p>
                {teamStats?.team?.teamCapsule && (
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight truncate">
                    {teamStats.team.teamCapsule} · {teamStats.team.memberCount} {teamStats.team.memberCount === 1 ? "member" : "members"}
                  </p>
                )}
                {!teamStats?.team?.teamCapsule && teamStats && (
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">No team assigned</p>
                )}
              </div>
            </div>
            <span className="text-[15px] font-bold text-slate-800 dark:text-white text-right">
              {teamStats?.team?.memberCount ? fmtMins(teamStats.team.avgMinutes) : "—"}
            </span>
            <span className="text-[15px] font-bold text-slate-800 dark:text-white text-right">
              {teamStats?.team?.memberCount ? `${teamStats.team.onTimePct}%` : "—"}
            </span>
          </div>
        </div>

        {/* ── Panel 2: Timings ── */}
        <div className="p-5 border-r border-slate-200 dark:border-white/[0.06]">
          <h3 className="text-[13px] font-bold text-slate-800 dark:text-white mb-3">Timings</h3>

          {/* Week day circles — past days render darker + slightly blurred
              so "done" days visually recede and the eye lands on today. */}
          <div className="flex items-center gap-1.5 mb-4">
            {days.map((d, i) => {
              const isToday = i === todayDow;
              const isPast  = i < todayDow;
              return (
                <div
                  key={i}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                    isToday
                      ? "bg-[#00BCD4] text-white shadow-sm shadow-[#00BCD4]/40"
                      : isPast
                      ? "bg-slate-300 dark:bg-[#05101c] text-slate-500 dark:text-slate-600 border border-slate-300 dark:border-white/[0.03] opacity-60 blur-[0.4px]"
                      : "bg-slate-100 dark:bg-white/[0.07] text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-white/[0.06]"
                  }`}
                >{d}</div>
              );
            })}
          </div>

          {/* Shift info */}
          <p className="text-[12px] font-medium text-slate-600 dark:text-slate-400 mb-3">Today (9:00 AM - 6:00 PM)</p>

          {/* Timeline progress bar: grey track, yellow half-day bands where the
              user missed a half, cyan fill = elapsed / 9 h. Progress starts at 0
              and grows in real time from clock-in, independent of whether the
              session falls inside or outside the 9:00–18:00 window. */}
          {(() => {
            const elapsedPct = todayRec?.clockIn
              ? Math.min(100, (elapsedMins / SHIFT_LEN) * 100)
              : 0;
            return (
              <div className="relative w-full h-3 bg-slate-100 dark:bg-white/[0.07] rounded-full overflow-hidden">
                {missedFirstHalf && (
                  <div className="absolute inset-y-0 bg-amber-400/80" style={{ left: "0%", width: `${MID_PCT}%` }} />
                )}
                {missedSecondHalf && (
                  <div className="absolute inset-y-0 bg-amber-400/80" style={{ left: `${MID_PCT}%`, width: `${100 - MID_PCT}%` }} />
                )}
                {elapsedPct > 0 && (
                  <div className="absolute inset-y-0 left-0 bg-[#00BCD4] transition-all duration-500" style={{ width: `${elapsedPct}%` }} />
                )}
                {/* Subtle 2 PM marker so the half-day boundary is readable. */}
                <div className="absolute inset-y-0 w-px bg-slate-300/70 dark:bg-white/10" style={{ left: `${MID_PCT}%` }} />
              </div>
            );
          })()}

          <div className="flex items-center justify-between mt-2">
            <p className="text-[11px] font-medium text-slate-500 dark:text-[#00BCD4]" suppressHydrationWarning>
              Duration: {todayRec?.clockIn ? elapsedStr : "0h 0m"}
            </p>
            <div className="flex items-center gap-1 text-[11px] text-slate-500" suppressHydrationWarning>
              <Clock3 size={11} strokeWidth={1.75} />
              {remainingLabel}
            </div>
          </div>
        </div>

        {/* ── Panel 3: Actions ── */}
        <div className="p-5">
          <h3 className="text-[13px] font-bold text-slate-800 dark:text-white mb-3">Actions</h3>

          {/* 2-col layout: left = clock+date+totals, right = button+links+elapsed */}
          <div className="flex items-start gap-3">

            {/* Left column */}
            <div className="flex flex-col gap-1 shrink-0">
              {/* Clock box */}
              <div className="bg-slate-50 dark:bg-[#0a1526] border border-slate-200 dark:border-white/[0.08] rounded-lg px-3 py-2 min-w-[148px]">
                <p className="font-bold text-slate-800 dark:text-white leading-none whitespace-nowrap" suppressHydrationWarning
                  style={{ fontSize: "1.25rem", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                  {clock
                    ? clock.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: !use24 }).replace(/\s?(am|pm)/i, "")
                    : "--:--:--"}
                  {!use24 && clock && (
                    <span className="text-[12px] font-bold ml-1.5">{clock.getHours() >= 12 ? "PM" : "AM"}</span>
                  )}
                </p>
              </div>

              {/* Date */}
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400" suppressHydrationWarning>
                {clock ? clock.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "2-digit", month: "short", year: "numeric" }) : ""}
              </p>

              {/* Total hours */}
              <div className="mt-1">
                <div className="flex items-center gap-1 text-[9px] text-slate-500 uppercase tracking-widest font-bold mb-1">
                  TOTAL HOURS <Info size={10} strokeWidth={2} />
                </div>
                <p className="text-[12px] text-slate-600 dark:text-slate-400 leading-5">
                  Effective: <span className="font-bold text-slate-800 dark:text-white">{todayRec?.clockIn ? elapsedStr : "0h 0m"}</span>
                </p>
                <p className="text-[12px] text-slate-600 dark:text-slate-400 leading-5">
                  Gross: <span className="font-bold text-slate-800 dark:text-white">{todayRec?.clockIn ? elapsedStr : "0h 0m"}</span>
                </p>
              </div>
            </div>

            {/* Right column: button → quick links → elapsed */}
            <div className="flex flex-col gap-2">
              {/* Location permission warning — attendance requires location. */}
              {!todayRec?.clockIn && locPerm === "denied" && (
                <div className="max-w-xs px-3 py-2 rounded-md bg-red-50 text-red-700 border border-red-200 text-[11px] leading-snug">
                  <strong>Location access blocked.</strong> You must enable location in your browser settings to clock in. Reload the page after allowing it.
                </div>
              )}
              {!todayRec?.clockIn && locPerm === "unsupported" && (
                <div className="max-w-xs px-3 py-2 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-[11px] leading-snug">
                  <strong>Location unavailable.</strong> Your browser can't share your location (HTTPS or a supported browser is required). Clock-in needs location.
                </div>
              )}
              {/* Button */}
              {!todayRec?.clockIn ? (
                <button onClick={clockIn}
                  disabled={clockingIn}
                  className="h-9 px-5 bg-[#ff4a5c] hover:bg-[#ff3045] text-white rounded-lg text-[13px] font-bold transition-colors shadow-sm whitespace-nowrap w-fit disabled:opacity-70 disabled:cursor-wait">
                  {clockingIn ? "Getting location…" : "Web Clock-In"}
                </button>
              ) : !todayRec?.clockOut ? (
                <button onClick={clockOut}
                  className="h-9 px-5 bg-[#ff4a5c] hover:bg-[#ff3045] text-white rounded-lg text-[13px] font-bold transition-colors shadow-sm whitespace-nowrap w-fit">
                  Web Clock-Out
                </button>
              ) : (
                <span className="h-9 px-5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 rounded-lg text-[13px] font-bold flex items-center whitespace-nowrap w-fit">
                  ✓ Day Complete
                </span>
              )}

              {/* Elapsed since clock-in — lives right under the button, Keka-style */}
              {todayRec?.clockIn && (
                <div className="w-fit">
                  <p className="text-[14px] font-bold text-[#008CFF] leading-none tabular-nums">
                    {elapsedStr.replace(" ", ":")}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Since {todayRec.clockOut ? "Last Clock-in" : "Last Login"}
                  </p>
                </div>
              )}

              {/* Quick links */}
              <div className="flex flex-col gap-1.5">
                {[
                  { label: "Work From Home",    Icon: Home,       onClick: () => openForm("wfh")       },
                  { label: "On Duty",           Icon: Briefcase,  onClick: () => openForm("on_duty")   },
                  { label: "Regularization",    Icon: ShieldCheck,onClick: () => { setSubTab("requests"); setReqType("punch"); setShowRegModal(true); } },
                  { label: "Apply Leave",       Icon: Coffee,     onClick: () => openForm("leave")     },
                ].map(({ label, Icon, onClick }) => (
                  <button key={label} onClick={onClick}
                    className="flex items-center gap-1.5 text-[12px] font-medium text-[#008CFF] hover:underline w-fit">
                    <Icon size={12} strokeWidth={1.75} />
                    {label}
                  </button>
                ))}
            </div>
          </div>
        </div>
        </div>{/* end Panel 3 */}
      </div>{/* end 3-panel header */}

      {/* ── Logs & Requests ── */}
      <div className="px-6 pt-5 pb-8">

        {/* Section header */}
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[15px] font-semibold text-slate-800 dark:text-white">Logs & Requests</h3>
          {/* 24-hour format toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">24 hour format</span>
            <div onClick={() => setUse24(v => !v)}
              className={`w-9 h-5 rounded-full relative transition-colors duration-200 ${use24 ? "bg-[#008CFF]" : "bg-slate-200 dark:bg-white/10"}`}>
              <div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 transition-all duration-200 shadow ${use24 ? "left-[calc(100%-18px)]" : "left-0.5"}`} />
            </div>
          </label>
        </div>

        {/* Sub-tabs */}
        <div className="flex gap-0 border-b border-slate-200 dark:border-white/[0.06] mb-5">
          {([
            ["log",      "Attendance Log"],
            ["calendar", "Calendar"],
            ["requests", "Attendance Requests"],
          ] as const).map(([k, l]) => (
            <button key={k} onClick={() => setSubTab(k as any)}
              className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap ${
                subTab === k
                  ? "border-[#008CFF] text-[#008CFF]"
                  : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white"
              }`}>{l}</button>
          ))}
        </div>

        {subTab === "log" && (
          <>
            {/* Period row */}
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-[14px] font-semibold text-slate-800 dark:text-white">{periodLabel}</h4>
              <div className="flex items-center gap-1">
                {periodBtns.map((btn, i) => {
                  const isActive = btn.kind === "30d" ? period === "30d" : (period === "month" && month === btn.key);
                  const label    = btn.kind === "30d" ? "30 DAYS" : btn.label;
                  return (
                    <button
                      key={btn.kind === "30d" ? "30d" : btn.key}
                      type="button"
                      onClick={() => {
                        if (btn.kind === "30d") setPeriod("30d");
                        else { setPeriod("month"); setMonth(btn.key); }
                      }}
                      className={`h-8 px-3 rounded-full text-[11px] font-semibold transition-colors ${
                        isActive
                          ? "bg-[#008CFF] text-white"
                          : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-800 dark:hover:text-white"
                      }`}
                    >{label}</button>
                  );
                })}
                {/* List/Calendar toggle — mirrors the sub-tab switcher above
                    so users can flip between log and calendar views from the
                    period row as well. */}
                <div className="flex ml-2 border border-slate-200 dark:border-white/[0.08] rounded-lg overflow-hidden">
                  {/* Rendered inside `subTab === "log"`; TS narrows subTab
                      here, so the List toggle is always pressed and the
                      Calendar toggle is always unpressed. */}
                  <button
                    type="button"
                    aria-label="List view"
                    aria-pressed={true}
                    onClick={() => setSubTab("log")}
                    className="px-2 py-1.5 bg-[#008CFF]/10 text-[#008CFF]"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    aria-label="Calendar view"
                    aria-pressed={false}
                    onClick={() => setSubTab("calendar")}
                    className="px-2 py-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* Table — overflow-visible so row kebab dropdowns aren't clipped. */}
            <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-visible">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-white/[0.06] bg-slate-50/60 dark:bg-white/[0.02]">
                    {["DATE","TIMELINE","EFFECTIVE","GROSS","LOG",""].map((h) => (
                      <th key={h || "actions"} className="px-5 py-3 text-left text-[10.5px] uppercase tracking-[0.14em] font-bold text-slate-500 dark:text-slate-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recsWithToday.map((rec: any) => {
                    const date      = new Date(rec.date);
                    const dateIso   = String(rec.date).slice(0, 10);
                    const isTodayRow = dateIso === istTodayIso;
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                    const isHoliday = rec.status === "holiday";
                    const isLeave   = rec.status === "on_leave";
                    const isPending = rec.status === "pending" && !rec.clockIn;
                    // Has a pending request for this date? Any type (regularize, WFH,
                    // On-Duty, or Leave that covers this date) flips the row to
                    // "Pending approval" and disables re-submission of the same kind.
                    const hasPendingReg = Array.isArray(regsData) && regsData.some(
                      (r: any) => r.status === "pending" && String(r.date).slice(0, 10) === dateIso
                    );
                    const hasPendingWfh = Array.isArray(wfhData) && wfhData.some(
                      (r: any) => r.status === "pending" && String(r.date).slice(0, 10) === dateIso
                    );
                    const hasPendingOd  = Array.isArray(odData) && odData.some(
                      (r: any) => r.status === "pending" && String(r.date).slice(0, 10) === dateIso
                    );
                    const hasPendingLeave = myLeaves.some((l: any) => {
                      if (l.status !== "pending" && l.status !== "partially_approved") return false;
                      const from = String(l.fromDate).slice(0, 10);
                      const to   = String(l.toDate).slice(0, 10);
                      return dateIso >= from && dateIso <= to;
                    });
                    const pendingKind =
                      hasPendingReg   ? "regularization" :
                      hasPendingLeave ? "leave" :
                      hasPendingWfh   ? "WFH" :
                      hasPendingOd    ? "On-Duty" :
                      null;
                    const hasPendingAny = pendingKind !== null;
                    // Approved WFH for this date — drives the "WFH" / "Half Day WFH" attendance label.
                    const approvedWfh = Array.isArray(wfhData) && wfhData.find(
                      (r: any) => r.status === "approved" && String(r.date).slice(0, 10) === dateIso
                    );
                    const approvedWfhKind = approvedWfh
                      ? (String(approvedWfh.reason ?? "").startsWith("[Half Day]") ? "Half Day WFH" : "WFH")
                      : null;
                    // Approved leave that covers this date — shows "On Leave" plus the type name.
                    const approvedLeave = myLeaves.find((l: any) => {
                      if (l.status !== "approved") return false;
                      const from = String(l.fromDate).slice(0, 10);
                      const to   = String(l.toDate).slice(0, 10);
                      return dateIso >= from && dateIso <= to;
                    });
                    const onLeave = !!approvedLeave || rec.status === "on_leave";
                    const leaveLabel = approvedLeave?.leaveType?.name
                      ? `On Leave · ${approvedLeave.leaveType.name}`
                      : "On Leave";

                    // Specific request rows for this date — used to surface the
                    // requested time window in the centered text label.
                    const pendingRegRow = Array.isArray(regsData)
                      ? regsData.find((r: any) => (r.status === "pending" || r.status === "partially_approved") && String(r.date).slice(0, 10) === dateIso)
                      : null;
                    const approvedRegRow = Array.isArray(regsData)
                      ? regsData.find((r: any) => r.status === "approved" && String(r.date).slice(0, 10) === dateIso)
                      : null;
                    const pendingLeaveRow = myLeaves.find((l: any) => {
                      if (l.status !== "pending" && l.status !== "partially_approved") return false;
                      const from = String(l.fromDate).slice(0, 10);
                      const to   = String(l.toDate).slice(0, 10);
                      return dateIso >= from && dateIso <= to;
                    });
                    const fmtT = (d: any) => d
                      ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })
                      : null;
                    const regWindow = (r: any) => r?.requestedIn && r?.requestedOut
                      ? `${fmtT(r.requestedIn)} → ${fmtT(r.requestedOut)}`
                      : null;
                    // Missed clock-out: clocked in on a past day but never clocked out.
                    // Either the server has already flagged it (status === "missed_clock_out")
                    // or the sweeper hasn't run yet but the row is stale. Either way, we must
                    // NOT tick the timer — otherwise the display drifts to 24h+ forever.
                    // Once a regularization is approved (isRegularized = true), the row is
                    // considered settled regardless of whether clockOut got a value, so the
                    // missed-clockout banner clears. Same for on-leave days.
                    // NOTE: `onLeave` is computed a few lines down but declared via `var`-like
                    // hoisting via `const` isn't possible; we inline the same check here.
                    const _onLeaveQuickCheck = rec.status === "on_leave" || myLeaves.some((l: any) => {
                      if (l.status !== "approved") return false;
                      const from = String(l.fromDate).slice(0, 10);
                      const to   = String(l.toDate).slice(0, 10);
                      return dateIso >= from && dateIso <= to;
                    });
                    const missedClockOut = rec.clockIn && !rec.clockOut && !isTodayRow && !rec.isRegularized && !_onLeaveQuickCheck;
                    // Live elapsed: only for today's open session. Past days freeze at the
                    // recorded totalMinutes (which is 0 until a regularization lands).
                    const liveMins  = isTodayRow && rec.clockIn && !rec.clockOut && clock
                      ? Math.floor((clock.getTime() - new Date(rec.clockIn).getTime()) / 60000)
                      : (rec.totalMinutes || 0);
                    const hrs       = liveMins ? fmtMins(liveMins) : "0h 0m";
                    const pct       = liveMins ? Math.min((liveMins / 540) * 100, 100) : 0;
                    const met9h     = liveMins >= 540;
                    const hasClock  = !!rec.clockIn;

                    return (
                      <tr key={rec.id || rec.date}
                        className={`border-b border-slate-100 dark:border-white/[0.04] transition-colors ${
                          isTodayRow ? "bg-[#008CFF]/5 dark:bg-[#008CFF]/5"
                          : isHoliday ? "bg-amber-50/60 dark:bg-yellow-900/10"
                          : isWeekend ? "bg-slate-50/80 dark:bg-white/[0.015]"
                          : "hover:bg-slate-50/50 dark:hover:bg-white/[0.02]"
                        }`}>

                        {/* DATE */}
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] text-slate-800 dark:text-white font-medium">
                              {date.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "2-digit", month: "short" })}
                            </span>
                            {isTodayRow && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#008CFF]/15 text-[#008CFF] font-bold uppercase tracking-wider">Today</span>
                            )}
                            {isHoliday && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-600 dark:text-amber-400 font-bold">HLDY</span>
                            )}
                            {isWeekend && !isHoliday && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-slate-500 dark:text-slate-400 font-bold">W-OFF</span>
                            )}
                            {onLeave && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 font-bold">LEAVE</span>
                            )}
                            {missedClockOut && !hasPendingAny && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold uppercase tracking-wider">Missed</span>
                            )}
                            {hasPendingAny && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#008CFF]/15 text-[#008CFF] font-bold uppercase tracking-wider">Pending</span>
                            )}
                            {!hasPendingAny && approvedWfhKind && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold uppercase tracking-wider">
                                {approvedWfhKind}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* ATTENDANCE VISUAL — centered text labels for non-clocked rows
                            (matches the admin profile's attendance tab format). */}
                        <td className="px-5 py-3">
                          {hasPendingAny ? (
                            <span className="text-[12px] font-medium text-amber-600 dark:text-amber-400">
                              {pendingKind === "regularization" && pendingRegRow
                                ? `Regularization Pending${regWindow(pendingRegRow) ? ` · ${regWindow(pendingRegRow)}` : ""}`
                                : pendingKind === "leave" && pendingLeaveRow
                                  ? `Leave Pending — ${pendingLeaveRow?.leaveType?.name || "Leave"}`
                                  : pendingKind === "WFH"
                                    ? "WFH Pending Approval"
                                    : pendingKind === "On-Duty"
                                      ? "On-Duty Pending Approval"
                                      : `Pending ${pendingKind}`}
                            </span>
                          ) : missedClockOut ? (
                            <span className="text-[12px] font-medium text-amber-600 dark:text-amber-400">
                              Missed clock-out — regularize to log hours
                            </span>
                          ) : hasClock ? (
                            <div className="flex items-center gap-3">
                              <TimelineBar liveMins={liveMins} />
                              <LocationPin raw={rec.location} />
                            </div>
                          ) : approvedRegRow && !rec.clockIn ? (
                            <span className="text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
                              Regularized{regWindow(approvedRegRow) ? ` · ${regWindow(approvedRegRow)}` : ""}
                            </span>
                          ) : isHoliday ? (
                            <span className="text-[12px] font-medium text-amber-600 dark:text-amber-400">Holiday</span>
                          ) : isWeekend ? (
                            <span className="text-[12px] text-slate-500 dark:text-slate-400">Full day Weekly-off</span>
                          ) : onLeave ? (
                            <span className="text-[12px] font-medium text-violet-600 dark:text-violet-400">{leaveLabel}</span>
                          ) : isTodayRow ? (
                            <span className="text-[12px] font-medium text-[#008CFF]">Not clocked in yet</span>
                          ) : (
                            <span className="text-[12px] text-slate-400">—</span>
                          )}
                        </td>

                        {/* EFFECTIVE HOURS */}
                        <td className="px-5 py-3">
                          {missedClockOut ? (
                            <span className="text-[12px] text-slate-400">—</span>
                          ) : liveMins > 0 ? (
                            <div className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full shrink-0 ${pct >= 90 ? "bg-emerald-400" : pct >= 50 ? "bg-[#008CFF]" : "bg-orange-400"}`} />
                              <span className="text-[13px] text-slate-800 dark:text-white">{hrs}</span>
                              {pct < 90 && <span className="text-[11px] text-slate-400">+</span>}
                            </div>
                          ) : (isHoliday || isWeekend) ? (
                            <span className="text-slate-400 text-lg">···</span>
                          ) : null}
                        </td>

                        {/* GROSS HOURS */}
                        <td className="px-5 py-3 text-[13px] text-slate-700 dark:text-slate-300">
                          {missedClockOut
                            ? <span className="text-slate-400">—</span>
                            : liveMins > 0
                              ? hrs
                              : (isHoliday || isWeekend)
                                ? <span className="text-slate-400 text-lg">···</span>
                                : ""}
                        </td>

                        {/* LOG: 9h threshold \u2192 green tick when met, red cross otherwise (once clocked in). */}
                        {/* LOG — icon-only with a hover tooltip describing the
                            row state (e.g. "Present | Missing Swipe(s)" for a
                            partial day, "On Leave · Sick Leave" when leave
                            covers the date). Replaces the old status pill so
                            the row stays compact. */}
                        <td className="px-5 py-3">
                          {(() => {
                            type Cell = { label: string; Icon: typeof CheckCircle2; tone: string };
                            let c: Cell;
                            if (hasPendingAny) {
                              const which =
                                pendingKind === "regularization" ? "Regularization Pending"
                                : pendingKind === "leave"          ? "Leave Pending"
                                : pendingKind === "WFH"            ? "WFH Pending"
                                : pendingKind === "On-Duty"        ? "On-Duty Pending"
                                : "Pending";
                              c = { label: which, Icon: Clock3, tone: "text-[#008CFF]" };
                            } else if (missedClockOut) {
                              c = { label: "Missed clock-out", Icon: AlertCircle, tone: "text-amber-500" };
                            } else if (onLeave) {
                              c = { label: leaveLabel, Icon: Coffee, tone: "text-violet-500" };
                            } else if (isHoliday) {
                              c = { label: "Holiday", Icon: CalendarDays, tone: "text-amber-500" };
                            } else if (isWeekend) {
                              c = { label: "Weekly Off", Icon: Calendar, tone: "text-slate-400" };
                            } else if (isTodayRow && !hasClock) {
                              c = { label: "Awaiting clock-in", Icon: Clock3, tone: "text-[#008CFF]" };
                            } else if (hasClock && met9h) {
                              c = { label: "Present", Icon: CheckCircle2, tone: "text-emerald-500" };
                            } else if (hasClock) {
                              c = { label: "Present | Missing Swipe(s)", Icon: AlertCircle, tone: "text-orange-500" };
                            } else {
                              c = { label: "Absent", Icon: XCircle, tone: "text-rose-500" };
                            }
                            const Icon = c.Icon;
                            return (
                              <span className="group relative inline-flex">
                                <Icon size={20} strokeWidth={2} className={c.tone} />
                                <span
                                  role="tooltip"
                                  className="pointer-events-none absolute right-full top-1/2 z-20 mr-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg ring-1 ring-white/[0.06] transition-opacity duration-150 group-hover:opacity-100 dark:bg-slate-900"
                                >
                                  {c.label}
                                </span>
                              </span>
                            );
                          })()}
                        </td>

                        {/* ACTIONS: kebab menu \u2192 Regularize */}
                        <td className="px-5 py-3">
                          {(isHoliday || isWeekend) ? (
                            <span className="text-slate-300 text-lg">···</span>
                          ) : (
                            <RowMenu
                              onRegularize={() => { setRegPrefillDate(dateIso); setShowRegModal(true); }}
                              onWFH={() => openForm("wfh", dateIso)}
                              onOnDuty={() => openForm("on_duty", dateIso)}
                              onLeave={() => openForm("leave", dateIso)}
                              disableRegularize={hasPendingReg}
                              disableRegularizeReason="You already have a pending regularization for this date"
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {records.length === 0 && (
                <p className="text-[13px] text-slate-400 text-center py-14">No attendance records for this period</p>
              )}
            </div>
          </>
        )}

        {subTab === "calendar" && (
          <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-white/[0.06]">
              <input type="month" value={month} onChange={e => setMonth(e.target.value)}
                className="h-9 px-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white focus:outline-none" />
              {/* Same List/Calendar toggle — mirrors the one in the log view. */}
              <div className="flex border border-slate-200 dark:border-white/[0.08] rounded-lg overflow-hidden">
                <button
                  type="button"
                  aria-label="List view"
                  aria-pressed={false}
                  onClick={() => setSubTab("log")}
                  className="px-2 py-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label="Calendar view"
                  aria-pressed={true}
                  className="px-2 py-1.5 bg-[#008CFF]/10 text-[#008CFF]"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7">
              {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
                <div key={d} className="p-3 text-center text-[11px] uppercase tracking-wider text-slate-500 font-medium border-b border-slate-100 dark:border-white/[0.04] bg-slate-50 dark:bg-white/[0.02]">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {(() => {
                const [y, m] = month.split("-").map(Number);
                const firstDay = new Date(y, m - 1, 1).getDay();
                const daysInMonth = new Date(y, m, 0).getDate();
                const recMap = new Map(records.map((r: any) => [new Date(r.date).getDate(), r]));
                const cells = [];
                for (let i = 0; i < firstDay; i++)
                  cells.push(<div key={`e${i}`} className="border-b border-r border-slate-100 dark:border-white/[0.03] min-h-[70px]" />);
                for (let d = 1; d <= daysInMonth; d++) {
                  const rec = recMap.get(d) as any;
                  const dd = new Date(y, m - 1, d);
                  const isWeekend = dd.getDay() === 0 || dd.getDay() === 6;
                  const isToday   = d === now.getDate() && m === now.getMonth() + 1 && y === now.getFullYear();
                  cells.push(
                    <div key={d} className={`border-b border-r border-slate-100 dark:border-white/[0.03] p-2 min-h-[70px] ${isToday ? "ring-1 ring-inset ring-[#008CFF]/30 bg-[#008CFF]/5" : ""} ${isWeekend ? "bg-slate-50 dark:bg-white/[0.015]" : ""}`}>
                      <span className={`text-[12px] font-medium ${isToday ? "text-[#008CFF]" : "text-slate-500 dark:text-slate-400"}`}>{d}</span>
                      {rec?.clockIn  && <p className="text-[10px] text-slate-400 mt-0.5">In: {new Date(rec.clockIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>}
                      {rec?.clockOut && <p className="text-[10px] text-slate-400">Out: {new Date(rec.clockOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>}
                      {rec?.status === "holiday" && <span className="text-[9px] px-1 rounded bg-amber-400/20 text-amber-500 mt-0.5 inline-block font-bold">HLDY</span>}
                    </div>
                  );
                }
                return cells;
              })()}
            </div>
          </div>
        )}

        {subTab === "requests" && (
          <>
            {/* Request type + team toggle */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="flex border border-slate-200 dark:border-white/[0.08] rounded-lg overflow-hidden">
                  {([["punch","Regularizations"],["wfh","WFH Requests"],["od","On Duty"]] as const).map(([v, l]) => (
                    <button key={v} onClick={() => setReqType(v)}
                      className={`px-3 py-1.5 text-[11px] font-semibold transition-colors ${reqType === v ? "bg-[#008CFF] text-white" : "text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5"}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              {reqType === "punch" && (
                <button onClick={() => setShowRegModal(true)}
                  className="h-8 px-4 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[12px] font-semibold flex items-center gap-1.5">
                  <Plus size={13} strokeWidth={2} /> New Request
                </button>
              )}
              {reqType === "wfh" && (
                <button onClick={() => openForm("wfh")}
                  className="h-8 px-4 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[12px] font-semibold flex items-center gap-1.5">
                  <Plus size={13} strokeWidth={2} /> New WFH
                </button>
              )}
              {reqType === "od" && (
                <button onClick={() => openForm("on_duty")}
                  className="h-8 px-4 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[12px] font-semibold flex items-center gap-1.5">
                  <Plus size={13} strokeWidth={2} /> New On Duty
                </button>
              )}
            </div>

            {/* Regularizations table */}
            {reqType === "punch" && (
              <div className={`${C.card} overflow-hidden`}>
                {regsData.length === 0 ? (
                  <div className="py-14 text-center"><p className="text-[13px] text-slate-400">No regularization requests found</p></div>
                ) : (
                  <table className="w-full">
                    <thead><tr className="border-b border-slate-200 dark:border-white/[0.06]">
                      {[...(regView === "team" ? ["EMPLOYEE"] : []), "DATE","REQ IN","REQ OUT","REASON","STATUS","ACTIONS"].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-[10px] uppercase tracking-widest text-[#008CFF] dark:text-[#00BCD4] font-semibold">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {regsData.map((r: any) => (
                        <tr key={r.id} className="border-b border-slate-100 dark:border-white/[0.04] hover:bg-slate-50/50 dark:hover:bg-white/[0.015]">
                          {regView === "team" && <td className="px-5 py-3 text-[12px] text-slate-800 dark:text-white font-medium">{r.user?.name}</td>}
                          <td className="px-5 py-3 text-[12px] text-slate-600 dark:text-slate-300">{new Date(r.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                          <td className="px-5 py-3 text-[12px] text-slate-800 dark:text-white">{r.requestedIn ? new Date(r.requestedIn).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                          <td className="px-5 py-3 text-[12px] text-slate-800 dark:text-white">{r.requestedOut ? new Date(r.requestedOut).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                          <td className="px-5 py-3 text-[12px] text-slate-500 dark:text-slate-400 max-w-[180px] truncate">{r.reason}</td>
                          <td className="px-5 py-3">
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${r.status === "approved" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : r.status === "rejected" ? "bg-red-500/10 text-red-500 dark:text-red-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>
                              {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            {regView === "team" && r.status === "pending" && (
                              <div className="flex items-center gap-1.5">
                                <button onClick={async () => { await fetch("/api/hr/attendance/regularize", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, action: "approve" }) }); mutate((k: string) => typeof k === "string" && k.includes("/api/hr/attendance/regularize")); }} className="h-6 px-2.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded text-[11px] font-semibold">Approve</button>
                                <button onClick={async () => { await fetch("/api/hr/attendance/regularize", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, action: "reject" }) }); mutate((k: string) => typeof k === "string" && k.includes("/api/hr/attendance/regularize")); }} className="h-6 px-2.5 bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400 rounded text-[11px] font-semibold">Reject</button>
                              </div>
                            )}
                            {r.approvalNote && <p className="text-[10px] text-slate-400 mt-0.5 max-w-[140px] truncate">Note: {r.approvalNote}</p>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* WFH Requests table */}
            {reqType === "wfh" && (
              <div className={`${C.card} overflow-hidden`}>
                {wfhData.length === 0 ? (
                  <div className="py-14 text-center"><p className="text-[13px] text-slate-400">No WFH requests found</p></div>
                ) : (
                  <table className="w-full">
                    <thead><tr className="border-b border-slate-200 dark:border-white/[0.06]">
                      {[...(regView === "team" ? ["EMPLOYEE"] : []), "DATE","REASON","APPLIED ON","STATUS","ACTIONS"].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-[10px] uppercase tracking-widest text-[#008CFF] dark:text-[#00BCD4] font-semibold">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {wfhData.map((r: any) => (
                        <tr key={r.id} className="border-b border-slate-100 dark:border-white/[0.04] hover:bg-slate-50/50 dark:hover:bg-white/[0.015]">
                          {regView === "team" && <td className="px-5 py-3 text-[12px] text-slate-800 dark:text-white font-medium">{r.user?.name}</td>}
                          <td className="px-5 py-3 text-[12px] text-slate-800 dark:text-white">{new Date(r.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                          <td className="px-5 py-3 text-[12px] text-slate-500 dark:text-slate-400 max-w-[200px] truncate">{r.reason}</td>
                          <td className="px-5 py-3 text-[12px] text-slate-500">{new Date(r.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                          <td className="px-5 py-3">
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${r.status === "approved" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : r.status === "rejected" ? "bg-red-500/10 text-red-500 dark:text-red-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>
                              {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            {regView === "team" && r.status === "pending" && (
                              <div className="flex items-center gap-1.5">
                                <button onClick={async () => { await fetch("/api/hr/attendance/wfh", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, action: "approve" }) }); mutate((k: string) => typeof k === "string" && k.includes("/api/hr/attendance/wfh")); }} className="h-6 px-2.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded text-[11px] font-semibold">Approve</button>
                                <button onClick={async () => { await fetch("/api/hr/attendance/wfh", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, action: "reject" }) }); mutate((k: string) => typeof k === "string" && k.includes("/api/hr/attendance/wfh")); }} className="h-6 px-2.5 bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400 rounded text-[11px] font-semibold">Reject</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* On Duty Requests table */}
            {reqType === "od" && (
              <div className={`${C.card} overflow-hidden`}>
                {odData.length === 0 ? (
                  <div className="py-14 text-center"><p className="text-[13px] text-slate-400">No On Duty requests found</p></div>
                ) : (
                  <table className="w-full">
                    <thead><tr className="border-b border-slate-200 dark:border-white/[0.06]">
                      {[...(regView === "team" ? ["EMPLOYEE"] : []), "DATE","FROM","TO","PURPOSE","LOCATION","STATUS","ACTIONS"].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-[10px] uppercase tracking-widest text-[#008CFF] dark:text-[#00BCD4] font-semibold">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {odData.map((r: any) => (
                        <tr key={r.id} className="border-b border-slate-100 dark:border-white/[0.04] hover:bg-slate-50/50 dark:hover:bg-white/[0.015]">
                          {regView === "team" && <td className="px-5 py-3 text-[12px] text-slate-800 dark:text-white font-medium">{r.user?.name}</td>}
                          <td className="px-5 py-3 text-[12px] text-slate-800 dark:text-white">{new Date(r.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                          <td className="px-5 py-3 text-[12px] text-slate-500">{r.fromTime ? new Date(r.fromTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                          <td className="px-5 py-3 text-[12px] text-slate-500">{r.toTime ? new Date(r.toTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                          <td className="px-5 py-3 text-[12px] text-slate-500 dark:text-slate-400 max-w-[160px] truncate">{r.purpose}</td>
                          <td className="px-5 py-3 text-[12px] text-slate-500">{r.location || "—"}</td>
                          <td className="px-5 py-3">
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${r.status === "approved" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : r.status === "rejected" ? "bg-red-500/10 text-red-500 dark:text-red-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>
                              {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            {regView === "team" && r.status === "pending" && (
                              <div className="flex items-center gap-1.5">
                                <button onClick={async () => { await fetch("/api/hr/attendance/on-duty", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, action: "approve" }) }); mutate((k: string) => typeof k === "string" && k.includes("/api/hr/attendance/on-duty")); }} className="h-6 px-2.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded text-[11px] font-semibold">Approve</button>
                                <button onClick={async () => { await fetch("/api/hr/attendance/on-duty", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, action: "reject" }) }); mutate((k: string) => typeof k === "string" && k.includes("/api/hr/attendance/on-duty")); }} className="h-6 px-2.5 bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400 rounded text-[11px] font-semibold">Reject</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}

      {showRegModal && (
        <RegularizeModal
          prefillDate={regPrefillDate}
          onClose={() => { setShowRegModal(false); setRegPrefillDate(undefined); }}
        />
      )}
      {formState && (
        <LeaveRequestForm
          kind={formState.kind}
          title={FORM_TITLE[formState.kind]}
          policyText={FORM_POLICY[formState.kind]}
          leaveTypes={leaveTypes}
          prefillDate={formState.prefillDate}
          onClose={() => setFormState(null)}
        />
      )}
      </div>
    </div>
  );
}
