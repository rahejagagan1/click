"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";

/**
 * Single-select dropdown with full visual control. Use in place of a
 * native `<select>` whenever the dropdown is HR-facing so we can override
 * the OS-native option-highlight color (Chromium on Linux paints it dark
 * navy in dark-mode systems, which clashes with the rest of the form).
 *
 * API mirrors the bits of `<select>` we actually use across this app:
 *   <SelectField value={x} onChange={setX} options={[{value, label}, ...]} />
 *
 * Props:
 *   - options can be `string[]` (value === label) or `{value, label}[]`
 *   - placeholder shows when value is "" or undefined
 *   - className overrides only the BUTTON; popup styling stays consistent
 *   - disabled is supported (greyed out, popup won't open)
 *
 * The popup positions to the trigger via getBoundingClientRect on open
 * and re-pins on resize/scroll so it survives sidebar collapses, etc.
 */

export type SelectOption = { value: string; label: string };
type SelectInput = SelectOption | string;

function normalize(opts: SelectInput[]): SelectOption[] {
  return opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
}

export default function SelectField({
  value,
  onChange,
  options,
  placeholder = "—",
  className,
  disabled = false,
  width,
}: {
  value: string;
  onChange: (next: string) => void;
  options: SelectInput[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  width?: number;
}) {
  const [open, setOpen]   = useState(false);
  const [rect, setRect]   = useState<DOMRect | null>(null);
  const btnRef            = useRef<HTMLButtonElement>(null);
  const panelRef          = useRef<HTMLDivElement>(null);

  const items = useMemo(() => normalize(options), [options]);
  const current = items.find((o) => o.value === value);

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
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  // Default trigger styling matches the existing `cls.field` look in
  // EditProfilePanel — h-9, rounded-lg, focus ring, disabled state.
  const triggerCls =
    className ??
    "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800 placeholder-slate-400 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`${triggerCls} flex items-center justify-between gap-2 text-left`}
      >
        <span className={current ? "" : "text-slate-400"}>
          {current?.label ?? placeholder}
        </span>
        <ChevronDown size={14} strokeWidth={2} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && rect && (
        <div
          ref={panelRef}
          className="bg-white border border-slate-200 rounded-lg shadow-2xl overflow-hidden"
          style={{
            position: "fixed",
            top:   rect.bottom + 4,
            left:  rect.left,
            width: width ?? rect.width,
            maxHeight: 280,
            zIndex: 10000,
          }}
        >
          <div className="overflow-y-auto" style={{ maxHeight: 280 }}>
            {items.length === 0 ? (
              <p className="text-[12px] text-slate-400 text-center py-5">No options</p>
            ) : (
              items.map((o) => {
                const isSel = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => { onChange(o.value); setOpen(false); }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-[13px] transition-colors ${
                      isSel
                        ? "bg-[#3b82f6]/10 text-[#1e40af] font-medium"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span className="truncate">{o.label}</span>
                    {isSel && <Check size={14} strokeWidth={2.5} className="text-[#3b82f6] shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </>
  );
}
