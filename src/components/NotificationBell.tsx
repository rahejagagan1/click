"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { Bell, CheckCheck, Activity, Home, Briefcase, ShieldCheck, Coffee, Trash2 } from "lucide-react";
import Link from "next/link";

function timeAgo(iso: string): string {
  const t  = new Date(iso).getTime();
  const s  = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60)  return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60)  return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24)  return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7)   return `${d}d`;
  const w = Math.round(d / 7);
  if (w < 5)   return `${w}w`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.round(mo / 12)}y`;
}

const TYPE_META: Record<string, { tint: string; Icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }> }> = {
  regularization: { tint: "#008CFF", Icon: ShieldCheck },
  wfh:            { tint: "#10b981", Icon: Home        },
  on_duty:        { tint: "#8b5cf6", Icon: Briefcase   },
  leave:          { tint: "#f59e0b", Icon: Coffee      },
  comp_off:       { tint: "#14b8a6", Icon: Activity    },
  _default:       { tint: "#14b8a6", Icon: Activity    },
};
const metaFor = (type: string) => TYPE_META[type] || TYPE_META._default;

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef   = useRef<HTMLButtonElement>(null);
  const { data } = useSWR("/api/hr/notifications?limit=10", fetcher, { refreshInterval: 30_000 });
  const items = (data?.items as any[]) || [];
  const unread = data?.unreadCount ?? 0;

  // Close on outside click. Use click (not mousedown) so the button's own
  // onClick can run first and flip state without racing a close.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t))  return;
      if (btnRef.current?.contains(t))    return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const toggle = () => setOpen((v) => !v);

  const markRead = async (id: number) => {
    await fetch("/api/hr/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", id }),
    });
    mutate((k: any) => typeof k === "string" && k.startsWith("/api/hr/notifications"));
  };

  const markAllRead = async () => {
    await fetch("/api/hr/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read_all" }),
    });
    mutate((k: any) => typeof k === "string" && k.startsWith("/api/hr/notifications"));
  };

  const deleteAllRead = async () => {
    await fetch("/api/hr/notifications?scope=read", { method: "DELETE" });
    mutate((k: any) => typeof k === "string" && k.startsWith("/api/hr/notifications"));
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition-all hover:brightness-110"
        aria-label="Notifications"
        aria-expanded={open}
        style={{ zIndex: 40, color: "#ffffff", background: "#4ba3ff", boxShadow: "0 0 0 1.5px rgba(255,255,255,0.85)" }}
      >
        <Bell size={16} strokeWidth={2.25} style={{ pointerEvents: "none", color: "#ffffff" }} />
        {unread > 0 && (
          <span
            className="absolute -right-1 -top-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white ring-2 ring-[#0f6ecd]"
            style={{ pointerEvents: "none" }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && typeof document !== "undefined" && createPortal((() => {
        const rect = btnRef.current?.getBoundingClientRect();
        const top  = (rect?.bottom ?? 0) + 8;
        // Anchor panel's right edge to the button's right edge, clamped to the
        // viewport so the panel never extends past the right side.
        const vw   = typeof window !== "undefined" ? window.innerWidth : 0;
        const right = Math.max(8, vw - (rect?.right ?? vw));
        return (
        <div
          ref={panelRef}
          className="fixed w-[380px] max-w-[calc(100vw-16px)] max-h-[520px] bg-white dark:bg-[#0a1526] border border-slate-200 dark:border-white/[0.08] rounded-xl shadow-2xl flex flex-col overflow-hidden"
          style={{ zIndex: 9999, top, right }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/[0.06] gap-3">
            <span className="text-[14px] font-semibold text-slate-900 dark:text-white shrink-0">Notifications</span>
            <div className="flex items-center gap-3 text-[12px] font-medium">
              <button
                type="button"
                onClick={markAllRead}
                disabled={unread === 0}
                aria-disabled={unread === 0}
                className={`flex items-center gap-1 transition-colors ${
                  unread === 0
                    ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                    : "text-[#008CFF] hover:underline cursor-pointer"
                }`}
              >
                <CheckCheck size={13} /> Mark all as read
              </button>
              {(() => {
                const readCount = items.filter((n: any) => n.isRead).length;
                const disabled = readCount === 0;
                return (
                  <button
                    type="button"
                    onClick={() => {
                      if (disabled) return;
                      if (!confirm(`Delete ${readCount} read notification${readCount === 1 ? "" : "s"}?`)) return;
                      deleteAllRead();
                    }}
                    disabled={disabled}
                    aria-disabled={disabled}
                    title={disabled ? "No read notifications to delete" : `Delete ${readCount} read notification${readCount === 1 ? "" : "s"}`}
                    className={`flex items-center gap-1 transition-colors ${
                      disabled
                        ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                        : "text-rose-500 hover:underline cursor-pointer"
                    }`}
                  >
                    <Trash2 size={13} /> Delete read
                  </button>
                );
              })()}
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {items.length === 0 ? (
              <p className="text-[13px] text-slate-400 dark:text-slate-400 text-center py-14">No notifications yet</p>
            ) : items.map((n: any) => {
              const { tint, Icon } = metaFor(n.type);
              const body = (
                <div className={`relative flex items-start gap-3 px-4 py-3.5 border-b border-slate-100 dark:border-white/[0.04] transition-colors ${n.isRead ? "hover:bg-slate-50 dark:hover:bg-white/[0.02]" : "bg-[#008CFF]/[0.04] hover:bg-[#008CFF]/[0.08] dark:bg-[#4a9cff]/[0.06] dark:hover:bg-[#4a9cff]/[0.1]"}`}>
                  {!n.isRead && (
                    <span className="absolute left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#008CFF] dark:bg-[#4a9cff]" />
                  )}
                  <span
                    className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                    style={{ background: `${tint}22`, color: tint }}
                  >
                    <Icon size={16} strokeWidth={2} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] leading-snug ${n.isRead ? "text-slate-500 dark:text-slate-400 font-medium" : "text-slate-900 dark:text-white font-semibold"}`}>
                      {n.title}
                    </p>
                    {n.body && (
                      <p className={`text-[11.5px] mt-0.5 leading-snug line-clamp-2 ${n.isRead ? "text-slate-400 dark:text-slate-500" : "text-slate-600 dark:text-slate-300"}`}>
                        {n.body}
                      </p>
                    )}
                    <p className={`text-[11px] mt-1 ${n.isRead ? "text-slate-400 dark:text-slate-500" : "text-slate-500 dark:text-slate-400"}`}>
                      {timeAgo(n.createdAt)}
                    </p>
                  </div>
                </div>
              );
              const onClick = () => { if (!n.isRead) markRead(n.id); setOpen(false); };
              return n.linkUrl ? (
                <Link key={n.id} href={n.linkUrl} onClick={onClick} className="block">{body}</Link>
              ) : (
                <button key={n.id} type="button" onClick={onClick} className="w-full text-left">{body}</button>
              );
            })}
          </div>
        </div>
        );
      })(), document.body)}
    </>
  );
}
