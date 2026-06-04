"use client";

// Designation admin — create/edit designations and tick the permissions each
// one holds. The HR Manager (and top admins) may grant ANY permission,
// including sensitive ones (flagged). Designations drive access app-wide via
// can(); changes take effect on each user's next session fetch.

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { isFullHRAdmin } from "@/lib/access";

type PermDef = { key: string; label: string; description: string; category: string; sensitive?: boolean };
type Designation = {
  id: number; key: string; label: string; scorecardFunction: string | null;
  isActive: boolean; isSystem: boolean; sortOrder: number; userCount: number; permissionKeys: string[];
};

const CATEGORY_ORDER = ["system", "visibility", "hr", "finance", "performance", "content"];
const CATEGORY_LABELS: Record<string, string> = {
  system: "System", visibility: "Visibility", hr: "HR Operations",
  finance: "Finance", performance: "Performance & Reporting", content: "Content & Tools",
};
const SCORECARD_OPTIONS = [
  { value: "", label: "None (not rated)" },
  { value: "writer", label: "Writer" }, { value: "editor", label: "Editor" },
  { value: "qa", label: "QA" }, { value: "researcher", label: "Researcher" },
  { value: "manager", label: "Manager" },
];

type Draft = { label: string; scorecardFunction: string; isActive: boolean; permissionKeys: string[] };
const BLANK: Draft = { label: "", scorecardFunction: "", isActive: true, permissionKeys: [] };

export default function DesignationsPage() {
  const { data: session, status } = useSession();
  const allowed = status === "authenticated" && isFullHRAdmin(session?.user as never);

  const [catalog, setCatalog] = useState<PermDef[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [selectedId, setSelectedId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/rbac/designations");
      if (!res.ok) throw new Error((await res.json()).error || "Failed to load");
      const data = await res.json();
      setCatalog(data.catalog);
      setDesignations(data.designations);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed to load" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { if (allowed) load(); }, [allowed]);

  const selected = typeof selectedId === "number" ? designations.find((d) => d.id === selectedId) : null;

  function selectDesignation(d: Designation) {
    setSelectedId(d.id);
    setDraft({ label: d.label, scorecardFunction: d.scorecardFunction ?? "", isActive: d.isActive, permissionKeys: [...d.permissionKeys] });
    setMsg(null);
  }
  function startNew() {
    setSelectedId("new");
    setDraft({ ...BLANK });
    setMsg(null);
  }
  function cloneFrom(id: number) {
    const src = designations.find((d) => d.id === id);
    if (!src) return;
    setSelectedId("new");
    setDraft({ label: `${src.label} (copy)`, scorecardFunction: src.scorecardFunction ?? "", isActive: true, permissionKeys: [...src.permissionKeys] });
    setMsg(null);
  }
  function togglePerm(key: string) {
    setDraft((d) => ({
      ...d,
      permissionKeys: d.permissionKeys.includes(key)
        ? d.permissionKeys.filter((k) => k !== key)
        : [...d.permissionKeys, key],
    }));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const isNew = selectedId === "new";
      const res = await fetch(
        isNew ? "/api/admin/rbac/designations" : `/api/admin/rbac/designations/${selectedId}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: draft.label,
            scorecardFunction: draft.scorecardFunction || null,
            isActive: draft.isActive,
            permissionKeys: draft.permissionKeys,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      await load();
      setSelectedId(isNew ? data.id : selectedId);
      setMsg({ kind: "ok", text: "Saved." });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (typeof selectedId !== "number") return;
    if (!confirm("Delete this designation? This can't be undone.")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/rbac/designations/${selectedId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      setSelectedId(null);
      setDraft(BLANK);
      await load();
      setMsg({ kind: "ok", text: "Deleted." });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Delete failed" });
    } finally {
      setSaving(false);
    }
  }

  const grouped = useMemo(() => {
    const m = new Map<string, PermDef[]>();
    for (const p of catalog) { const a = m.get(p.category) ?? []; a.push(p); m.set(p.category, a); }
    return m;
  }, [catalog]);

  const sensitiveSelected = draft.permissionKeys.filter((k) => catalog.find((p) => p.key === k)?.sensitive).length;

  if (status === "loading") return <div className="p-8 text-slate-500">Loading…</div>;
  if (!allowed) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-slate-800">Designations</h1>
        <p className="mt-2 text-slate-500">You don&apos;t have access to manage designations.</p>
      </div>
    );
  }

  const editing = selectedId !== null;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Designations</h1>
          <p className="text-sm text-slate-500">Create roles and choose exactly what each one can access.</p>
        </div>
        <button onClick={startNew} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">
          + New designation
        </button>
      </div>

      {msg && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${msg.kind === "ok" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {msg.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6">
        {/* ── List ── */}
        <div className="space-y-1">
          {loading && <div className="text-slate-400 text-sm">Loading…</div>}
          {designations.map((d) => (
            <button
              key={d.id}
              onClick={() => selectDesignation(d)}
              className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition ${
                selectedId === d.id ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800">{d.label}</span>
                {d.isSystem && <span className="text-[10px] uppercase tracking-wide text-slate-400">built-in</span>}
              </div>
              <div className="text-xs text-slate-400">
                {d.permissionKeys.length} perms · {d.userCount} {d.userCount === 1 ? "user" : "users"}
                {d.scorecardFunction ? ` · rated as ${d.scorecardFunction}` : ""}
                {!d.isActive ? " · inactive" : ""}
              </div>
            </button>
          ))}
        </div>

        {/* ── Editor ── */}
        {!editing ? (
          <div className="text-slate-400 text-sm flex items-center justify-center border border-dashed border-slate-200 rounded-xl p-10">
            Select a designation to edit, or create a new one.
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              <label className="block">
                <span className="text-xs font-semibold text-slate-500">Name</span>
                <input
                  value={draft.label}
                  onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                  placeholder="e.g. Content Lead"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-500">Scorecard function</span>
                <select
                  value={draft.scorecardFunction}
                  onChange={(e) => setDraft((d) => ({ ...d, scorecardFunction: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  {SCORECARD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            </div>

            {selectedId === "new" && designations.length > 0 && (
              <div className="mb-4">
                <label className="text-xs font-semibold text-slate-500">Start from an existing designation</label>
                <select
                  defaultValue=""
                  onChange={(e) => e.target.value && cloneFrom(Number(e.target.value))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  <option value="">— blank —</option>
                  {designations.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </div>
            )}

            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-slate-700">
                Permissions <span className="text-slate-400">({draft.permissionKeys.length} selected)</span>
              </span>
              {sensitiveSelected > 0 && (
                <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                  ⚠ {sensitiveSelected} sensitive
                </span>
              )}
            </div>

            <div className="space-y-4 max-h-[440px] overflow-y-auto pr-1">
              {CATEGORY_ORDER.filter((c) => grouped.has(c)).map((cat) => (
                <div key={cat}>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">
                    {CATEGORY_LABELS[cat] ?? cat}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {grouped.get(cat)!.map((p) => {
                      const on = draft.permissionKeys.includes(p.key);
                      return (
                        <label
                          key={p.key}
                          title={p.description}
                          className={`flex items-start gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer text-sm ${
                            on ? "border-indigo-300 bg-indigo-50/60" : "border-slate-200 hover:bg-slate-50"
                          }`}
                        >
                          <input type="checkbox" checked={on} onChange={() => togglePerm(p.key)} className="mt-0.5" />
                          <span>
                            <span className="font-medium text-slate-700">{p.label}</span>
                            {p.sensitive && <span className="ml-1 text-[10px] text-amber-600">🔒</span>}
                            <span className="block text-[11px] text-slate-400">{p.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mt-5 pt-4 border-t border-slate-100">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))} />
                Active
              </label>
              <div className="flex items-center gap-2">
                {selected && !selected.isSystem && selected.userCount === 0 && (
                  <button onClick={remove} disabled={saving} className="px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
                    Delete
                  </button>
                )}
                <button
                  onClick={save}
                  disabled={saving || !draft.label.trim()}
                  className="px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? "Saving…" : selectedId === "new" ? "Create designation" : "Save changes"}
                </button>
              </div>
            </div>
            {selected?.isSystem && (
              <p className="mt-2 text-xs text-slate-400">Built-in designation — editable, but can&apos;t be deleted.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
