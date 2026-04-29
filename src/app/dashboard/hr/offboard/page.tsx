"use client";

// HR Offboarding console — two tabs:
//   • Initiate Exit — pick an active employee, fill exit details, submit.
//     Triggers an email to the leaver + a heads-up email + in-app
//     notification to CEO / HR / their manager / admins / developers.
//     Also flips User.isActive=false so they stop appearing in active
//     people lists.
//   • Past Exits — table of every exit on file with clearance checkboxes
//     (assets / docs / final settlement / exit interview) and a Status
//     selector (notice_period / cleared / offboarded).

import { useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import {
  UserMinus, Search, AlertCircle, CheckCircle2, X, Save,
} from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";

type Employee = { id: number; name: string; email: string; profile?: { designation?: string; department?: string } };
type Exit = {
  id: number; userId: number; userName: string; userEmail: string;
  designation: string | null; department: string | null;
  exitType: string; resignationDate: string; lastWorkingDay: string;
  noticePeriodDays: number; reason: string | null; notes: string | null;
  status: string;
  assetsReturned: boolean; documentsHandled: boolean;
  finalSettlementDone: boolean; exitInterviewDone: boolean;
  createdAt: string;
};

const EXIT_TYPES = [
  { value: "resignation",   label: "Resignation"   },
  { value: "termination",   label: "Termination"   },
  { value: "contract_end",  label: "Contract End"  },
  { value: "retirement",    label: "Retirement"    },
  { value: "other",         label: "Other"         },
];

const STATUS_TONES: Record<string, string> = {
  notice_period: "bg-amber-50 text-amber-700 ring-amber-200",
  cleared:       "bg-blue-50 text-blue-700 ring-blue-200",
  offboarded:    "bg-slate-100 text-slate-600 ring-slate-200",
};

const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default function OffboardPage() {
  const { data: session } = useSession();
  const me = session?.user as any;
  const canManage = me?.orgLevel === "ceo" || me?.isDeveloper === true ||
                    me?.orgLevel === "hr_manager" || me?.role === "admin";

  const [tab, setTab] = useState<"initiate" | "past">("initiate");

  if (!canManage) {
    return (
      <div className="px-6 py-12 text-center text-slate-500 text-[14px]">
        You don't have access to the Offboarding console.
      </div>
    );
  }

  return (
    <div className="px-6 py-6 max-w-6xl">
      <header className="mb-5">
        <h1 className="text-[20px] font-bold text-slate-800 inline-flex items-center gap-2">
          <UserMinus size={20} className="text-rose-500" /> Offboard Employee
        </h1>
        <p className="mt-1 text-[12.5px] text-slate-500">
          Record exits, fire goodbye / heads-up emails, and track clearance.
        </p>
      </header>

      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {[
          { k: "initiate", l: "Initiate Exit" },
          { k: "past",     l: "Past Exits"    },
        ].map(t => (
          <button
            key={t.k}
            onClick={() => setTab(t.k as any)}
            className={`px-4 py-2.5 text-[12.5px] font-semibold border-b-2 -mb-px transition-colors ${
              tab === t.k
                ? "border-[#0f6ecd] text-[#0f6ecd]"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.l}
          </button>
        ))}
      </div>

      {tab === "initiate" && <InitiateExitTab />}
      {tab === "past"     && <PastExitsTab     />}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Initiate Exit — picks an active employee, fills exit details
 * ─────────────────────────────────────────────────────────────────── */

function InitiateExitTab() {
  const { data: employees } = useSWR<Employee[]>("/api/hr/employees", fetcher);
  const [picked, setPicked] = useState<Employee | null>(null);
  const [query, setQuery]   = useState("");
  const [open, setOpen]     = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    exitType: "resignation",
    resignationDate: today,
    lastWorkingDay: "",
    noticePeriodDays: "30",
    reason: "",
    notes: "",
  });
  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState("");

  const filtered = useMemo(() => {
    const list = (employees ?? []).filter(e => e.id);
    if (!query.trim()) return list.slice(0, 8);
    const q = query.trim().toLowerCase();
    return list.filter(e => e.name?.toLowerCase().includes(q) || e.email?.toLowerCase().includes(q)).slice(0, 8);
  }, [employees, query]);

  const submit = async () => {
    if (!picked) { setError("Pick an employee first"); return; }
    if (!form.lastWorkingDay) { setError("Last working day is required"); return; }
    setError(""); setSaving(true);
    try {
      const res = await fetch("/api/hr/exits", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: picked.id, ...form }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Submission failed");
      setSuccess(`Exit recorded for ${picked.name}. Goodbye email sent and stakeholders notified.`);
      setPicked(null);
      setQuery("");
      setForm({ exitType: "resignation", resignationDate: today, lastWorkingDay: "", noticePeriodDays: "30", reason: "", notes: "" });
      mutate("/api/hr/exits");
      mutate("/api/hr/employees");
    } catch (e: any) {
      setError(e?.message || "Submission failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      <div className="space-y-5">
        {/* Employee picker */}
        <Card title="Employee">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={picked ? `${picked.name} · ${picked.email}` : query}
              onChange={(e) => { setQuery(e.target.value); setPicked(null); setOpen(true); }}
              onFocus={() => setOpen(true)}
              placeholder="Search by name or email…"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#0f6ecd]"
            />
            {open && !picked && filtered.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-auto">
                {filtered.map(e => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => { setPicked(e); setOpen(false); setQuery(""); }}
                    className="w-full text-left px-3 py-2 hover:bg-[#0f6ecd]/5 border-b border-slate-50 last:border-0"
                  >
                    <p className="text-[13px] font-semibold text-slate-800">{e.name}</p>
                    <p className="text-[11.5px] text-slate-500">
                      {e.email}{e.profile?.designation ? ` · ${e.profile.designation}` : ""}
                      {e.profile?.department  ? ` · ${e.profile.department}`  : ""}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card title="Exit Details">
          <Grid2>
            <Field label="Exit Type" required>
              <select className={ipt} value={form.exitType} onChange={e => set("exitType", e.target.value)}>
                {EXIT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Notice Period (days)">
              <input type="number" className={ipt} value={form.noticePeriodDays} onChange={e => set("noticePeriodDays", e.target.value)} />
            </Field>
            <Field label="Resignation Date" required>
              <DatePicker value={form.resignationDate} onChange={v => set("resignationDate", v)} />
            </Field>
            <Field label="Last Working Day" required>
              <DatePicker value={form.lastWorkingDay} onChange={v => set("lastWorkingDay", v)} futureYears={2} />
            </Field>
          </Grid2>
        </Card>

        <Card title="Reason & Notes">
          <Field label="Reason for leaving (visible to HR / CEO)">
            <textarea
              rows={3}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] text-slate-800 focus:outline-none focus:border-[#0f6ecd] resize-none"
              value={form.reason}
              onChange={e => set("reason", e.target.value)}
              placeholder="Career growth, relocation, etc."
            />
          </Field>
          <div className="mt-4">
            <Field label="Internal HR notes (private)">
              <textarea
                rows={3}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] text-slate-800 focus:outline-none focus:border-[#0f6ecd] resize-none"
                value={form.notes}
                onChange={e => set("notes", e.target.value)}
                placeholder="Anything HR / CEO should know"
              />
            </Field>
          </div>
        </Card>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-[12.5px] px-3 py-2.5 rounded-lg">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[12.5px] px-3 py-2.5 rounded-lg">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        <div>
          <button
            onClick={submit}
            disabled={saving || !picked || !form.lastWorkingDay}
            className="inline-flex items-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[13px] font-semibold px-5 h-10 rounded-lg transition-colors"
          >
            <UserMinus size={14} />
            {saving ? "Recording…" : "Record Exit"}
          </button>
        </div>
      </div>

      {/* Right rail — what happens on submit */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-[13px] font-semibold text-slate-800 mb-3">What happens next</h3>
          <ul className="space-y-3 text-[12.5px] text-slate-600">
            <li className="flex gap-2"><span className="text-emerald-500 mt-0.5">●</span><span>Employee account is marked <strong>inactive</strong> — they can no longer sign in.</span></li>
            <li className="flex gap-2"><span className="text-emerald-500 mt-0.5">●</span><span>A goodbye email goes to the employee with their last working day on record.</span></li>
            <li className="flex gap-2"><span className="text-emerald-500 mt-0.5">●</span><span>CEO, HR managers, admins, developers, and their reporting manager get an email + in-app notification.</span></li>
            <li className="flex gap-2"><span className="text-emerald-500 mt-0.5">●</span><span>The exit lands in the <strong>Past Exits</strong> tab where you can tick off clearance items.</span></li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Past Exits — list + clearance checkboxes
 * ─────────────────────────────────────────────────────────────────── */

function PastExitsTab() {
  const { data: rows, isLoading } = useSWR<Exit[]>("/api/hr/exits", fetcher);
  const [open, setOpen] = useState<Exit | null>(null);

  if (isLoading) return <p className="text-[13px] text-slate-400 py-6 text-center">Loading…</p>;
  const list = rows ?? [];

  if (list.length === 0) {
    return (
      <div className="bg-white border border-dashed border-slate-200 rounded-xl py-12 text-center text-slate-400 text-[13px]">
        No exits recorded yet.
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500">
            <th className="text-left px-4 py-3">Employee</th>
            <th className="text-left px-4 py-3">Type</th>
            <th className="text-left px-4 py-3">Last Day</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-left px-4 py-3">Clearance</th>
            <th className="text-right px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {list.map(r => {
            const tone = STATUS_TONES[r.status] || STATUS_TONES.notice_period;
            const checked = [r.assetsReturned, r.documentsHandled, r.finalSettlementDone, r.exitInterviewDone].filter(Boolean).length;
            return (
              <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/40">
                <td className="px-4 py-3 align-top">
                  <p className="text-[13.5px] font-semibold text-slate-800">{r.userName}</p>
                  <p className="text-[11.5px] text-slate-500">
                    {r.userEmail}{r.designation ? ` · ${r.designation}` : ""}
                  </p>
                </td>
                <td className="px-4 py-3 align-top text-[12.5px] text-slate-700 capitalize">
                  {r.exitType.replace(/_/g, " ")}
                </td>
                <td className="px-4 py-3 align-top text-[12.5px] text-slate-700 tabular-nums">
                  {fmtDate(r.lastWorkingDay)}
                </td>
                <td className="px-4 py-3 align-top">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ring-1 ring-inset ${tone}`}>
                    {r.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-4 py-3 align-top text-[12.5px] text-slate-600 tabular-nums">
                  {checked} / 4
                </td>
                <td className="px-4 py-3 align-top text-right">
                  <button
                    onClick={() => setOpen(r)}
                    className="text-[12px] font-semibold text-[#0f6ecd] hover:underline"
                  >
                    Manage →
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {open && <ExitManageModal exit={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ExitManageModal({ exit, onClose }: { exit: Exit; onClose: () => void }) {
  const [status, setStatus] = useState(exit.status);
  const [assetsReturned, setAssetsReturned] = useState(exit.assetsReturned);
  const [documentsHandled, setDocumentsHandled] = useState(exit.documentsHandled);
  const [finalSettlementDone, setFinalSettlementDone] = useState(exit.finalSettlementDone);
  const [exitInterviewDone, setExitInterviewDone] = useState(exit.exitInterviewDone);
  const [notes, setNotes] = useState(exit.notes ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`/api/hr/exits/${exit.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, assetsReturned, documentsHandled, finalSettlementDone, exitInterviewDone, notes }),
      });
      mutate("/api/hr/exits");
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-800">{exit.userName}</h3>
            <p className="text-[11.5px] text-slate-500">
              {exit.exitType.replace(/_/g, " ")} · last day {fmtDate(exit.lastWorkingDay)}
            </p>
          </div>
          <button onClick={onClose}><X size={18} className="text-slate-400 hover:text-slate-700" /></button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-500 mb-2">Status</p>
            <div className="flex gap-1.5">
              {["notice_period", "cleared", "offboarded"].map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`px-3 h-8 rounded-full text-[11.5px] font-semibold ring-1 ring-inset transition-colors ${
                    status === s ? STATUS_TONES[s] : "bg-white text-slate-600 ring-slate-200 hover:ring-[#0f6ecd]"
                  }`}
                >
                  {s.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-500 mb-2">Clearance</p>
            <div className="space-y-1.5">
              <Check label="Assets returned"          checked={assetsReturned}      onChange={setAssetsReturned} />
              <Check label="Documents handled"        checked={documentsHandled}    onChange={setDocumentsHandled} />
              <Check label="Final settlement done"    checked={finalSettlementDone} onChange={setFinalSettlementDone} />
              <Check label="Exit interview completed" checked={exitInterviewDone}   onChange={setExitInterviewDone} />
            </div>
          </div>

          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-500 mb-2">Notes</p>
            <textarea
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] text-slate-800 focus:outline-none focus:border-[#0f6ecd] resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
          <button onClick={onClose} className="h-9 px-4 text-[13px] text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="h-9 px-5 rounded-lg bg-[#0f6ecd] hover:bg-[#0a5fb3] text-white text-[13px] font-semibold disabled:opacity-60 inline-flex items-center gap-1.5"
          >
            <Save size={13} /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Tiny presentational helpers
 * ─────────────────────────────────────────────────────────────────── */

const ipt = "w-full h-9 px-3 border border-slate-200 rounded-lg text-[13px] text-slate-800 focus:outline-none focus:border-[#0f6ecd]";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100">
        <h3 className="text-[13.5px] font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11.5px] font-semibold text-slate-700 mb-1.5">
        {label}{required ? <span className="text-rose-500"> *</span> : null}
      </label>
      {children}
    </div>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>;
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer text-[13px] text-slate-700 hover:text-slate-900">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-[#0f6ecd] focus:ring-[#0f6ecd]"
      />
      <span>{label}</span>
    </label>
  );
}
