"use client";

// Tiny utility wrapper that renders a dropdown / autocomplete panel
// through a portal on document.body and pins it to a trigger element.
// Use this anywhere a custom popup might otherwise be clipped by an
// ancestor with overflow-hidden (cards, modals, scroll containers).
//
// Auto-flips upward when there's not enough room below the trigger.
// Clamps max-height to whatever pixels are actually available so the
// panel never extends past the viewport edge.
//
// Usage:
//   const triggerRef = useRef<HTMLDivElement>(null);
//   const [open, setOpen] = useState(false);
//   <div ref={triggerRef}>
//     <input ... />
//     <PopupPanel open={open} triggerRef={triggerRef} onClose={() => setOpen(false)} maxHeight={320}>
//       <ul>…</ul>
//     </PopupPanel>
//   </div>

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

export default function PopupPanel({
  open,
  triggerRef,
  onClose,
  maxHeight = 280,
  children,
  className = "",
}: {
  open: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  onClose?: () => void;
  maxHeight?: number;
  children: ReactNode;
  className?: string;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const recompute = () => { if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect()); };
    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open || !onClose) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t))   return;
      onClose();
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, onClose, triggerRef]);

  if (!open || !rect || typeof document === "undefined") return null;

  const GAP = 4;
  const vh = typeof window !== "undefined" ? window.innerHeight : 0;
  const spaceBelow = vh - rect.bottom;
  const spaceAbove = rect.top;
  const flipUp = spaceBelow < maxHeight && spaceAbove > spaceBelow;
  const popupMaxH = Math.max(140, Math.min(maxHeight, (flipUp ? spaceAbove : spaceBelow) - GAP - 8));
  const top = flipUp ? Math.max(8, rect.top - popupMaxH - GAP) : rect.bottom + GAP;

  return createPortal(
    <div
      ref={panelRef}
      className={className}
      style={{
        position:  "fixed",
        top,
        left:      rect.left,
        width:     rect.width,
        maxHeight: popupMaxH,
        zIndex:    10000,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
