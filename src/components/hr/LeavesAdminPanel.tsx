"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { Search, Sparkles, Plus, Minus, X } from "lucide-react";

type LeaveTypeRow = { id: number; name: string; code: string; daysPerYear: number };
type Bal          = { id: number | null; total: number; used: number; pending: number };
type EmpRow       = {
  id: number; name: string; email: string;
  profilePictureUrl: string | null;
  balances: Record<number, Bal>;
};

/**
 * Leave-balance admin grid. Every employee × leave type cell is a
 * click-to-edit chip showing remaining days. Zero balances render in a
 * quiet slate tone (not "alarming" red) — red is reserved for actually
 * overdrawn balances.
 */
export default function LeavesAdminPanel(_props: { leaveTypes?: any[] }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear]   = useState<number>(currentYear);
  const [query, setQuery] = useState("");

  const url = `/api/hr/admin/leave-balances?year=${year}`;
  const { data, isLoading } = useSWR<{ year: number; leaveTypes: LeaveTypeRow[]; employees: EmpRow[] }>(url, fetcher);

  const leaveTypes = data?.leaveTypes ?? [];
  const employees  = data?.employees ?? [];

  const filtered = useMemo(() => {
    if (!query.trim()) return employees;
    const q = query.trim().toLowerCase();
    return employees.filter((e) =>
      (e.name || "").toLowerCase().includes(q) ||
      (e.email || "").toLowerCase().includes(q)
    );
  }, [employees, query]);

  // ── Edit modal ────────────────────────────────────────────────
  const [editing, setEditing] = useState<{ emp: EmpRow; type: LeaveTypeRow; bal: Bal } | null>(null);
  const [form, setForm] = useState({ total: "", used: "", pending: "" });
  const [busy, setBusy] = useState(false);
  const totalInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    setForm({
      total:   String(editing.bal.total),
      used:    String(editing.bal.used),
      pending: String(editing.bal.pending),
    });
    requestAnimationFrame(() => totalInputRef.current?.select());
  }, [editing]);

  const openEdit = (emp: EmpRow, type: LeaveTypeRow) =>
    setEditing({ emp, type, bal: emp.balances[type.id] });

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const res = await fetch("/api/hr/admin/leave-balances", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId:      editing.emp.id,
          leaveTypeId: editing.type.id,
          year,
          totalDays:   form.total   === "" ? undefined : Number(form.total),
          usedDays:    form.used    === "" ? undefined : Number(form.used),
          pendingDays: form.pending === "" ? undefined : Number(form.pending),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "Save failed");
        return;
      }
      setEditing(null);
      mutate(url);
    } finally { setBusy(false); }
  };

  const adjustTotal = (delta: number) => {
    setForm((f) => {
      const next = Math.max(0, Number(f.total || 0) + delta);
      return { ...f, total: String(next) };
    });
  };

  // ── Bulk action: seed every employee's TOTAL for one type to its policy. ──
  const [bulkBusy, setBulkBusy] = useState(false);
  const seedDefaults = async (typeId: number | "all") => {
    const targets = typeId === "all" ? leaveTypes : leaveTypes.filter((t) => t.id === typeId);
    if (targets.length === 0) return;
    const summary = targets.map((t) => `• ${t.name} → ${t.daysPerYear} day(s)`).join("\n");
    if (!confirm(
      `Apply the policy entitlement to every active employee for ${year}?\n\n${summary}\n\nUsed / pending days are preserved; only TOTAL changes.`
    )) return;

    setBulkBusy(true);
    try {
      const ids = employees.map((e) => e.id);
      // Fire requests in batches of 8 so we don't drown the API.
      const BATCH = 8;
      for (const t of targets) {
        for (let i = 0; i < ids.length; i += BATCH) {
          await Promise.all(ids.slice(i, i + BATCH).map((userId) =>
            fetch("/api/hr/admin/leave-balances", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId, leaveTypeId: t.id, year, totalDays: t.daysPerYear }),
            }).catch(() => {})
          ));
        }
      }
      mutate(url);
    } finally { setBulkBusy(false); }
  };

  const yearOptions = [currentYear + 1, currentYear, currentYear - 1, currentYear - 2];

  return (
    <>
      {/* ── Header bar ─────────────────────────────────────────────── */}
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-800 dark:text-white">Leave balances</h2>
          <p className="mt-0.5 text-[12.5px] text-slate-500">
            Click any cell to edit. Changes apply to <span className="font-semibold text-slate-700">{year}</span>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search employee…"
              className="h-9 w-[220px] rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#008CFF]/20"
            />
            {query ? (
              <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                <X size={12} />
              </button>
            ) : null}
          </div>

          {/* Year */}
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#008CFF]/20"
          >
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>

          {/* Bulk apply */}
          <button
            onClick={() => seedDefaults("all")}
            disabled={bulkBusy || leaveTypes.length === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#008CFF] px-3.5 text-[12.5px] font-semibold text-white hover:bg-[#0070d4] disabled:opacity-60"
          >
            <Sparkles size={14} />
            {bulkBusy ? "Applying…" : "Apply policy defaults"}
          </button>
        </div>
      </header>

      {/* ── Matrix ─────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70">
              <th className="sticky left-0 z-[1] bg-slate-50/70 px-5 py-3 text-left text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-500 min-w-[260px]">
                Employee
              </th>
              {leaveTypes.map((lt) => (
                <th key={lt.id} className="px-3 py-3 text-left align-bottom min-w-[120px]">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-700">{lt.name}</span>
                    <button
                      type="button"
                      onClick={() => seedDefaults(lt.id)}
                      title={`Reset every employee's ${lt.name} entitlement to ${lt.daysPerYear} day(s)`}
                      className="self-start rounded bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-semibold normal-case tracking-normal text-slate-600 transition hover:bg-[#e8f1fc] hover:text-[#0f4e93]"
                    >
                      Policy: {lt.daysPerYear}d ↻
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={leaveTypes.length + 1} className="px-5 py-12 text-center text-[12.5px] text-slate-400">Loading balances…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={leaveTypes.length + 1} className="px-5 py-12 text-center text-[12.5px] text-slate-400">
                {employees.length === 0 ? "No active employees." : `No employee matches "${query}".`}
              </td></tr>
            ) : filtered.map((emp, i) => (
              <tr
                key={emp.id}
                className={`border-b border-slate-50 transition-colors hover:bg-[#f8fbff] ${i % 2 === 0 ? "" : "bg-slate-50/30"}`}
              >
                <td className="sticky left-0 z-[1] bg-inherit px-5 py-3 min-w-[260px]">
                  <div className="flex items-center gap-2.5">
                    {emp.profilePictureUrl ? (
                      <img src={emp.profilePictureUrl} alt="" className="h-8 w-8 rounded-full object-cover ring-1 ring-slate-200" />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e8f1fc] text-[11px] font-semibold text-[#0f4e93] ring-1 ring-[#cfdef5]">
                        {(emp.name || "?").trim().slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-slate-800">{emp.name}</p>
                      <p className="truncate text-[10.5px] text-slate-400">{emp.email}</p>
                    </div>
                  </div>
                </td>
                {leaveTypes.map((lt) => (
                  <td key={lt.id} className="px-3 py-3 align-middle">
                    <BalanceChip
                      bal={emp.balances[lt.id]}
                      onClick={() => openEdit(emp, lt)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Legend ─────────────────────────────────────────────────── */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> Available
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> ≤ 1 day left
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-red-500" /> Overdrawn
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-slate-300" /> Not set
        </span>
        <span>· Click any cell to edit · Numbers shown are <strong>remaining / total</strong></span>
      </div>

      {/* ── Edit modal ─────────────────────────────────────────────── */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-2xl">
            <header className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-[15px] font-semibold text-slate-800">Edit leave balance</h3>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  {editing.emp.name} · <span className="font-medium text-slate-700">{editing.type.name}</span> · {year}
                </p>
              </div>
              <button onClick={() => setEditing(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X size={16} />
              </button>
            </header>

            <div className="space-y-4 px-5 py-4">
              {/* Total — primary control */}
              <div>
                <label className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-500">Total entitlement</label>
                <div className="mt-1.5 flex items-center gap-2">
                  <button onClick={() => adjustTotal(-1)} className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-100">
                    <Minus size={14} />
                  </button>
                  <input
                    ref={totalInputRef}
                    type="number"
                    step="0.5"
                    min="0"
                    value={form.total}
                    onChange={(e) => setForm((f) => ({ ...f, total: e.target.value }))}
                    className="h-9 flex-1 rounded-md border border-slate-200 bg-white px-3 text-center text-[16px] font-semibold tabular-nums text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#008CFF]/30"
                  />
                  <button onClick={() => adjustTotal( 1)} className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-100">
                    <Plus size={14} />
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Policy default: <strong className="text-slate-600">{editing.type.daysPerYear} day(s)</strong>
                  {Number(form.total) !== editing.type.daysPerYear && form.total !== "" ? (
                    <button
                      onClick={() => setForm((f) => ({ ...f, total: String(editing!.type.daysPerYear) }))}
                      className="ml-2 text-[11px] font-semibold text-[#008CFF] hover:underline"
                    >
                      Use policy
                    </button>
                  ) : null}
                </p>
              </div>

              {/* Used / Pending — secondary, less emphasis */}
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-500">Already consumed (auto-managed)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Used</label>
                    <input
                      type="number" step="0.5" min="0"
                      value={form.used}
                      onChange={(e) => setForm((f) => ({ ...f, used: e.target.value }))}
                      className="mt-1 w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-center text-[13px] tabular-nums text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#008CFF]/30"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Pending</label>
                    <input
                      type="number" step="0.5" min="0"
                      value={form.pending}
                      onChange={(e) => setForm((f) => ({ ...f, pending: e.target.value }))}
                      className="mt-1 w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-center text-[13px] tabular-nums text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#008CFF]/30"
                    />
                  </div>
                </div>
                <p className="mt-2 text-[10.5px] leading-snug text-slate-500">
                  These update automatically when leaves are approved. Edit them manually only to fix bad data.
                </p>
              </div>

              {/* Preview chip */}
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
                <span className="text-[11.5px] font-medium uppercase tracking-wider text-slate-500">After save</span>
                <PreviewChip
                  total={Number(form.total || 0)}
                  used={Number(form.used || 0)}
                  pending={Number(form.pending || 0)}
                />
              </div>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
              <button onClick={() => setEditing(null)}
                className="h-9 rounded-md border border-slate-200 bg-white px-4 text-[13px] font-medium text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={busy}
                className="h-9 rounded-md bg-[#008CFF] px-4 text-[13px] font-semibold text-white hover:bg-[#0070d4] disabled:opacity-60">
                {busy ? "Saving…" : "Save changes"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

// ── Cell chip — colour-graded by remaining balance ────────────────────
function BalanceChip({ bal, onClick }: { bal: Bal; onClick: () => void }) {
  const total     = bal.total;
  const used      = bal.used;
  const pending   = bal.pending;
  const remaining = total - used - pending;

  // Tone rules:
  //   total = 0          → slate (not configured)  — quiet, NOT alarming
  //   remaining < 0      → red   (overdrawn)
  //   remaining < 1      → amber (≤ 1 day left)
  //   otherwise          → emerald
  const tone =
    total <= 0
      ? "bg-slate-50 text-slate-500 ring-slate-200 hover:bg-slate-100"
      : remaining < 0
        ? "bg-red-50 text-red-700 ring-red-200 hover:bg-red-100"
        : remaining < 1
          ? "bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100"
          : "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100";

  const tooltip = total === 0
    ? "Not configured — click to set"
    : `Total ${total} · Used ${used} · Pending ${pending}`;

  // Display: if not set yet, just show a muted dash — don't shout zeros.
  const display = total === 0
    ? <span className="font-medium">—</span>
    : (
      <>
        <span className="text-[14px] font-semibold tabular-nums leading-none">{remaining}</span>
        <span className="ml-1 text-[10.5px] font-medium tabular-nums leading-none opacity-70">/ {total}</span>
      </>
    );

  return (
    <button
      onClick={onClick}
      title={tooltip}
      className={`inline-flex min-w-[68px] items-baseline justify-center gap-0.5 rounded-md px-2.5 py-1.5 ring-1 ring-inset transition ${tone}`}
    >
      {display}
    </button>
  );
}

function PreviewChip({ total, used, pending }: { total: number; used: number; pending: number }) {
  const remaining = total - used - pending;
  const tone =
    total <= 0      ? "bg-slate-100 text-slate-600" :
    remaining < 0   ? "bg-red-100 text-red-700"      :
    remaining < 1   ? "bg-amber-100 text-amber-700"  :
                      "bg-emerald-100 text-emerald-700";
  return (
    <span className={`inline-flex items-baseline gap-1 rounded-md px-3 py-1 ${tone}`}>
      <span className="text-[15px] font-bold tabular-nums">{remaining}</span>
      <span className="text-[11px] font-medium tabular-nums opacity-70">remaining</span>
      <span className="ml-2 text-[11px] tabular-nums opacity-50">/ {total} total</span>
    </span>
  );
}
