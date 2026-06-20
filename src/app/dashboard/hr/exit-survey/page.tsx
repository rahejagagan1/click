"use client";

// Employee-facing Exit Survey. Shown to leaving employees (filed exit,
// last working day within the window). Must be submitted before they can
// clock out — the clock-out route enforces that; this is where they do it.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Check, ClipboardList, ArrowLeft } from "lucide-react";
import { EXIT_SURVEY, ALL_EXIT_QUESTIONS, validateExitResponses, type ExitQuestion } from "@/lib/hr/exit-survey-spec";

type Answers = Record<string, string | number>;

function RatingRow({ max, value, onChange }: { max: number; value: number | undefined; onChange: (n: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`h-8 w-8 rounded-lg text-[12.5px] font-semibold ring-1 transition-colors ${
            value === n
              ? "bg-[#008CFF] text-white ring-[#008CFF]"
              : "bg-white text-slate-600 ring-slate-200 hover:ring-[#008CFF]/40 hover:text-slate-800"
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function Choice({ options, value, onChange }: { options: string[]; value: string | undefined; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium ring-1 transition-colors ${
            value === o
              ? "bg-[#008CFF] text-white ring-[#008CFF]"
              : "bg-white text-slate-600 ring-slate-200 hover:ring-[#008CFF]/40 hover:text-slate-800"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export default function ExitSurveyPage() {
  const [loading, setLoading] = useState(true);
  const [inWindow, setInWindow] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [lastWorkingDay, setLastWorkingDay] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/hr/exit-survey");
        const j = await r.json().catch(() => ({}));
        setInWindow(!!j.inWindow);
        setSubmitted(!!j.submitted);
        setLastWorkingDay(j.lastWorkingDay ?? null);
        if (j.answers && typeof j.answers === "object") setAnswers(j.answers);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = (id: string, v: string | number) => setAnswers((a) => ({ ...a, [id]: v }));
  const visible = (q: ExitQuestion) => !q.showIf || String(answers[q.showIf.id] ?? "") === q.showIf.equals;
  const valid = useMemo(() => validateExitResponses(answers).ok, [answers]);

  const submit = async () => {
    const v = validateExitResponses(answers);
    if (!v.ok) { setError(v.error); return; }
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/hr/exit-survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j?.error || `Submit failed (${r.status})`); return; }
      setSubmitted(true); setJustSubmitted(true);
    } catch (e: any) {
      setError(e?.message || "Submit failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center text-slate-400"><Loader2 className="animate-spin" /></div>;
  }

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-[#f4f7fb]">
      <div className="mx-auto max-w-3xl px-6 py-8">{children}</div>
    </div>
  );

  if (!inWindow) {
    return (
      <Shell>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <ClipboardList className="mx-auto mb-3 h-8 w-8 text-slate-300" />
          <h1 className="text-[16px] font-semibold text-slate-800">No exit survey pending</h1>
          <p className="mt-1 text-[13px] text-slate-500">You don&apos;t have an exit survey to fill right now.</p>
          <Link href="/dashboard/hr/home" className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#008CFF] hover:underline"><ArrowLeft size={14} /> Back to dashboard</Link>
        </div>
      </Shell>
    );
  }

  if (submitted) {
    return (
      <Shell>
        <div className="rounded-2xl border border-emerald-200 bg-white p-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><Check size={24} /></div>
          <h1 className="text-[16px] font-semibold text-slate-800">Thank you — exit survey submitted</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            {justSubmitted ? "Your feedback has been shared with HR. You can now clock out." : "You've already completed your exit survey."}
          </p>
          <Link href="/dashboard/hr/home" className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#008CFF] hover:underline"><ArrowLeft size={14} /> Back to dashboard</Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-5">
        <h1 className="text-[19px] font-semibold text-slate-800">Exit Survey</h1>
        <p className="mt-1 text-[13px] text-slate-500">
          Your honest feedback helps us improve. This is required before your last working day
          {lastWorkingDay ? <> (<strong className="text-slate-700">{new Date(lastWorkingDay).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</strong>)</> : null}.
        </p>
      </div>

      <div className="space-y-5">
        {EXIT_SURVEY.map((section) => (
          <section key={section.title} className="rounded-2xl border border-slate-200 bg-white">
            <header className="border-b border-slate-100 px-5 py-3.5">
              <h2 className="text-[14px] font-semibold text-slate-800">{section.title}</h2>
              {section.description && <p className="mt-0.5 text-[11.5px] text-slate-500">{section.description}</p>}
            </header>
            <div className="divide-y divide-slate-50">
              {section.questions.filter(visible).map((q) => (
                <div key={q.id} className="px-5 py-3.5">
                  <label className="mb-2 block text-[13px] font-medium text-slate-700">
                    {q.label}{q.required && <span className="ml-0.5 text-rose-500">*</span>}
                  </label>
                  {q.type === "rating5"     && <RatingRow max={5}  value={answers[q.id] as number} onChange={(n) => set(q.id, n)} />}
                  {q.type === "rating10"    && <RatingRow max={10} value={answers[q.id] as number} onChange={(n) => set(q.id, n)} />}
                  {q.type === "single"      && <Choice options={q.options || []} value={answers[q.id] as string} onChange={(v) => set(q.id, v)} />}
                  {q.type === "yesno"       && <Choice options={["Yes", "No"]} value={answers[q.id] as string} onChange={(v) => set(q.id, v)} />}
                  {q.type === "yesnomaybe"  && <Choice options={["Yes", "No", "Maybe"]} value={answers[q.id] as string} onChange={(v) => set(q.id, v)} />}
                  {q.type === "text"        && (
                    <textarea
                      value={(answers[q.id] as string) || ""}
                      onChange={(e) => set(q.id, e.target.value)}
                      rows={2}
                      className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:border-[#008CFF]/50 focus:outline-none focus:ring-2 focus:ring-[#008CFF]/15"
                      placeholder="Your answer…"
                    />
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {error && <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</div>}

      <div className="sticky bottom-0 mt-5 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 px-5 py-3.5 backdrop-blur">
        <p className="text-[11.5px] text-slate-500">{valid ? "All required questions answered." : "Please answer all required (*) questions."}</p>
        <button
          onClick={submit}
          disabled={busy || !valid}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#008CFF] px-5 text-[13.5px] font-semibold text-white hover:bg-[#0070cc] disabled:opacity-60"
        >
          {busy ? <><Loader2 size={15} className="animate-spin" /> Submitting…</> : "Submit exit survey"}
        </button>
      </div>
    </Shell>
  );
}
