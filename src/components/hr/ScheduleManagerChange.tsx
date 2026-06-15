"use client";

// Schedule a future reporting-manager change for an employee. Shown
// under the Reporting Manager field in Edit Profile → Job & Work.
// Pick the incoming manager (searchable) + an effective date; the
// `reporting_manager_changes` cron flips User.managerId on that date.
// One pending change at a time — scheduling a new one replaces it.

import { useEffect, useState } from "react";
import { CalendarClock, X, ArrowRight } from "lucide-react";
import SelectField from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/date-field";
import { showToast } from "@/components/ui/Toast";

type Pending = {
  id: number;
  newManagerId: number;
  newManagerName: string | null;
  effectiveDate: string; // YYYY-MM-DD
};

function fmt(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

// Tomorrow (local) as YYYY-MM-DD — earliest pickable effective date.
function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function ScheduleManagerChange({
  userId,
  currentManagerName,
  managerOpts,
}: {
  userId: number;
  currentManagerName: string | null;
  managerOpts: Array<{ id: number; name: string }>;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [newManagerId, setNewManagerId] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/people/${userId}/manager-change`);
      if (res.ok) {
        const j = await res.json();
        setPending(j?.pending ?? null);
      }
    } catch {
      /* ignore — control just shows the empty state */
    }
    setLoading(false);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const schedule = async () => {
    if (!newManagerId) return showToast("Pick the new reporting manager", "error");
    if (!date) return showToast("Pick an effective date", "error");
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/people/${userId}/manager-change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newManagerId: Number(newManagerId), effectiveDate: date }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(j?.error || "Couldn't schedule the change", "error");
        setBusy(false);
        return;
      }
      setPending(j?.pending ?? null);
      setOpen(false);
      setNewManagerId("");
      setDate("");
      showToast("Reporting-manager change scheduled", "success");
    } catch {
      showToast("Network error — try again", "error");
    }
    setBusy(false);
  };

  const cancel = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/people/${userId}/manager-change`, { method: "DELETE" });
      if (res.ok) {
        setPending(null);
        showToast("Scheduled change cancelled", "success");
      } else {
        showToast("Couldn't cancel the scheduled change", "error");
      }
    } catch {
      showToast("Network error — try again", "error");
    }
    setBusy(false);
  };

  const opts = managerOpts.map((m) => ({ value: String(m.id), label: m.name }));

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex items-center gap-2 mb-2">
        <CalendarClock size={14} className="text-[#d97706]" />
        <span className="text-[12px] font-semibold text-slate-700">Schedule a future change</span>
      </div>

      {loading ? (
        <p className="text-[12px] text-slate-400">Loading…</p>
      ) : pending ? (
        <div className="flex items-center justify-between gap-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
          <p className="text-[12.5px] text-amber-800 leading-snug">
            Will change to{" "}
            <strong>{pending.newManagerName ?? `#${pending.newManagerId}`}</strong> on{" "}
            <strong>{fmt(pending.effectiveDate)}</strong>
            {currentManagerName ? (
              <span className="text-amber-700"> (currently {currentManagerName})</span>
            ) : null}
          </p>
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="shrink-0 inline-flex items-center gap-1 text-[11.5px] font-medium text-amber-700 hover:text-rose-600 disabled:opacity-50"
          >
            <X size={12} /> Cancel
          </button>
        </div>
      ) : open ? (
        <div className="space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">New reporting manager</label>
              <SelectField value={newManagerId} onChange={setNewManagerId} placeholder="Select manager" options={opts} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">With effect from</label>
              <DateField value={date} onChange={setDate} min={tomorrowIso()} className="w-full" />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setNewManagerId("");
                setDate("");
              }}
              className="h-8 px-3 rounded-lg text-[12px] font-semibold text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={schedule}
              disabled={busy}
              className="h-8 px-4 rounded-lg bg-[#d97706] hover:bg-[#b45309] disabled:bg-slate-300 text-white text-[12px] font-semibold shadow-sm"
            >
              {busy ? "Scheduling…" : "Schedule change"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#d97706] hover:text-[#b45309]"
        >
          <ArrowRight size={13} /> Schedule a manager change for a future date
        </button>
      )}

      <p className="mt-2 text-[11px] text-slate-400 leading-snug">
        The reporting manager auto-updates on the chosen date. Until then the current manager stays. One scheduled change at a time.
      </p>
    </div>
  );
}
