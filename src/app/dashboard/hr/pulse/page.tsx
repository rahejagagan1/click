"use client";

// Weekly Pulse — employee answer page. Visible to every employee,
// reachable from the email link / in-app notification CTA / the
// "blocked clock-out" banner. Renders this week's 5 questions and
// collects all answers in a single submit.
//
// After submit, the page locks (server enforces uniqueness on
// userId + weekKey + questionId) and shows a confirmation card
// telling the user they can now clock out.

import { useEffect, useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { fetcher } from "@/lib/swr";
import { Activity, ThumbsUp, Star, Loader2, CheckCircle2, ShieldAlert, Smile, MessageSquareText } from "lucide-react";

type QType = "emoji" | "rating" | "likert" | "enps" | "text";
type Q = {
  id: number;
  order: number;
  text: string;
  type: QType;
  emojis: string[] | null;
};

type ThisWeek = {
  weekKey: string;
  activeWeek: number;
  theme: string;
  questions: Q[];
  hasSubmitted: boolean;
  submittedAt: string | null;
};

const LIKERT_LABELS = ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"];

export default function WeeklyPulseAnswerPage() {
  const { data, isLoading, mutate } = useSWR<ThisWeek>("/api/hr/pulse/this-week", fetcher);
  // Local state keyed by questionId — { score: number | null, comment: string }
  const [answers, setAnswers] = useState<Record<number, { score: number | null; comment: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);

  // Seed the answer map whenever the question list arrives.
  useEffect(() => {
    if (!data?.questions) return;
    const seeded: Record<number, { score: number | null; comment: string }> = {};
    for (const q of data.questions) {
      seeded[q.id] = { score: null, comment: "" };
    }
    setAnswers(seeded);
  }, [data?.questions]);

  // Validation: every non-text question needs a score chosen. Text
  // questions are optional — we don't gate submit on them.
  const canSubmit = useMemo(() => {
    if (!data?.questions) return false;
    return data.questions.every((q) =>
      q.type === "text" ? true : answers[q.id]?.score != null
    );
  }, [answers, data?.questions]);

  const setScore = (qid: number, score: number) =>
    setAnswers((a) => ({ ...a, [qid]: { ...a[qid], score } }));
  const setComment = (qid: number, comment: string) =>
    setAnswers((a) => ({ ...a, [qid]: { ...a[qid], comment: comment.slice(0, 500) } }));

  const submit = async () => {
    if (!data?.questions) return;
    setSubmitting(true); setError(null);
    try {
      const responses = data.questions
        .map((q) => {
          const a = answers[q.id];
          if (!a) return null;
          if (q.type === "text") {
            return { questionId: q.id, comment: a.comment || null };
          }
          return { questionId: q.id, score: a.score, comment: a.comment || null };
        })
        .filter(Boolean);
      const res = await fetch("/api/hr/pulse/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j?.error || `Submit failed (${res.status})`);
        return;
      }
      setJustSubmitted(true);
      await mutate();
      globalMutate("/api/hr/pulse/this-week");
    } catch (e: any) {
      setError(e?.message || "Submit failed");
    } finally { setSubmitting(false); }
  };

  if (isLoading || !data) {
    return (
      <div className="min-h-screen bg-[#f4f7f8] p-8">
        <div className="max-w-2xl mx-auto rounded-xl border border-slate-200 bg-white p-10 text-center">
          <Loader2 size={20} className="mx-auto animate-spin text-slate-400" />
        </div>
      </div>
    );
  }

  if (data.hasSubmitted || justSubmitted) {
    const when = data.submittedAt ? new Date(data.submittedAt).toLocaleString("en-IN") : "just now";
    return (
      <div className="min-h-screen bg-[#f4f7f8] p-6">
        <div className="max-w-2xl mx-auto">
          <header className="mb-5">
            <h1 className="text-[20px] font-semibold text-slate-900 inline-flex items-center gap-2">
              <Activity size={20} className="text-[#008CFF]" /> Weekly Pulse
            </h1>
            <p className="mt-1 text-[13px] text-slate-500">
              Week {data.activeWeek} — {data.theme}
            </p>
          </header>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
            <CheckCircle2 size={28} className="text-emerald-600 mb-2" strokeWidth={2.25} />
            <h2 className="text-[16px] font-semibold text-emerald-900">Submitted — thank you!</h2>
            <p className="mt-1.5 text-[13px] text-emerald-800">
              Your response landed at {when}. You can now clock out as usual whenever you're done for the day.
            </p>
            <p className="mt-3 text-[12px] text-emerald-700/80">
              The next pulse drops at 10:30 AM IST next Friday. See you then!
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f7f8] p-6">
      <div className="max-w-2xl mx-auto">
        <header className="mb-5">
          <h1 className="text-[20px] font-semibold text-slate-900 inline-flex items-center gap-2">
            <Activity size={20} className="text-[#008CFF]" /> Weekly Pulse
          </h1>
          <p className="mt-1 text-[13px] text-slate-500">
            Week {data.activeWeek} — {data.theme}. Takes about 30 seconds.
          </p>
        </header>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 mb-5 inline-flex items-start gap-2.5 w-full">
          <ShieldAlert size={16} className="text-amber-700 mt-0.5 shrink-0" strokeWidth={2.25} />
          <p className="text-[12.5px] text-amber-900 leading-snug">
            <strong>Clock-out is blocked</strong> until you submit. The lock lifts the moment this lands — promise.
          </p>
        </div>

        <div className="space-y-3">
          {data.questions.map((q) => (
            <QuestionCard
              key={q.id}
              q={q}
              answer={answers[q.id]}
              onScore={(s) => setScore(q.id, s)}
              onComment={(c) => setComment(q.id, c)}
            />
          ))}
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>
        )}

        <div className="mt-5 flex items-center justify-end">
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !canSubmit}
            className="h-10 px-5 rounded-lg bg-[#008CFF] hover:bg-[#0070cc] active:bg-[#005ea3] text-white text-[13px] font-semibold inline-flex items-center gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting && <Loader2 size={13} className="animate-spin" />}
            {submitting ? "Submitting…" : "Submit Pulse"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
function QuestionCard({
  q, answer, onScore, onComment,
}: {
  q: Q;
  answer?: { score: number | null; comment: string };
  onScore: (s: number) => void;
  onComment: (c: string) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-5 py-4">
      <div className="flex items-start gap-4">
        <div className="shrink-0 w-7 h-7 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[11.5px] font-bold tabular-nums mt-0.5">
          {q.order}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] text-slate-900 font-medium leading-snug">{q.text}</p>
          <p className="mt-1 text-[10.5px] uppercase tracking-[0.08em] font-semibold text-slate-400 inline-flex items-center gap-1.5">
            {q.type === "emoji"  && <><Smile size={11} className="text-slate-500" /> Pick one</>}
            {q.type === "rating" && <><Star size={11} className="text-slate-500" /> Star rating</>}
            {q.type === "likert" && <><Activity size={11} className="text-slate-500" /> Strongly Disagree → Strongly Agree</>}
            {q.type === "enps"   && <><ThumbsUp size={11} className="text-slate-500" /> 0–10 likelihood</>}
            {q.type === "text"   && <><MessageSquareText size={11} className="text-slate-500" /> Free text (optional)</>}
          </p>

          <div className="mt-3">
            {q.type === "emoji" && (
              <div className="inline-flex items-center gap-1.5 flex-wrap">
                {(q.emojis ?? ["😡", "😟", "😐", "🙂", "😄"]).map((e, idx) => {
                  const active = answer?.score === idx;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => onScore(idx)}
                      className={`h-10 w-10 rounded-md text-[20px] border transition-all ${
                        active
                          ? "bg-[#008CFF]/10 border-[#008CFF] ring-2 ring-[#008CFF]/30 scale-110"
                          : "bg-white border-slate-200 hover:border-slate-300"
                      }`}
                    >{e}</button>
                  );
                })}
              </div>
            )}

            {q.type === "rating" && (
              <div className="inline-flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => {
                  const filled = (answer?.score ?? 0) >= n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => onScore(n)}
                      className="p-1 transition-transform hover:scale-110"
                    >
                      <Star size={28} strokeWidth={1.5}
                        className={filled ? "text-amber-400 fill-amber-400" : "text-slate-300"} />
                    </button>
                  );
                })}
              </div>
            )}

            {q.type === "likert" && (
              <div className="max-w-md">
                <div className="grid grid-cols-5 gap-1.5">
                  {LIKERT_LABELS.map((label, idx) => {
                    const val = idx + 1;
                    const active = answer?.score === val;
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() => onScore(val)}
                        className={`h-14 rounded-md border text-[11px] font-semibold leading-tight px-1 transition-all flex flex-col items-center justify-center gap-0.5 ${
                          active
                            ? "bg-[#008CFF]/10 border-[#008CFF] text-[#008CFF] ring-2 ring-[#008CFF]/30"
                            : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
                        }`}
                      >
                        <span className="text-[14px] font-bold">{val}</span>
                        <span className="text-[9.5px] text-slate-500 leading-tight">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {q.type === "enps" && (
              <div>
                <div className="grid grid-cols-11 gap-1 max-w-md">
                  {Array.from({ length: 11 }).map((_, n) => {
                    const active = answer?.score === n;
                    const palette =
                      n <= 6 ? "rose"
                      : n <= 8 ? "amber"
                      : "emerald";
                    const baseColor =
                      palette === "rose"   ? (active ? "bg-rose-500 text-white border-rose-500"     : "bg-white text-rose-700 border-rose-200 hover:bg-rose-50")
                    : palette === "amber"  ? (active ? "bg-amber-500 text-white border-amber-500"   : "bg-white text-amber-700 border-amber-200 hover:bg-amber-50")
                    :                        (active ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50");
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => onScore(n)}
                        className={`h-9 rounded-md text-[12px] font-bold border transition-all ${baseColor} ${active ? "ring-2 ring-offset-1 ring-current/30 scale-105" : ""}`}
                      >{n}</button>
                    );
                  })}
                </div>
                <div className="mt-1.5 max-w-md flex items-center justify-between text-[10.5px] text-slate-400">
                  <span>Not at all likely</span>
                  <span>Extremely likely</span>
                </div>
              </div>
            )}

            {q.type === "text" && (
              <textarea
                value={answer?.comment ?? ""}
                onChange={(e) => onComment(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Optional — share what's on your mind"
                className="w-full max-w-md px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:border-[#008CFF] resize-none"
              />
            )}
          </div>

          {/* Optional comment box on non-text questions — collapsed by
              default so the answer flow stays fast; users can expand
              if they want to add context. */}
          {q.type !== "text" && (
            <details className="mt-2.5">
              <summary className="text-[11.5px] font-semibold text-slate-500 hover:text-slate-700 cursor-pointer select-none">
                + Add a note (optional)
              </summary>
              <textarea
                value={answer?.comment ?? ""}
                onChange={(e) => onComment(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="What's behind this answer? (kept anonymous in aggregate reports)"
                className="mt-2 w-full max-w-md px-3 py-2 border border-slate-200 rounded-lg text-[12.5px] bg-white focus:outline-none focus:border-[#008CFF] resize-none"
              />
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
