"use client";

// Reusable dropdown that combines a fixed `defaults` list with custom
// values stored in OptionList (keyed by `listKey`). Drop-in replacement
// for a plain <select> wherever HR wants to be able to add their own
// values on the fly.
//
// Usage:
//   <CustomSelect
//     listKey="department"
//     defaults={["HR", "Researcher", "QA", ...]}
//     value={form.department}
//     onChange={(v) => set("department", v)}
//     placeholder="Select a department"
//   />
//
// Behaviour:
//   • Default values are non-deletable. Custom values get a 🗑 icon.
//   • Anyone authed can pick a value. Only HR admin tier can add /
//     delete (the API enforces this; the UI hides the buttons too).
//   • Component falls back gracefully when /api/hr/options is
//     unreachable — the defaults still render.

import { useEffect, useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { ChevronDown, Plus, Trash2, Check, X } from "lucide-react";

type CustomItem = { id: number; listKey: string; value: string };

type Props = {
  listKey: string;
  value: string;
  onChange: (v: string) => void;
  /** Built-in values that always appear and can't be deleted. */
  defaults?: string[];
  /** Placeholder shown when no value is selected. */
  placeholder?: string;
  /** Disables the field entirely (still shows current value as text). */
  disabled?: boolean;
  /** Override the input's class set if the parent uses a custom field style. */
  className?: string;
  /** Hide the add/delete affordances even for HR admins. */
  readOnlyOptions?: boolean;
  /** Required field — surfaces native validation. */
  required?: boolean;
};

const DEFAULT_FIELD_CLS =
  "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 pr-9 text-[13px] text-slate-800 placeholder-slate-400 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 disabled:bg-slate-50 disabled:text-slate-500";

export default function CustomSelect({
  listKey,
  value,
  onChange,
  defaults = [],
  placeholder = "Select…",
  disabled = false,
  className,
  readOnlyOptions = false,
  required = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  const apiUrl = `/api/hr/options?key=${encodeURIComponent(listKey)}`;
  const { data } = useSWR<{ items: CustomItem[] }>(apiUrl, fetcher, {
    revalidateOnFocus: false,
  });
  const customs = data?.items ?? [];

  // Combined list, with defaults first, then custom values alphabetised
  // by the API. Dedup so a custom value matching a default doesn't show
  // twice.
  const seen = new Set<string>();
  const allOptions: Array<{ value: string; isCustom: boolean; id?: number }> = [];
  for (const v of defaults) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    allOptions.push({ value: v, isCustom: false });
  }
  for (const c of customs) {
    if (seen.has(c.value)) continue;
    seen.add(c.value);
    allOptions.push({ value: c.value, isCustom: true, id: c.id });
  }

  // Close on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); setAdding(false); }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onPick = (v: string) => {
    onChange(v);
    setOpen(false);
    setAdding(false);
    setErr("");
  };

  const onAdd = async () => {
    const v = draft.trim();
    if (!v) { setErr("Enter a value."); return; }
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/hr/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listKey, value: v }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not add value");
      await mutate(apiUrl);
      onPick(v);
      setDraft("");
    } catch (e: any) {
      setErr(e?.message || "Could not add value");
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (e: React.MouseEvent, id: number, v: string) => {
    e.stopPropagation();
    if (!confirm(`Remove "${v}"? Anyone selecting it will keep their saved value, but it'll vanish from the dropdown.`)) return;
    try {
      const res = await fetch(`/api/hr/options?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || "Delete failed");
      }
      await mutate(apiUrl);
      // If the user had this value selected, leave it alone — the saved
      // record still has it. They'll just see the literal value next
      // time they open the dropdown.
    } catch (e: any) {
      alert(e?.message || "Delete failed");
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`${className || DEFAULT_FIELD_CLS} flex items-center justify-between text-left ${
          value ? "" : "text-slate-400"
        }`}
      >
        <span className="truncate">{value || placeholder}</span>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
      </button>
      {/* Hidden mirror input so the field participates in native form
          required-validation when the parent uses <form required>. */}
      {required && (
        <input
          tabIndex={-1}
          required
          value={value}
          onChange={() => {}}
          className="sr-only"
          aria-hidden
        />
      )}

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg"
        >
          {allOptions.length === 0 && !adding && (
            <p className="px-3 py-2 text-[12px] text-slate-400">No options yet</p>
          )}
          {allOptions.map((opt) => {
            const selected = opt.value === value;
            return (
              <div
                key={opt.value}
                role="option"
                aria-selected={selected}
                onClick={() => onPick(opt.value)}
                className={`group flex items-center gap-2 cursor-pointer px-3 py-2 text-[13px] ${
                  selected ? "bg-[#3b82f6]/10 text-[#1d4ed8]" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {selected ? (
                  <Check size={13} className="shrink-0 text-[#3b82f6]" />
                ) : (
                  <span className="w-[13px] shrink-0" />
                )}
                <span className="flex-1 truncate">{opt.value}</span>
                {opt.isCustom && !readOnlyOptions && opt.id != null && (
                  <button
                    type="button"
                    onClick={(e) => onRemove(e, opt.id!, opt.value)}
                    title="Remove this value"
                    aria-label={`Remove ${opt.value}`}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600 transition-opacity"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })}

          {!readOnlyOptions && (
            <div className="border-t border-slate-100">
              {adding ? (
                <div className="px-3 py-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); onAdd(); }
                        if (e.key === "Escape") { setAdding(false); setDraft(""); setErr(""); }
                      }}
                      placeholder="Type a new value…"
                      maxLength={120}
                      className="h-8 flex-1 rounded-md border border-slate-200 bg-white px-2.5 text-[12.5px] text-slate-800 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15"
                    />
                    <button
                      type="button"
                      disabled={busy || !draft.trim()}
                      onClick={onAdd}
                      className="h-8 inline-flex items-center gap-1 rounded-md bg-[#3b82f6] px-2.5 text-[11.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 hover:bg-[#2563eb]"
                    >
                      {busy ? "…" : "Add"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAdding(false); setDraft(""); setErr(""); }}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      aria-label="Cancel"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  {err && <p className="text-[11px] text-rose-600">{err}</p>}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setAdding(true); setDraft(""); setErr(""); }}
                  className="w-full inline-flex items-center gap-2 px-3 py-2 text-[12.5px] font-semibold text-[#3b82f6] hover:bg-[#3b82f6]/5"
                >
                  <Plus size={13} />
                  Add custom value
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
