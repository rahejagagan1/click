"use client";
import { useRef } from "react";
import { Calendar } from "lucide-react";

/**
 * Date input that ALWAYS displays as dd/mm/yyyy regardless of browser
 * locale (a native <input type="date"> follows the browser's locale,
 * which is mm/dd/yyyy for en-US — not what we want on an Indian
 * product). The trick: render an invisible native date input on top of
 * a styled display layer. Click anywhere on the field opens the OS
 * calendar popup; the selected date shows up formatted as dd/mm/yyyy.
 *
 * Stores YYYY-MM-DD upstream (drop-in for the existing form state and
 * the API contract, which uses ISO date strings everywhere).
 *
 * Props:
 *   value     — current date as YYYY-MM-DD or "".
 *   onChange  — fired with the new YYYY-MM-DD (or "" when cleared).
 *   min       — earliest allowed date (YYYY-MM-DD).
 *   max       — latest allowed date (YYYY-MM-DD).
 *   disabled  — disables the field.
 *   className — extra classes on the outer wrapper.
 *   placeholder — text shown when empty (default "dd/mm/yyyy").
 *   compact   — h-8 instead of h-9 for tighter layouts.
 */
export function DateField({
  value,
  onChange,
  min,
  max,
  disabled,
  className,
  placeholder = "dd/mm/yyyy",
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const display = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
  })();
  const h = compact ? "h-8" : "h-9";
  // Chromium doesn't reliably open the native calendar when you click an
  // opacity-0 <input type="date"> — the click focuses it but the picker
  // stays closed. Call showPicker() explicitly on every interaction
  // (click / focus / keyboard activation) so the popup actually appears.
  // Guarded in try/catch because some browsers throw if it's already open.
  const openPicker = () => {
    if (disabled) return;
    const el = inputRef.current;
    if (!el) return;
    try { el.showPicker?.(); } catch { /* picker already open or unsupported */ }
  };
  // Default width is a fixed 160px — about the right size for a
  // "dd/mm/yyyy" value + calendar icon. Callers that want it to fill a
  // grid cell pass `w-full` via className (which overrides the default
  // via the inline style fallback below). Inline style for width is the
  // safest way to keep both behaviours without Tailwind class conflicts.
  return (
    <div
      onClick={openPicker}
      style={className?.match(/\bw-/) ? undefined : { width: "160px" }}
      className={`relative inline-flex items-center ${disabled ? "" : "cursor-pointer"} ${className ?? ""}`}
    >
      <div
        className={`pointer-events-none flex items-center w-full ${h} px-3 pr-9 border border-slate-200 rounded-lg bg-white text-[13px] ${
          disabled ? "opacity-60" : ""
        }`}
      >
        <span className={display ? "text-slate-800" : "text-slate-400"}>
          {display || placeholder}
        </span>
      </div>
      <Calendar size={14} className="pointer-events-none absolute right-3 text-slate-500" />
      <input
        ref={inputRef}
        type="date"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onClick={openPicker}
        onFocus={openPicker}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); } }}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer focus:outline-none disabled:cursor-not-allowed"
        aria-label="Pick a date"
      />
    </div>
  );
}
