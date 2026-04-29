"use client";

// First-login wizard. Anyone with onboardingPending=true on their User row
// is bounced here by LayoutShell until they complete this minimal form.
// Keeps the surface area tiny on purpose — phone, address, emergency
// contact. Anything more elaborate lives in /dashboard/hr/profile.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { CheckCircle2 } from "lucide-react";

const inputCls =
  "w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#008CFF]/60";
const labelCls =
  "block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5";

export default function OnboardingPage() {
  const router = useRouter();
  const { data: session, status, update } = useSession();
  const [form, setForm] = useState({
    phone: "",
    address: "",
    city: "",
    state: "",
    emergencyContact: "",
    emergencyPhone: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Once their flag is cleared (e.g. they finished and we re-rendered),
  // bounce them onward. Belt-and-braces in case the redirect-after-submit
  // didn't take.
  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    } else if (
      status === "authenticated" &&
      (session?.user as any)?.onboardingPending === false
    ) {
      router.replace("/dashboard/hr/home");
    }
  }, [status, session, router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not save onboarding");
      // Refresh the session so the new onboardingPending=false reaches the guard.
      await update();
      router.replace("/dashboard/hr/home");
    } catch (e: any) {
      setError(e?.message || "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f1f5f9] flex items-start justify-center py-10 px-4">
      <div className="w-full max-w-2xl">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="bg-[#0f6ecd] text-white px-7 py-5">
            <p className="text-[11px] uppercase tracking-[0.18em] opacity-80">
              NB Media · First-time setup
            </p>
            <h1 className="text-[20px] font-semibold mt-1">
              Welcome{session?.user?.name ? `, ${session.user.name.split(" ")[0]}` : ""}!
            </h1>
            <p className="text-[13px] opacity-90 mt-1.5">
              Just a couple of details before you head into the dashboard.
              You can always edit these later in your profile.
            </p>
          </div>

          <form onSubmit={onSubmit} className="px-7 py-6 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="sm:col-span-1">
                <label className={labelCls}>Mobile number</label>
                <input
                  className={inputCls}
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="+91 98xxxxxxxx"
                  type="tel"
                  required
                />
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <label className={labelCls}>Address</label>
                <input
                  className={inputCls}
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                  placeholder="House / street"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className={labelCls}>City</label>
                  <input
                    className={inputCls}
                    value={form.city}
                    onChange={(e) => set("city", e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelCls}>State</label>
                  <input
                    className={inputCls}
                    value={form.state}
                    onChange={(e) => set("state", e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200">
              <p className="text-[12.5px] font-semibold text-slate-700 mb-3 mt-4">
                Emergency contact
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className={labelCls}>Contact name</label>
                  <input
                    className={inputCls}
                    value={form.emergencyContact}
                    onChange={(e) => set("emergencyContact", e.target.value)}
                    placeholder="Parent / spouse / sibling"
                  />
                </div>
                <div>
                  <label className={labelCls}>Contact number</label>
                  <input
                    className={inputCls}
                    value={form.emergencyPhone}
                    onChange={(e) => set("emergencyPhone", e.target.value)}
                    placeholder="+91 98xxxxxxxx"
                    type="tel"
                  />
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-[12.5px] px-3 py-2 rounded-lg">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 bg-[#0f6ecd] hover:bg-[#0a5fb3] disabled:opacity-60 disabled:cursor-not-allowed text-white text-[13px] font-semibold px-5 h-10 rounded-lg transition-colors"
              >
                <CheckCircle2 className="h-4 w-4" />
                {saving ? "Saving…" : "Finish & open dashboard"}
              </button>
            </div>
          </form>
        </div>

        <p className="text-center mt-4 text-[11px] text-slate-400">
          Need help? Reach out to HR — we'll fix it up for you.
        </p>
      </div>
    </div>
  );
}
