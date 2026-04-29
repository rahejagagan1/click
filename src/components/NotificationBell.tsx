"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { Bell, BellOff, Activity, Home, Briefcase, ShieldCheck, Coffee, Trash2, MoreHorizontal } from "lucide-react";
import Link from "next/link";

// ── Notification sound ──────────────────────────────────────────────────────
// Browser-generated ping (no asset file). Two-note "bing" — short and gentle
// enough to never be annoying. Silently fails on browsers that block audio
// before the first user interaction (Safari / mobile autoplay policies).
const SOUND_PREF_KEY = "nbm:notif:sound";
function playNotificationSound() {
  try {
    const Ctx = (typeof window !== "undefined")
      ? ((window as any).AudioContext || (window as any).webkitAudioContext)
      : null;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const tones: { freq: number; start: number; dur: number }[] = [
      { freq: 880,  start: 0,    dur: 0.12 }, // A5
      { freq: 1175, start: 0.10, dur: 0.18 }, // D6 — overlap for a soft chord
    ];
    for (const t of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = t.freq;
      gain.gain.setValueAtTime(0, now + t.start);
      gain.gain.linearRampToValueAtTime(0.18, now + t.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t.start + t.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + t.start);
      osc.stop(now + t.start + t.dur + 0.02);
    }
    setTimeout(() => { try { ctx.close(); } catch {} }, 800);
  } catch { /* autoplay blocked or no audio support — silently ignore */ }
}

// Notification bodies use a `\nNote: ` separator to delimit the
// approver's free-text comment from the templated intro line. Splitting
// here lets the panel surface the note as its own styled block, and
// powers the "Notes" filter tab.
function splitNote(body: string | null | undefined): { intro: string; note: string | null } {
  if (!body) return { intro: "", note: null };
  const idx = body.indexOf("\nNote: ");
  if (idx === -1) return { intro: body, note: null };
  return {
    intro: body.slice(0, idx),
    note:  body.slice(idx + "\nNote: ".length).trim(),
  };
}

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

// Overflow menu for the rarely-used notification controls (sound toggle,
// delete-all-read). Keeps the panel header clean — only "Mark all read"
// stays as a primary action up top.
function NotifMenu({
  soundOn, onToggleSound, onDeleteRead, readCount,
}: {
  soundOn: boolean;
  onToggleSound: () => void;
  onDeleteRead: () => void;
  readCount: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More options"
        className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
          open
            ? "bg-slate-100 text-slate-700 dark:bg-white/[0.08] dark:text-white"
            : "text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:hover:bg-white/[0.05]"
        }`}
      >
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div className="absolute right-0 top-9 w-48 bg-white dark:bg-[#0a1526] border border-slate-200 dark:border-white/[0.08] rounded-lg shadow-lg overflow-hidden z-10 py-1">
          <button
            type="button"
            onClick={() => { onToggleSound(); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.04]"
          >
            {soundOn ? <BellOff size={13} /> : <Bell size={13} />}
            {soundOn ? "Mute sound" : "Unmute sound"}
          </button>
          <button
            type="button"
            onClick={() => { if (readCount > 0) { onDeleteRead(); setOpen(false); } }}
            disabled={readCount === 0}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] transition-colors ${
              readCount === 0
                ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                : "text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 cursor-pointer"
            }`}
          >
            <Trash2 size={13} />
            Delete read
            {readCount > 0 && <span className="ml-auto text-[10.5px] text-slate-400">{readCount}</span>}
          </button>
        </div>
      )}
    </div>
  );
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [tab,  setTab]  = useState<"all" | "unread" | "notes">("all");
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef   = useRef<HTMLButtonElement>(null);
  const { data } = useSWR("/api/hr/notifications?limit=20", fetcher, { refreshInterval: 30_000 });
  const items = (data?.items as any[]) || [];
  const unread = data?.unreadCount ?? 0;

  const noteCount = items.filter((n: any) => splitNote(n.body).note).length;
  const filtered = items.filter((n: any) => {
    if (tab === "unread") return !n.isRead;
    if (tab === "notes")  return !!splitNote(n.body).note;
    return true;
  });

  // Sound preference — persisted in localStorage, default ON.
  const [soundOn, setSoundOn] = useState<boolean>(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem(SOUND_PREF_KEY);
    if (v != null) setSoundOn(v === "1");
  }, []);
  const toggleSound = () => {
    setSoundOn((s) => {
      const next = !s;
      try { window.localStorage.setItem(SOUND_PREF_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  };

  // Play a soft ping when unread count goes UP — including a missed-poll jump
  // (3 → 5 plays once). Skip on first render so the page doesn't ping on load.
  const prevUnreadRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevUnreadRef.current;
    if (prev != null && unread > prev && soundOn) {
      playNotificationSound();
    }
    prevUnreadRef.current = unread;
  }, [unread, soundOn]);

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
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/[0.06] gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[15px] font-semibold text-slate-900 dark:text-white">Notifications</span>
              {unread > 0 && (
                <span className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full text-[10px] font-bold bg-[#008CFF] text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={markAllRead}
                disabled={unread === 0}
                aria-disabled={unread === 0}
                className={`text-[12px] font-semibold px-2.5 h-7 rounded-md transition-colors ${
                  unread === 0
                    ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                    : "text-[#008CFF] hover:bg-[#008CFF]/10 dark:hover:bg-[#008CFF]/15 cursor-pointer"
                }`}
              >
                Mark all read
              </button>
              <NotifMenu
                soundOn={soundOn}
                onToggleSound={() => { toggleSound(); if (!soundOn) playNotificationSound(); }}
                onDeleteRead={() => {
                  const readCount = items.filter((n: any) => n.isRead).length;
                  if (readCount === 0) return;
                  if (!confirm(`Delete ${readCount} read notification${readCount === 1 ? "" : "s"}?`)) return;
                  deleteAllRead();
                }}
                readCount={items.filter((n: any) => n.isRead).length}
              />
            </div>
          </div>
          {/* Filter tabs — All / Unread / Notes (the last surfaces approver
              comments attached to leave/regularization decisions). */}
          <div className="flex items-center gap-1 px-3 pt-2 pb-1 border-b border-slate-200 dark:border-white/[0.06]">
            {[
              { key: "all",    label: "All",    count: items.length },
              { key: "unread", label: "Unread", count: unread       },
              { key: "notes",  label: "Notes",  count: noteCount    },
            ].map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key as typeof tab)}
                  className={`flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[12px] font-semibold transition-colors ${
                    active
                      ? "bg-[#008CFF]/10 text-[#008CFF]"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.04]"
                  }`}
                >
                  {t.label}
                  {t.count > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 rounded-full ${
                      active
                        ? "bg-[#008CFF] text-white"
                        : "bg-slate-200 dark:bg-white/[0.08] text-slate-600 dark:text-slate-300"
                    }`}>
                      {t.count > 99 ? "99+" : t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <p className="text-[13px] text-slate-400 dark:text-slate-400 text-center py-14">
                {tab === "notes"  ? "No notifications with notes yet" :
                 tab === "unread" ? "You're all caught up"            :
                                    "No notifications yet"}
              </p>
            ) : filtered.map((n: any) => {
              const { tint, Icon } = metaFor(n.type);
              const { intro, note } = splitNote(n.body);
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
                    {intro && (
                      <p className={`text-[11.5px] mt-0.5 leading-snug line-clamp-2 ${n.isRead ? "text-slate-400 dark:text-slate-500" : "text-slate-600 dark:text-slate-300"}`}>
                        {intro}
                      </p>
                    )}
                    {note && (
                      <div className="mt-2 flex gap-2 rounded-md border-l-2 border-[#008CFF]/40 bg-slate-50 dark:bg-white/[0.04] pl-2.5 pr-2 py-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#008CFF] dark:text-[#4a9cff] mt-[1px]">Note</span>
                        <p className="text-[11.5px] leading-snug text-slate-700 dark:text-slate-200 break-words flex-1">
                          {note}
                        </p>
                      </div>
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
