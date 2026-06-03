"use client";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import SelectField from "@/components/ui/SelectField";
import { ThumbsUp, MessageSquare, Send, BarChart2, Award, MoreHorizontal, X, ChevronDown, Pencil, Trash2, Link2, Check } from "lucide-react";
import Link from "next/link";
import { isHRAdmin } from "@/lib/access";
import { PageShell, PageHeader, PageContainer } from "@/components/layout";

function Avatar({ name, url, size = 36 }: { name: string; url?: string | null; size?: number }) {
  const initials = name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
  const colors = ["bg-violet-500","bg-emerald-500","bg-[#008CFF]","bg-amber-500","bg-pink-500","bg-teal-500"];
  const color  = colors[name.charCodeAt(0) % colors.length];
  return url ? (
    <img src={url} alt={name} style={{ width: size, height: size }}
      className="rounded-full object-cover shrink-0" />
  ) : (
    <div style={{ width: size, height: size }}
      className={`${color} rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0`}>
      {initials}
    </div>
  );
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function PostCard({ post, sessionUser }: { post: any; sessionUser: any }) {
  const sessionUserId = sessionUser?.dbId;
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  // Track the user's CURRENT reaction emoji (null = none) so the
  // React button can display it directly. Replaces the old single
  // boolean `localReacted` — multi-emoji reactions need the actual
  // emoji to render the button face.
  const myCurrentReaction = Array.isArray(post.reactions)
    ? (post.reactions.find((r: any) => r.userId === sessionUserId)?.emoji ?? null)
    : null;
  const [myReactionEmoji, setMyReactionEmoji] = useState<string | null>(myCurrentReaction);
  const [reactionCount, setReactionCount] = useState(post.reactions.length);
  // Emoji picker popover anchored above the React button.
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const reactionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const reactionPickerRef  = useRef<HTMLDivElement | null>(null);
  const REACTION_EMOJIS = ["👍", "❤️", "🤣", "😮", "😢", "🙏", "👏", "🎉", "🎂", "🔥"];

  // Dots-menu state. Copy link is shown to everyone; Edit only to the
  // author; Delete to the author + HR admins (moderation).
  const isAuthor   = post.author.id === sessionUserId;
  const canDelete  = isAuthor || isHRAdmin(sessionUser);
  const [menuOpen, setMenuOpen]   = useState(false);
  const [editing,  setEditing]    = useState(false);
  const [draft,    setDraft]      = useState(post.content);
  const [saving,   setSaving]     = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);

  // Compute the dropdown's screen position from the trigger's bounding
  // box and render via a body-level portal. Going through a portal
  // sidesteps the card's overflow-hidden — the previous menu rendered
  // inside the card and was getting clipped, which is why "nothing
  // appeared" when clicking the dots.
  const openMenu = () => {
    if (!menuBtnRef.current) return;
    const r = menuBtnRef.current.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setMenuOpen(true);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const insideBtn   = menuBtnRef.current?.contains(e.target as Node);
      const insidePanel = menuPanelRef.current?.contains(e.target as Node);
      if (!insideBtn && !insidePanel) setMenuOpen(false);
    };
    const onScroll = () => setMenuOpen(false); // close on scroll — fixed pos drifts
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll",   onScroll, true);
    window.addEventListener("resize",   onScroll);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [menuOpen]);

  // Three-way pick: same emoji = remove, different = replace, none = add.
  const pickReaction = async (emoji: string) => {
    setReactionPickerOpen(false);
    const prior = myReactionEmoji;
    if (prior === emoji) {
      setMyReactionEmoji(null);
      setReactionCount((c: number) => Math.max(0, c - 1));
    } else if (prior) {
      setMyReactionEmoji(emoji);
    } else {
      setMyReactionEmoji(emoji);
      setReactionCount((c: number) => c + 1);
    }
    try {
      await fetch(`/api/hr/engage/posts/${post.id}/react`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emoji }),
      });
    } catch { /* SWR revalidate corrects */ }
    mutate("/api/hr/engage/posts");
  };
  const onReactButtonClick = () => {
    if (myReactionEmoji) { pickReaction(myReactionEmoji); return; }
    setReactionPickerOpen(true);
  };
  useEffect(() => {
    if (!reactionPickerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setReactionPickerOpen(false); };
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (reactionTriggerRef.current?.contains(t)) return;
      if (reactionPickerRef.current?.contains(t))  return;
      setReactionPickerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [reactionPickerOpen]);

  const submitComment = async () => {
    if (!commentText.trim()) return;
    await fetch(`/api/hr/engage/posts/${post.id}/comments`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: commentText }),
    });
    setCommentText("");
    mutate("/api/hr/engage/posts");
  };

  const saveEdit = async () => {
    if (!draft.trim() || draft === post.content) { setEditing(false); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/engage/posts/${post.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Could not save edit"); return; }
      setEditing(false);
      mutate("/api/hr/engage/posts");
    } finally { setSaving(false); }
  };

  const deletePost = async () => {
    if (!confirm("Delete this post? This can't be undone.")) return;
    const res = await fetch(`/api/hr/engage/posts/${post.id}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Could not delete"); return; }
    mutate("/api/hr/engage/posts");
  };

  // Copy a sharable URL pointing at this post. There's no per-post
  // permalink page yet — the engage feed lives at /dashboard/hr/engage,
  // so we hash-fragment the post id (#post-N). The feed is single-page
  // so any future deep-link handler can scroll to the matching card.
  const copyLink = async () => {
    const url = `${window.location.origin}/dashboard/hr/engage#post-${post.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      // Fallback for browsers / contexts where the Clipboard API is
      // blocked (HTTP, sandboxed iframes). Show the URL so the user
      // can copy manually.
      window.prompt("Copy this link:", url);
    }
  };

  const isPraise = post.type === "praise";

  // Long-content truncation — collapse to ~280 chars or 4 lines and
  // show a "View more" toggle. Matches the reference layout where
  // birthday-style posts get clipped under a fold.
  const COLLAPSE_AT = 280;
  const tooLong    = post.content.length > COLLAPSE_AT || (post.content.match(/\n/g)?.length ?? 0) > 3;
  const [expanded, setExpanded] = useState(false);
  const visibleBody = !tooLong || expanded
    ? post.content
    : post.content.slice(0, COLLAPSE_AT).trimEnd() + "…";

  // Reactor list — compact inline "{latest} and +N others",
  // click +N opens an anchored popover (matches the home feed).
  const reactorNames: string[] = Array.isArray(post.reactions)
    ? post.reactions.map((r: any) => r.user?.name).filter(Boolean)
    : [];
  const latestReactor = reactorNames.length > 0 ? reactorNames[reactorNames.length - 1] : null;
  const otherReactors = reactorNames.length > 1 ? reactorNames.length - 1 : 0;
  const [reactorsOpen, setReactorsOpen] = useState(false);
  const [reactorsAnchor, setReactorsAnchor] = useState<{ top: number; left: number } | null>(null);
  const reactorsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const reactorsPanelRef   = useRef<HTMLDivElement | null>(null);
  const openReactorsPopover = () => {
    const btn = reactorsTriggerRef.current;
    if (!btn) { setReactorsOpen(true); return; }
    const rect = btn.getBoundingClientRect();
    const PANEL_W = 200;
    const PANEL_H_GUESS = Math.min(260, 12 + reactorNames.length * 30);
    const GAP = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const above = rect.top - GAP - PANEL_H_GUESS;
    const below = rect.bottom + GAP;
    const top = above >= 8 ? above : Math.min(below, vh - PANEL_H_GUESS - 8);
    let left = rect.right - PANEL_W;
    if (left < 8) left = 8;
    if (left + PANEL_W > vw - 8) left = vw - PANEL_W - 8;
    setReactorsAnchor({ top, left });
    setReactorsOpen(true);
  };
  useEffect(() => {
    if (!reactorsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setReactorsOpen(false); };
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (reactorsTriggerRef.current?.contains(t)) return;
      if (reactorsPanelRef.current?.contains(t))   return;
      setReactorsOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [reactorsOpen]);

  return (
    // overflow-visible (was overflow-hidden) so any absolute children
    // — including a dropdown if the portal route is unavailable —
    // aren't clipped at the card boundary. Image and praise header
    // already have their own internal overflow-hidden where needed.
    <div id={`post-${post.id}`} className="bg-white dark:bg-[#0d1b2a] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-visible scroll-mt-24">
      {isPraise && (
        <div className="rounded-t-xl bg-gradient-to-r from-amber-500/10 to-orange-500/5 border-b border-amber-200/50 dark:border-amber-500/20 px-5 py-2 flex items-center gap-2">
          <Award className="w-4 h-4 text-amber-500" />
          <span className="text-[12px] font-semibold text-amber-700 dark:text-amber-400">
            {post.author.name} praised {post.praiseTo?.name}
          </span>
        </div>
      )}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Avatar name={post.author.name} url={post.author.profilePictureUrl} size={38} />
            <div>
              <p className="text-[13px] font-semibold text-slate-800 dark:text-white">{post.author.name}
                <span className="text-slate-400 dark:text-slate-500 font-normal"> created a post</span>
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{timeAgo(post.createdAt)}</p>
            </div>
          </div>
          <button
            ref={menuBtnRef}
            onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}
            aria-label="More options"
            aria-expanded={menuOpen}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {menuOpen && menuPos && typeof document !== "undefined" && createPortal(
            <div
              ref={menuPanelRef}
              style={{ position: "fixed", top: menuPos.top, right: menuPos.right, zIndex: 1000 }}
              className="min-w-[160px] rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0d1b2a] shadow-lg overflow-hidden"
            >
              {isAuthor && (
                <button
                  onClick={() => { setMenuOpen(false); setDraft(post.content); setEditing(true); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
              )}
              <button
                onClick={() => { setMenuOpen(false); copyLink(); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
              >
                {linkCopied
                  ? (<><Check className="w-3.5 h-3.5 text-emerald-600" /> Link copied</>)
                  : (<><Link2 className="w-3.5 h-3.5" /> Copy link</>)}
              </button>
              {canDelete && (
                <button
                  onClick={() => { setMenuOpen(false); deletePost(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              )}
            </div>,
            document.body,
          )}
        </div>

        {editing ? (
          <div className="mt-3 space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-[14px] text-slate-700 dark:text-slate-200 focus:outline-none focus:border-[#008CFF]"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setEditing(false); setDraft(post.content); }}
                disabled={saving}
                className="h-8 px-3 rounded-lg text-[12px] font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="h-8 px-4 rounded-lg bg-[#008CFF] hover:bg-[#0077dd] text-white text-[12px] font-semibold disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-3 text-[14px] text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{visibleBody}</p>
            {tooLong && (
              <button
                onClick={() => setExpanded((p) => !p)}
                className="mt-1 text-[12.5px] font-semibold text-[#008CFF] hover:text-[#0077dd]"
              >
                {expanded ? "View less" : "View more"}
              </button>
            )}
          </>
        )}

        {post.mediaUrl && (
          // Image fills the post card width and grows to its natural
          // height, capped so a single tall portrait can't dominate
          // the feed. Matches the Keka layout HR shared — work-
          // anniversary cards / posters render large and prominent
          // instead of tiny letterboxed thumbnails. `object-contain`
          // keeps the whole image visible (no crop). The subtle
          // background only shows on rare wider-than-card images.
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/[0.02]">
            <img
              src={post.mediaUrl}
              alt="post media"
              className="block w-full h-auto max-h-[640px] object-contain"
            />
          </div>
        )}
      </div>

      {/* Footer — Like / Comment on the left, reaction summary on the right.
          Single row replaces the previous two-row layout (separate count
          row + full-width action split) so the card matches the reference
          design HR shared. */}
      <div className="flex items-center justify-between px-2 sm:px-3 py-1.5 border-t border-slate-100 dark:border-white/[0.04]">
        <div className="flex items-center">
          <div className="relative">
            <button
              ref={reactionTriggerRef}
              type="button"
              onClick={onReactButtonClick}
              title={myReactionEmoji ? "Click to remove" : "React"}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors ${
                myReactionEmoji ? "text-[#008CFF]" : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {myReactionEmoji ? (
                <span className="text-[16px] leading-none">{myReactionEmoji}</span>
              ) : (
                <ThumbsUp className="w-4 h-4" />
              )}
              React
            </button>
            {reactionPickerOpen && (
              <div
                ref={reactionPickerRef}
                role="dialog"
                className="absolute bottom-full left-0 mb-1.5 z-50 flex items-center gap-0.5 px-1 py-1 rounded-full border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0d1b2a] shadow-[0_6px_18px_-4px_rgba(15,23,42,0.25)] animate-in fade-in zoom-in-95 duration-100"
              >
                {REACTION_EMOJIS.map((e) => {
                  const isMine = e === myReactionEmoji;
                  return (
                    <button
                      key={e}
                      type="button"
                      onClick={() => pickReaction(e)}
                      title={isMine ? "Click to remove" : "React"}
                      className={`h-7 w-7 flex items-center justify-center rounded-full text-[16px] transition-transform hover:scale-110 ${isMine ? "bg-[#e6f3ff] dark:bg-[#008CFF]/20" : "hover:bg-slate-50 dark:hover:bg-white/[0.04]"}`}
                    >
                      {e}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button onClick={() => setShowComments(p => !p)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors">
            <MessageSquare className="w-4 h-4" />Comment
          </button>
        </div>
        <div className="flex items-center gap-1.5 pr-2 text-[12px] text-slate-500 dark:text-slate-400">
          {reactionCount > 0 && (
            // Compact reactor summary — most recent name inline,
            // "+ N others" opens a body-level modal with the full
            // list. Quieter than the old hover card and works on
            // touch devices.
            <span className="inline-flex items-center gap-1">
              <span className="inline-flex items-center -space-x-1">
                <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-[#008CFF] text-white text-[10px] ring-2 ring-white dark:ring-[#0d1b2a]">👍</span>
              </span>
              <span className="truncate max-w-[180px]" title={latestReactor || ""}>{latestReactor}</span>
              {otherReactors > 0 && (
                <button
                  ref={reactorsTriggerRef}
                  type="button"
                  onClick={openReactorsPopover}
                  className="font-semibold text-[#008CFF] hover:underline"
                >
                  and +{otherReactors} {otherReactors === 1 ? "other" : "others"}
                </button>
              )}
            </span>
          )}
          {post.comments.length > 0 && (
            <span>{reactionCount > 0 ? "•" : ""} {post.comments.length} {post.comments.length === 1 ? "Comment" : "Comments"}</span>
          )}
        </div>
      </div>

      {/* Comments section */}
      {showComments && (
        <div className="border-t border-slate-100 dark:border-white/[0.04] px-5 py-3 space-y-3 bg-slate-50/50 dark:bg-white/[0.01]">
          {post.comments.map((c: any) => (
            <div key={c.id} className="flex items-start gap-2.5">
              <Avatar name={c.author.name} url={c.author.profilePictureUrl} size={28} />
              <div className="flex-1 bg-white dark:bg-[#0d1b2a] border border-slate-100 dark:border-white/[0.06] rounded-xl px-3 py-2">
                <p className="text-[12px] font-semibold text-slate-800 dark:text-white">{c.author.name}</p>
                <p className="text-[12px] text-slate-600 dark:text-slate-300 mt-0.5">{c.content}</p>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2.5">
            <Avatar name="You" size={28} />
            <div className="flex-1 flex items-center gap-2 bg-white dark:bg-[#0d1b2a] border border-slate-200 dark:border-white/10 rounded-xl px-3 py-1.5">
              <input
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && submitComment()}
                placeholder="Write a comment…"
                className="flex-1 bg-transparent text-[12px] text-slate-700 dark:text-slate-300 placeholder-slate-400 focus:outline-none"
              />
              <button onClick={submitComment} className="text-[#008CFF] hover:text-[#0077dd]">
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reactors popover — minimal anchored card. No header, no
          close button (click-outside / Esc handles it). */}
      {reactorsOpen && reactorsAnchor && typeof document !== "undefined" && createPortal(
        <div
          ref={reactorsPanelRef}
          role="dialog"
          aria-modal="false"
          style={{ position: "fixed", top: reactorsAnchor.top, left: reactorsAnchor.left, width: 200, zIndex: 10000 }}
          className="rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0d1b2a] shadow-[0_6px_18px_-4px_rgba(15,23,42,0.2)] animate-in fade-in duration-100"
        >
          <ul className="max-h-[220px] overflow-y-auto py-1.5">
            {reactorNames.map((name, i) => (
              <li key={i} className="flex items-center gap-2 px-3 py-1">
                <span className="truncate text-[12px] text-slate-700 dark:text-slate-200">{name}</span>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}

export default function EngagePage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const sessionUserId = user?.dbId;

  const { data: posts = [], isLoading } = useSWR("/api/hr/engage/posts", fetcher);
  // Only active employees show up in the @mention picker — offboarded
  // people stay in the DB but shouldn't be addressable in new posts.
  const { data: employees = [] } = useSWR("/api/hr/employees?isActive=true", fetcher);

  const [feedTab, setFeedTab]   = useState<"post"|"poll"|"praise">("post");
  const [scopeTab, setScopeTab] = useState("Organization");
  const [content, setContent]   = useState("");
  const [praiseToId, setPraiseToId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!content.trim()) return;
    setSubmitting(true);
    await fetch("/api/hr/engage/posts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, type: feedTab, praiseToId: praiseToId || undefined }),
    });
    setContent(""); setPraiseToId(""); setSubmitting(false);
    mutate("/api/hr/engage/posts");
  };

  return (
    <PageShell>
      <PageHeader
        title="Engage"
        subtitle="Connect with your team — post updates, polls, and appreciation"
      />
      <PageContainer maxWidth="md" className="py-5 space-y-4">

        {/* Compose card */}
        <div className="bg-white dark:bg-[#0d1b2a] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
          {/* Scope tabs */}
          <div className="flex items-center border-b border-slate-100 dark:border-white/[0.04] px-4">
            {["Organization", "NB Media"].map(t => (
              <button key={t} onClick={() => setScopeTab(t)}
                className={`px-4 py-3 text-[13px] font-semibold border-b-2 transition-colors -mb-px ${
                  scopeTab === t ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-500 dark:text-slate-400"
                }`}>{t}</button>
            ))}
          </div>

          <div className="p-4">
            {/* Post / Poll / Praise switcher */}
            <div className="flex items-center gap-2 mb-3">
              {[
                { key: "post",   label: "Post",   icon: Send },
                { key: "poll",   label: "Poll",   icon: BarChart2 },
                { key: "praise", label: "Praise", icon: Award },
              ].map(({ key, label, icon: Icon }) => (
                <button key={key} onClick={() => setFeedTab(key as any)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                    feedTab === key ? "bg-[#008CFF]/10 text-[#008CFF]" : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
                  }`}>
                  <Icon className="w-3.5 h-3.5" />{label}
                </button>
              ))}
            </div>

            {feedTab === "praise" && (
              <div className="mb-3">
                <SelectField
                  value={praiseToId}
                  onChange={setPraiseToId}
                  placeholder="Select someone to praise…"
                  options={employees.map((e: any) => ({ value: String(e.id), label: e.name }))}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-slate-700 dark:text-slate-300"
                />
              </div>
            )}

            <div className="flex items-start gap-3">
              <Avatar name={user?.name || "You"} url={user?.profilePictureUrl} size={34} />
              <textarea
                value={content} onChange={e => setContent(e.target.value)}
                placeholder={
                  feedTab === "praise" ? "Write your appreciation message…" :
                  feedTab === "poll"   ? "What do you want to poll about?" :
                  "Write your post here and mention your peers"
                }
                rows={3}
                className="flex-1 resize-none bg-transparent text-[13px] text-slate-700 dark:text-slate-300 placeholder-slate-400 focus:outline-none"
              />
            </div>

            {content && (
              <div className="flex justify-end mt-2">
                <button onClick={submit} disabled={submitting}
                  className="h-8 px-5 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-50">
                  {submitting ? "Posting…" : feedTab === "praise" ? "Send Praise" : "Post"}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Feed */}
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-7 h-7 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : posts.length === 0 ? (
          <div className="bg-white dark:bg-[#0d1b2a] border border-slate-200 dark:border-white/[0.06] rounded-xl p-10 text-center">
            <p className="text-[14px] font-semibold text-slate-700 dark:text-slate-300">No posts yet</p>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">Be the first to post something!</p>
          </div>
        ) : (
          posts.map((post: any) => (
            <PostCard key={post.id} post={post} sessionUser={user} />
          ))
        )}
      </PageContainer>
    </PageShell>
  );
}
