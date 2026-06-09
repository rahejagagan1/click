"use client";

import { useState, useMemo } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { Plus, X, Pencil, Sparkles, Power, UserPlus, Home, Clock } from "lucide-react";

// Each policy as returned by GET /api/hr/admin/leave-policies.
type PolicyEntry = {
  id?: number;
  leaveTypeId: number;
  leaveTypeName: string;
  leaveTypeCode: string;
  daysPerYear: number;
  monthlyAccrual: number;
};
type Policy = {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  userCount: number;
  entries: PolicyEntry[];
};
type LeaveType = { id: number; name: string; code: string; isActive: boolean; applicable: boolean };

export default function LeavePoliciesPanel() {
  const { data: policies = [] }   = useSWR<Policy[]>("/api/hr/admin/leave-policies",  fetcher);
  const { data: leaveTypes = [] } = useSWR<LeaveType[]>("/api/hr/admin/leave-types",  fetcher);
  const applicableTypes = useMemo(
    () => (leaveTypes || []).filter((lt) => lt.isActive && lt.applicable !== false),
    [leaveTypes],
  );

  const [editing,   setEditing]   = useState<Policy | null>(null);
  const [creating,  setCreating]  = useState(false);
  const [applying,  setApplying]  = useState<number | null>(null);
  const [assigning, setAssigning] = useState<number | null>(null);

  const closeEditor = () => { setEditing(null); setCreating(false); };
  const refreshList = () => mutate("/api/hr/admin/leave-policies");

  const applyPolicy = async (p: Policy) => {
    if (!confirm(
      `Seed "${p.name}" balances for its ${p.userCount} assigned user(s) for ${new Date().getFullYear()}?\n\n` +
      `• For each policy leave type, creates a LeaveBalance row at the policy's days/year\n` +
      `  IF the user doesn't already have one.\n` +
      `• Existing rows are left untouched — HR's manual balance edits are preserved.\n` +
      `• Monthly accrual still runs against the policy's per-month value.`,
    )) return;
    setApplying(p.id);
    try {
      const res = await fetch(`/api/hr/admin/leave-policies/${p.id}/apply?year=${new Date().getFullYear()}`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { alert(d.error || "Failed to apply policy."); return; }
      alert(`Done. ${d.usersTouched} user(s): ${d.rowsCreated} new balance row(s) created, ${d.rowsSkipped} existing row(s) left untouched.`);
    } finally { setApplying(null); }
  };

  const bulkAssign = async (p: Policy) => {
    if (!confirm(
      `Assign "${p.name}" to every active user who currently has no policy?\n\n` +
      `This sets User.leavePolicyId on users where it is NULL.\n` +
      `Users already on a policy are skipped.\n\n` +
      `After this, click "Apply" to push the entitlements into their balances.`,
    )) return;
    setAssigning(p.id);
    try {
      const res = await fetch(`/api/hr/admin/leave-policies/${p.id}/bulk-assign?scope=unassigned`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { alert(d.error || "Failed to bulk-assign."); return; }
      alert(`Done. ${d.assigned} user(s) assigned to "${d.policyName}".`);
      refreshList();
    } finally { setAssigning(null); }
  };

  const toggleActive = async (p: Policy) => {
    const next = !p.isActive;
    if (!confirm(`${next ? "Re-activate" : "Deactivate"} "${p.name}"?`)) return;
    const url = `/api/hr/admin/leave-policies/${p.id}`;
    const method = next ? "PUT" : "DELETE";
    const body = next ? JSON.stringify({ isActive: true }) : undefined;
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body });
    if (!res.ok) { alert("Failed to update policy."); return; }
    refreshList();
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-[16px] font-bold text-slate-800">Leave Policies</h2>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Each policy defines per-leave-type entitlement (lump sum) and monthly accrual.
            Users are assigned a policy in their profile, then HR clicks "Apply" to push it into balances.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#008CFF] px-3.5 text-[12.5px] font-semibold text-white hover:bg-[#0070d4]"
        >
          <Plus size={14} /> New Policy
        </button>
      </header>

      {/* WFH monthly quota — separate from the per-employee leave
          policies because it's brand-driven, not policy-assigned. */}
      <WfhPolicySection />

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Entries</th>
              <th className="px-4 py-3">Users</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {policies.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-[12px] text-slate-400">No policies yet — create one to start.</td></tr>
            ) : policies.map((p) => (
              <tr key={p.id} className={`border-b border-slate-100 ${p.isActive ? "" : "opacity-60"}`}>
                <td className="px-4 py-3 align-top">
                  <div className="text-[13.5px] font-semibold text-slate-800">{p.name}</div>
                  {p.description ? <div className="text-[11px] text-slate-500 mt-0.5">{p.description}</div> : null}
                </td>
                <td className="px-4 py-3 align-top text-[12px] text-slate-600">
                  {p.entries.length === 0 ? (
                    <span className="italic text-slate-400">No entries</span>
                  ) : (
                    <div className="space-y-0.5">
                      {p.entries.map((e) => (
                        <div key={e.leaveTypeId} className="flex items-baseline gap-1.5">
                          <span className="font-medium text-slate-700">{e.leaveTypeName}</span>
                          <span className="text-[11px] text-slate-500 tabular-nums">
                            {e.daysPerYear > 0 ? `${e.daysPerYear}/yr` : ""}
                            {e.daysPerYear > 0 && e.monthlyAccrual > 0 ? " + " : ""}
                            {e.monthlyAccrual > 0 ? `${e.monthlyAccrual}/mo` : ""}
                            {e.daysPerYear === 0 && e.monthlyAccrual === 0 ? "0" : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 align-top text-[13px] tabular-nums text-slate-700">{p.userCount}</td>
                <td className="px-4 py-3 align-top">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${p.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                    {p.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3 align-top text-right">
                  <div className="inline-flex items-center gap-1">
                    <button
                      onClick={() => bulkAssign(p)}
                      disabled={assigning === p.id || !p.isActive}
                      title="Assign this policy to every active user who currently has no policy. Users already on a policy are skipped."
                      className="inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11.5px] font-semibold text-slate-700 hover:border-[#008CFF] hover:text-[#008CFF] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <UserPlus size={12} />
                      {assigning === p.id ? "Assigning…" : "Assign unassigned"}
                    </button>
                    <button
                      onClick={() => applyPolicy(p)}
                      disabled={applying === p.id || !p.isActive || p.userCount === 0 || p.entries.length === 0}
                      title={p.userCount === 0 ? "No users assigned to this policy" : p.entries.length === 0 ? "No entries to apply" : "Apply policy to all assigned users for the current year"}
                      className="inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11.5px] font-semibold text-slate-700 hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Sparkles size={12} />
                      {applying === p.id ? "Applying…" : "Apply"}
                    </button>
                    <button
                      onClick={() => setEditing(p)}
                      className="inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11.5px] font-semibold text-slate-700 hover:border-[#008CFF] hover:text-[#008CFF]"
                    >
                      <Pencil size={12} /> Edit
                    </button>
                    <button
                      onClick={() => toggleActive(p)}
                      title={p.isActive ? "Deactivate" : "Re-activate"}
                      className="inline-flex h-7 items-center justify-center rounded border border-slate-200 bg-white px-2 text-slate-600 hover:border-amber-400 hover:text-amber-600"
                    >
                      <Power size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <PolicyEditor
          policy={editing}
          leaveTypes={applicableTypes}
          onClose={closeEditor}
          onSaved={() => { closeEditor(); refreshList(); }}
        />
      )}
    </div>
  );
}

function PolicyEditor({
  policy,
  leaveTypes,
  onClose,
  onSaved,
}: {
  policy: Policy | null;
  leaveTypes: LeaveType[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(policy?.name ?? "");
  const [description, setDescription] = useState(policy?.description ?? "");
  // Pre-fill entries: one row per active+applicable leave type. Existing entries override.
  const [entries, setEntries] = useState<Record<number, { daysPerYear: string; monthlyAccrual: string }>>(() => {
    const map: Record<number, { daysPerYear: string; monthlyAccrual: string }> = {};
    for (const lt of leaveTypes) {
      const existing = policy?.entries.find((e) => e.leaveTypeId === lt.id);
      map[lt.id] = {
        daysPerYear:    String(existing?.daysPerYear    ?? 0),
        monthlyAccrual: String(existing?.monthlyAccrual ?? 0),
      };
    }
    return map;
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) { alert("Name is required."); return; }
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      entries: leaveTypes.map((lt) => ({
        leaveTypeId:    lt.id,
        daysPerYear:    Number(entries[lt.id]?.daysPerYear    || 0),
        monthlyAccrual: Number(entries[lt.id]?.monthlyAccrual || 0),
      })).filter((e) => e.daysPerYear > 0 || e.monthlyAccrual > 0),
    };
    setBusy(true);
    try {
      const url    = policy ? `/api/hr/admin/leave-policies/${policy.id}` : "/api/hr/admin/leave-policies";
      const method = policy ? "PUT" : "POST";
      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { alert(d.error || "Failed to save policy."); return; }
      onSaved();
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl max-h-[88vh] overflow-hidden rounded-xl bg-white shadow-2xl flex flex-col">
        <header className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-800">{policy ? "Edit policy" : "New policy"}</h3>
            <p className="text-[11.5px] text-slate-500 mt-0.5">
              Set per-type entitlement. Days/yr is granted on Apply; Per-month accrues each month.
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={16} />
          </button>
        </header>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Name *</label>
              <input
                type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Standard Policy"
                className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008CFF]/30"
              />
            </div>
            <div className="col-span-2">
              <label className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Description</label>
              <input
                type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="What employees does this cover?"
                className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008CFF]/30"
              />
            </div>
          </div>

          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-2">Leave-type entries</p>
            <div className="overflow-x-auto rounded-lg border border-slate-100">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Days / year (lump sum)</th>
                    <th className="px-3 py-2">Per month (accrual)</th>
                  </tr>
                </thead>
                <tbody>
                  {leaveTypes.length === 0 ? (
                    <tr><td colSpan={3} className="px-3 py-4 text-center text-[12px] text-slate-400 italic">No applicable leave types defined.</td></tr>
                  ) : leaveTypes.map((lt) => (
                    <tr key={lt.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-[13px] text-slate-700">
                        {lt.name} <span className="text-[10.5px] text-slate-400">({lt.code})</span>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number" step="0.01" min="0"
                          value={entries[lt.id]?.daysPerYear ?? "0"}
                          onChange={(e) => setEntries((prev) => ({ ...prev, [lt.id]: { ...prev[lt.id], daysPerYear: e.target.value } }))}
                          className="w-24 rounded border border-slate-200 px-2 py-1 text-center text-[13px] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#008CFF]/30"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number" step="0.01" min="0"
                          value={entries[lt.id]?.monthlyAccrual ?? "0"}
                          onChange={(e) => setEntries((prev) => ({ ...prev, [lt.id]: { ...prev[lt.id], monthlyAccrual: e.target.value } }))}
                          className="w-24 rounded border border-slate-200 px-2 py-1 text-center text-[13px] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#008CFF]/30"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10.5px] text-slate-500 leading-snug">
              Rows with both fields at 0 will not be saved. Set Days/yr for upfront entitlement (e.g. 12 EL/year),
              Per month for accrual (e.g. 1 SL/month), or both for mixed types.
            </p>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
          <button onClick={onClose} className="h-9 rounded-md border border-slate-200 bg-white px-4 text-[13px] font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <button onClick={save} disabled={busy || !name.trim()} className="h-9 rounded-md bg-[#008CFF] px-4 text-[13px] font-semibold text-white hover:bg-[#0070d4] disabled:opacity-60">
            {busy ? "Saving…" : "Save policy"}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// WFH Policy — per-brand monthly quota + global enable/disable.
// Auto-credit cron runs on the 1st of each month; this UI controls
// the cron's input numbers + can flip enforcement off entirely.
// ─────────────────────────────────────────────────────────────────
type WfhPolicy = {
  limitEnabled: boolean;
  nbMediaQuota: number;
  ytLabsQuota:  number;
  updatedAt:    string | null;
  updatedByName: string | null;
};

function WfhPolicySection() {
  const { data, mutate: refresh, isLoading } = useSWR<WfhPolicy>("/api/hr/admin/wfh-policy", fetcher, {
    revalidateOnFocus: false,
  });
  const [savingField, setSavingField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nbDraft, setNbDraft] = useState<string>("");
  const [ytDraft, setYtDraft] = useState<string>("");

  const nbValue = nbDraft !== "" ? Number(nbDraft) : (data?.nbMediaQuota ?? 2);
  const ytValue = ytDraft !== "" ? Number(ytDraft) : (data?.ytLabsQuota  ?? 3);

  const patch = async (body: Partial<WfhPolicy>, field: string) => {
    setSavingField(field); setError(null);
    try {
      const res = await fetch("/api/hr/admin/wfh-policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Save failed (${res.status})`);
      }
      await refresh();
      if (field === "nb") setNbDraft("");
      if (field === "yt") setYtDraft("");
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSavingField(null);
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-[12.5px] text-slate-500">
        Loading WFH policy…
      </div>
    );
  }

  const enabled = data?.limitEnabled ?? true;
  const stamp = data?.updatedAt ? new Date(data.updatedAt) : null;
  const stampStr = stamp ? stamp.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }) : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-slate-900 inline-flex items-center gap-2">
            <Home size={14} className="text-[#008CFF]" />
            WFH monthly quota
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
              enabled
                ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"
                : "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200"
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-emerald-500" : "bg-slate-400"}`} />
              {enabled ? "Enforced" : "Off"}
            </span>
          </h3>
          <p className="mt-1 text-[12px] text-slate-500 leading-snug max-w-2xl">
            Each employee is credited a fresh quota on the 1st of every month — NB Media employees get one number, YT Labs employees get another. When the limit is OFF, requests are not capped.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => patch({ limitEnabled: !enabled }, "toggle")}
          disabled={savingField === "toggle"}
          className={`shrink-0 relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#008CFF]/40 disabled:opacity-50 disabled:cursor-not-allowed ${
            enabled ? "bg-emerald-500" : "bg-slate-300"
          }`}
          aria-label={enabled ? "Disable WFH limit" : "Enable WFH limit"}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-1 ring-black/5 transition-transform duration-200 ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-5 pb-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50/40 px-4 py-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10.5px] uppercase tracking-[0.08em] font-bold text-slate-500">NB Media</span>
            <span className="text-[10px] font-bold text-[#008CFF] bg-[#008CFF]/10 px-1.5 py-0.5 rounded">days/month</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0} max={31}
              value={nbDraft !== "" ? nbDraft : String(data?.nbMediaQuota ?? 2)}
              onChange={(e) => setNbDraft(e.target.value)}
              disabled={!enabled || savingField === "nb"}
              className="h-9 w-20 px-3 border border-slate-200 rounded-md text-[14px] font-semibold text-slate-900 bg-white tabular-nums focus:outline-none focus:border-[#008CFF] disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => patch({ nbMediaQuota: nbValue }, "nb")}
              disabled={!enabled || savingField === "nb" || nbDraft === "" || nbValue === data?.nbMediaQuota}
              className="h-9 px-3 rounded-md bg-[#008CFF] text-white text-[11.5px] font-semibold hover:bg-[#0070d4] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {savingField === "nb" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50/40 px-4 py-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10.5px] uppercase tracking-[0.08em] font-bold text-slate-500">YT Labs</span>
            <span className="text-[10px] font-bold text-[#d4143d] bg-[#d4143d]/10 px-1.5 py-0.5 rounded">days/month</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0} max={31}
              value={ytDraft !== "" ? ytDraft : String(data?.ytLabsQuota ?? 3)}
              onChange={(e) => setYtDraft(e.target.value)}
              disabled={!enabled || savingField === "yt"}
              className="h-9 w-20 px-3 border border-slate-200 rounded-md text-[14px] font-semibold text-slate-900 bg-white tabular-nums focus:outline-none focus:border-[#008CFF] disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => patch({ ytLabsQuota: ytValue }, "yt")}
              disabled={!enabled || savingField === "yt" || ytDraft === "" || ytValue === data?.ytLabsQuota}
              className="h-9 px-3 rounded-md bg-[#008CFF] text-white text-[11.5px] font-semibold hover:bg-[#0070d4] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {savingField === "yt" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-5 mb-3 rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-[11.5px] text-rose-700">{error}</div>
      )}

      {stampStr && (
        <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50/60 flex items-center gap-2 text-[11.5px] text-slate-500">
          <Clock size={11} className="text-slate-400" />
          <span>
            Last changed by{" "}
            <span className="font-semibold text-slate-700">{data?.updatedByName || "Unknown"}</span>
            {" "}· {stampStr} IST
          </span>
        </div>
      )}
    </div>
  );
}
