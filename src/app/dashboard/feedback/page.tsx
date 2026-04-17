"use client";

import { useState } from "react";

const CATEGORIES = [
    { value: "general_issue", label: "General issue" },
    { value: "attendance_issue", label: "Attendance issue" },
    { value: "policy_issue", label: "Policy issue" },
    { value: "finance_issue", label: "Finance issue" },
    { value: "salary_issue", label: "Salary issue" },
    { value: "feature_requested", label: "Feature requested" },
    { value: "others", label: "Others" },
] as const;

export default function FeedbackPage() {
    const [category, setCategory] = useState<string>("general_issue");
    const [message, setMessage] = useState("");
    const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setStatus("sending");
        try {
            const res = await fetch("/api/feedback", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ category, message }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error || "Could not send feedback");
                setStatus("error");
                return;
            }
            setStatus("done");
            setMessage("");
        } catch {
            setError("Network error — try again");
            setStatus("error");
        }
    };

    return (
        <div className="w-full flex flex-col items-center py-5 md:py-9 px-2 sm:px-6">
            <div className="w-full max-w-2xl text-center mb-7 space-y-3">
                <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white mb-2">
                    Anonymous feedback
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl mx-auto leading-relaxed">
                On Honesty day be Honest. This form is <span className="text-slate-700 dark:text-slate-300 font-medium">fully anonymous</span>, your
                    name is not shown with what you write. Feel free to share anything on your mind: processes, policies,
                    ideas, or concerns involving anyone at the company. Be honest; we read every submission confidentially.
                </p>
            </div>

            {status === "done" ? (
                <div className="w-full max-w-2xl rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-sm md:text-base text-emerald-800 dark:text-emerald-200 text-center">
                    Thank you — your anonymous feedback was submitted.
                </div>
            ) : (
                <form
                    onSubmit={submit}
                    className="w-full max-w-2xl space-y-5 md:space-y-6 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#12122a] p-6 md:p-8 lg:p-9 shadow-sm"
                >
                    <div>
                        <label htmlFor="fb-category" className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5 md:mb-2">
                            Category
                        </label>
                        <select
                            id="fb-category"
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            className="w-full px-3.5 py-3 md:py-3.5 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-sm md:text-base focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                        >
                            {CATEGORIES.map((c) => (
                                <option key={c.value} value={c.value}>
                                    {c.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="fb-message" className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5 md:mb-2">
                            Message
                        </label>
                        <textarea
                            id="fb-message"
                            required
                            rows={8}
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            placeholder="Your feedback…"
                            maxLength={8000}
                            className="w-full px-3.5 py-3 md:px-4 md:py-4 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-sm md:text-base leading-relaxed placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40 resize-y min-h-[200px] md:min-h-[240px]"
                        />
                        <p className="text-xs text-slate-400 mt-2">{message.length} / 8000</p>
                    </div>
                    {error && (
                        <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
                            {error}
                        </p>
                    )}
                    <div className="flex justify-center pt-1">
                        <button
                            type="submit"
                            disabled={status === "sending" || !message.trim()}
                            className="w-full sm:w-auto min-w-[200px] px-8 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-sm md:text-base font-medium transition-all disabled:opacity-50 disabled:pointer-events-none"
                        >
                            {status === "sending" ? "Sending…" : "Submit feedback"}
                        </button>
                    </div>
                </form>
            )}

        </div>
    );
}
