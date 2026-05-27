"use client";

// Admin → Emails Automation. One on/off switch per outbound email kind.
// Each flip auto-saves (PATCH /api/admin/email-toggles) the moment the
// switch moves — same UX as the Regularization Policy card. The change
// is honored on the next email dispatch, no restart.
//
// Catalog comes from the server so this UI auto-updates when new kinds
// get added to src/lib/email/toggles.ts.

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Mail } from "lucide-react";

type CatalogItem = {
    key: string;
    label: string;
    description: string;
    group: string;
};
type Toggles = Record<string, boolean>;

export default function EmailsAutomationPanel() {
    const [catalog,  setCatalog]  = useState<CatalogItem[]>([]);
    const [toggles,  setToggles]  = useState<Toggles>({});
    const [loading,  setLoading]  = useState(true);
    // Per-row save state — keyed by toggle.key. While a key is in this
    // set, its switch shows "Saving…" and is disabled to avoid stacking
    // requests on the same row.
    const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
    // Bulk-mode save state — used by "All on" / "All off" buttons.
    const [bulkSaving, setBulkSaving] = useState(false);
    const [banner,   setBanner]   = useState<{ type: "ok" | "err"; text: string } | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetch("/api/admin/email-toggles")
            .then((r) => r.json())
            .then((d) => {
                if (cancelled) return;
                if (d?.error) { setBanner({ type: "err", text: d.error }); return; }
                setCatalog(d.catalog ?? []);
                setToggles(d.toggles ?? {});
            })
            .catch(() => { if (!cancelled) setBanner({ type: "err", text: "Failed to load toggles" }); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    // Auto-save on flip: optimistically apply the new value, fire the
    // PATCH, revert on failure. Banner toasts success briefly so the
    // user knows it landed; errors stick until the next interaction.
    const flipAndSave = async (key: string) => {
        if (savingKeys.has(key) || bulkSaving) return;
        const before = !!toggles[key];
        const next   = !before;
        // Optimistic update.
        setToggles((t) => ({ ...t, [key]: next }));
        setSavingKeys((s) => {
            const n = new Set(s);
            n.add(key);
            return n;
        });
        setBanner(null);
        try {
            const res = await fetch("/api/admin/email-toggles", {
                method:  "PATCH",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ [key]: next }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) {
                // Revert and surface the error.
                setToggles((t) => ({ ...t, [key]: before }));
                setBanner({ type: "err", text: d?.error || "Save failed" });
                return;
            }
            // Trust the server response as the new truth.
            if (d?.toggles && typeof d.toggles === "object") setToggles(d.toggles);
            setBanner({ type: "ok", text: `${labelFor(key) ?? key} ${next ? "enabled" : "disabled"}.` });
            setTimeout(() => setBanner(null), 2500);
        } catch {
            setToggles((t) => ({ ...t, [key]: before }));
            setBanner({ type: "err", text: "Save failed" });
        } finally {
            setSavingKeys((s) => {
                const n = new Set(s);
                n.delete(key);
                return n;
            });
        }
    };

    // Bulk apply — sets every catalog key to `value` in one PATCH. Used
    // by "All on" / "All off". Optimistic + revert on error, same as
    // single-flip.
    const bulkApply = async (value: boolean) => {
        if (bulkSaving) return;
        const before = { ...toggles };
        const next: Toggles = {};
        for (const c of catalog) next[c.key] = value;
        setToggles(next);
        setBulkSaving(true);
        setBanner(null);
        try {
            const res = await fetch("/api/admin/email-toggles", {
                method:  "PATCH",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify(next),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) {
                setToggles(before);
                setBanner({ type: "err", text: d?.error || "Save failed" });
                return;
            }
            if (d?.toggles && typeof d.toggles === "object") setToggles(d.toggles);
            setBanner({ type: "ok", text: value ? "All emails turned on." : "All emails turned off." });
            setTimeout(() => setBanner(null), 2500);
        } catch {
            setToggles(before);
            setBanner({ type: "err", text: "Save failed" });
        } finally {
            setBulkSaving(false);
        }
    };

    const labelFor = (key: string) => catalog.find((c) => c.key === key)?.label;

    // Group catalog items by their `group` field for visual sectioning.
    const grouped: Record<string, CatalogItem[]> = {};
    for (const c of catalog) {
        if (!grouped[c.group]) grouped[c.group] = [];
        grouped[c.group].push(c);
    }
    // Group order — Recipients first (it's a meta-control that gates
    // recipient classes across every email kind, so it deserves the top
    // slot), then the per-kind groups in their original order.
    const KNOWN_ORDER = ["Recipients", "Requests", "Reports & Feedback", "Recruiting", "Cron jobs"];
    const groupOrder = [
        ...KNOWN_ORDER.filter((g) => grouped[g]),
        ...Object.keys(grouped).filter((g) => !KNOWN_ORDER.includes(g)),
    ];
    const enabledCount = Object.values(toggles).filter(Boolean).length;
    const totalCount   = catalog.length;

    if (loading) {
        return (
            <div className="max-w-4xl rounded-2xl bg-white border border-slate-200 p-12 text-center text-slate-400 text-[13px]">
                <span className="inline-flex h-7 w-7 items-center justify-center">
                    <span className="h-5 w-5 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
                </span>
                <p className="mt-3">Loading email toggles…</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl space-y-4">
            <div className="rounded-2xl bg-white border border-slate-200 shadow-[0_1px_3px_rgba(15,23,42,0.04)] p-5">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-xl bg-violet-500/10 text-violet-600 flex items-center justify-center shrink-0">
                            <Mail size={18} />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-[15px] font-semibold text-slate-800">Emails Automation</h2>
                            <p className="mt-1 text-[12.5px] text-slate-500">
                                Turn outbound emails on / off per type. Changes save automatically the moment you flip a switch.
                                In-app notifications keep flowing — only the email channel is gated.
                            </p>
                        </div>
                    </div>
                    <span className="shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200">
                        {enabledCount} / {totalCount} active
                    </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                    <button
                        onClick={() => bulkApply(true)}
                        disabled={bulkSaving}
                        className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-slate-600 hover:border-emerald-300 hover:text-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {bulkSaving ? "Saving…" : "All on"}
                    </button>
                    <button
                        onClick={() => bulkApply(false)}
                        disabled={bulkSaving}
                        className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-slate-600 hover:border-rose-300 hover:text-rose-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {bulkSaving ? "Saving…" : "All off"}
                    </button>
                </div>
            </div>

            {banner && (
                <div className={`rounded-xl px-4 py-2.5 text-[12.5px] font-medium flex items-start gap-2 ${
                    banner.type === "ok"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-rose-50 text-rose-700 border border-rose-200"
                }`}>
                    {banner.type === "ok"
                        ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                        : <XCircle size={14} className="shrink-0 mt-0.5" />}
                    <span>{banner.text}</span>
                </div>
            )}

            {groupOrder.map((g) => grouped[g] && (
                <div key={g} className="rounded-2xl bg-white border border-slate-200 shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
                    <div className="px-5 py-3 border-b border-slate-100">
                        <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-500">{g}</h3>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {grouped[g].map((t) => {
                            const on    = !!toggles[t.key];
                            const busy  = savingKeys.has(t.key) || bulkSaving;
                            return (
                                <div key={t.key} className="flex items-start justify-between gap-4 px-5 py-3.5">
                                    <div className="min-w-0">
                                        <p className="text-[13.5px] font-semibold text-slate-800">{t.label}</p>
                                        <p className="mt-0.5 text-[11.5px] text-slate-500 leading-relaxed">{t.description}</p>
                                        <code className="mt-1 inline-block text-[10px] text-slate-400 bg-slate-50 px-1.5 rounded">{t.key}</code>
                                    </div>
                                    <div className="shrink-0 flex flex-col items-end gap-1">
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={on}
                                            aria-label={`${on ? "Disable" : "Enable"} ${t.label}`}
                                            onClick={() => flipAndSave(t.key)}
                                            disabled={busy}
                                            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 disabled:cursor-wait ${on ? "bg-emerald-500" : "bg-slate-300"}`}
                                        >
                                            <span className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-transform ${on ? "translate-x-[23px]" : "translate-x-[3px]"}`} />
                                        </button>
                                        <span className={`text-[10px] font-bold uppercase tracking-wider transition-colors ${
                                            busy
                                                ? "text-slate-400"
                                                : on
                                                ? "text-emerald-600"
                                                : "text-slate-400"
                                        }`}>
                                            {busy ? "Saving…" : on ? "On" : "Off"}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}
