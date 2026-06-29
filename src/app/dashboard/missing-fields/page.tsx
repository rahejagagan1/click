"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ClipboardList } from "lucide-react";

// Missing Fields — developer-only console (sidebar item is gated with
// `developerOnly: true`; this page guard mirrors that exact gate so the two
// never drift). Landing scaffold for now — the actual "which employees have
// incomplete profile data" report gets built on top of this shell.
export default function MissingFieldsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const isDeveloper = (session?.user as any)?.isDeveloper === true;

  // Same gate as the sidebar entry: developers only. Anyone else is bounced
  // back to the dashboard (so a hand-typed URL can't reach it either).
  useEffect(() => {
    if (status === "loading") return;
    if (!isDeveloper) router.replace("/dashboard");
  }, [status, isDeveloper, router]);

  // Don't flash the page while the session resolves / for non-developers.
  if (status === "loading" || !isDeveloper) return null;

  return (
    <div className="min-h-screen bg-[#f4f7fb]">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
          {/* Header band */}
          <header className="flex items-center justify-between gap-4 border-b border-slate-100 bg-gradient-to-b from-[#fbfdff] to-white px-6 py-5">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e8f1fc] text-[#0f4e93] ring-1 ring-inset ring-[#cfdef5]">
                <ClipboardList className="h-5 w-5" />
              </span>
              <div>
                <h1 className="text-[18px] font-semibold leading-tight text-slate-800">Missing Fields</h1>
                <p className="mt-0.5 text-[12.5px] text-slate-500">
                  Employee records with incomplete profile data.
                </p>
              </div>
            </div>
            <span className="hidden md:inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200">
              Developers only
            </span>
          </header>

          {/* Body — placeholder until the report is wired up */}
          <div className="px-6 py-16 text-center">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e8f1fc] text-[#0f4e93] ring-1 ring-inset ring-[#cfdef5]">
              <ClipboardList className="h-6 w-6" />
            </span>
            <h2 className="text-[15px] font-semibold text-slate-800">Nothing here yet</h2>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-slate-500">
              This is the starting point for the Missing Fields report. Tell me which
              fields to check (e.g. PAN, bank account, emergency contact) and I'll
              build the list of employees who are missing them.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
