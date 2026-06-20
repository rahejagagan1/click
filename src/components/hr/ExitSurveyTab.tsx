"use client";

// HR view of an employee's submitted Exit Survey. Used on the profile
// "Exit Survey" tab AND inside the offboard drawer's Survey tab. Compact,
// read-only, and laid out by the same sections the employee filled.

import useSWR from "swr";
import { ClipboardList, Loader2, Star } from "lucide-react";
import { EXIT_SURVEY, type ExitQuestion } from "@/lib/hr/exit-survey-spec";

const fetcher = (u: string) => fetch(u).then((r) => r.json());

function fmtDate(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00Z` : d);
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={14} className={n <= value ? "fill-amber-400 text-amber-400" : "text-slate-200"} />
      ))}
    </span>
  );
}

function AnswerValue({ q, value }: { q: ExitQuestion; value: any }) {
  if (q.type === "rating5") return <Stars value={Number(value)} />;
  if (q.type === "rating10") {
    return (
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11.5px] font-bold text-amber-700 ring-1 ring-amber-200">
        {Number(value)}/10
      </span>
    );
  }
  return <span className="text-[12.5px] font-medium text-slate-800">{String(value)}</span>;
}

export default function ExitSurveyTab({ userId }: { userId: number }) {
  const { data, isLoading } = useSWR<{ view: any }>(`/api/hr/exit-survey?userId=${userId}`, fetcher);
  const view = data?.view ?? null;

  if (isLoading) {
    return <div className="flex items-center gap-2 py-8 text-slate-400"><Loader2 className="animate-spin" size={16} /> Loading…</div>;
  }

  if (!view) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-5 py-8 text-center">
        <ClipboardList className="mx-auto mb-2 h-6 w-6 text-slate-300" />
        <p className="text-[12.5px] font-medium text-slate-600">No exit on record</p>
        <p className="mt-0.5 text-[11.5px] text-slate-400">This employee doesn&apos;t have a filed exit.</p>
      </div>
    );
  }

  const answers: Record<string, any> | null = view.answers;
  const submitted = !!view.submittedAt;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600"><ClipboardList size={16} /></span>
            <div>
              <p className="text-[13px] font-semibold text-slate-800">Employee Exit Survey</p>
              <p className="text-[11.5px] text-slate-500">
                Last working day <span className="font-medium text-slate-700">{fmtDate(view.lastWorkingDay)}</span>
                {view.exitType ? <> · {String(view.exitType).replace(/_/g, " ")}</> : null}
              </p>
            </div>
          </div>
          {submitted ? (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
              Submitted {fmtDate(view.submittedAt)}
            </span>
          ) : (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
              Awaiting submission
            </span>
          )}
        </div>
        {/* Inline awaiting state — no giant empty box. */}
        {!answers && (
          <div className="border-t border-slate-100 px-4 py-3 text-[11.5px] text-slate-400">
            Responses will appear here once the employee submits their exit survey.
          </div>
        )}
      </div>

      {/* Answers, grouped by section */}
      {answers && EXIT_SURVEY.map((section) => {
        const rows = section.questions.filter((q) => {
          const v = answers[q.id];
          return v !== undefined && v !== null && String(v).trim() !== "";
        });
        if (rows.length === 0) return null;
        return (
          <section key={section.title} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <header className="border-b border-slate-100 bg-slate-50/60 px-4 py-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{section.title}</h3>
            </header>
            <div className="divide-y divide-slate-50">
              {rows.map((q) => {
                const v = answers[q.id];
                const isText = q.type === "text";
                return isText ? (
                  <div key={q.id} className="px-4 py-3">
                    <p className="text-[11.5px] text-slate-500">{q.label}</p>
                    <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-800">{String(v)}</p>
                  </div>
                ) : (
                  <div key={q.id} className="flex items-center justify-between gap-4 px-4 py-2.5">
                    <p className="text-[12px] text-slate-500">{q.label}</p>
                    <div className="shrink-0"><AnswerValue q={q} value={v} /></div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
