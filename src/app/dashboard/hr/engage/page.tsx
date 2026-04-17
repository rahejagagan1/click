"use client";
import { useState, useRef } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import { ThumbsUp, MessageSquare, Send, BarChart2, Award, MoreHorizontal, X, ChevronDown } from "lucide-react";
import Link from "next/link";

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

function PostCard({ post, sessionUserId }: { post: any; sessionUserId: number }) {
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [localReacted, setLocalReacted] = useState(
    post.reactions.some((r: any) => r.userId === sessionUserId)
  );
  const [reactionCount, setReactionCount] = useState(post.reactions.length);

  const react = async () => {
    setLocalReacted(p => !p);
    setReactionCount((c: number) => localReacted ? c - 1 : c + 1);
    await fetch(`/api/hr/engage/posts/${post.id}/react`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    mutate("/api/hr/engage/posts");
  };

  const submitComment = async () => {
    if (!commentText.trim()) return;
    await fetch(`/api/hr/engage/posts/${post.id}/comments`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: commentText }),
    });
    setCommentText("");
    mutate("/api/hr/engage/posts");
  };

  const isPraise = post.type === "praise";

  return (
    <div className="bg-white dark:bg-[#0d1b2a] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
      {isPraise && (
        <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/5 border-b border-amber-200/50 dark:border-amber-500/20 px-5 py-2 flex items-center gap-2">
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
          <button className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>

        <p className="mt-3 text-[14px] text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{post.content}</p>

        {post.mediaUrl && (
          <img src={post.mediaUrl} alt="media"
            className="mt-3 rounded-xl max-w-full max-h-[400px] object-contain border border-slate-100 dark:border-white/5" />
        )}
      </div>

      {/* Reactions bar */}
      <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-100 dark:border-white/[0.04]">
        <div className="flex items-center gap-1 text-[12px] text-slate-500 dark:text-slate-400">
          {reactionCount > 0 && <span>👍 {reactionCount} {reactionCount === 1 ? "reaction" : "reactions"}</span>}
          {post.comments.length > 0 && <span className="ml-3">• {post.comments.length} {post.comments.length === 1 ? "comment" : "comments"}</span>}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center border-t border-slate-100 dark:border-white/[0.04]">
        <button onClick={react}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-[12px] font-medium hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors ${
            localReacted ? "text-[#008CFF]" : "text-slate-500 dark:text-slate-400"
          }`}>
          <ThumbsUp className="w-4 h-4" />Like
        </button>
        <button onClick={() => setShowComments(p => !p)}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 text-[12px] font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors border-l border-slate-100 dark:border-white/[0.04]">
          <MessageSquare className="w-4 h-4" />Comment
        </button>
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
    </div>
  );
}

export default function EngagePage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const sessionUserId = user?.dbId;

  const { data: posts = [], isLoading } = useSWR("/api/hr/engage/posts", fetcher);
  const { data: employees = [] } = useSWR("/api/hr/employees", fetcher);

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
    <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">

      {/* Header */}
      <div className="bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-6 py-4">
        <h1 className="text-[15px] font-bold text-slate-800 dark:text-white">Engage</h1>
        <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">Connect with your team — post updates, polls, and appreciation</p>
      </div>

      <div className="max-w-3xl mx-auto p-5 space-y-4">

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
              <select value={praiseToId} onChange={e => setPraiseToId(e.target.value)}
                className="w-full mb-3 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-slate-700 dark:text-slate-300">
                <option value="">Select someone to praise…</option>
                {employees.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
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
            <PostCard key={post.id} post={post} sessionUserId={sessionUserId} />
          ))
        )}
      </div>
    </div>
  );
}
