"use client";

// HR Hiring console — Keka-style redesign.
//
// Top-level tabs:
//   1. Jobs        — list of openings → click into kanban pipeline
//   2. Candidates  — cross-job table of all applicants
//   3. Settings    — email templates + pipeline stages + form fields
//   4. Reports     — funnel, time-to-hire, source breakdown
//
// Each tab is its own component under src/components/hr/hiring/*
// so this file stays small and the tabs can be iterated
// independently. Drag-and-drop on the kanban uses native HTML5 DnD
// — no new dependency added.

import { useEffect, useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import { isHRAdmin } from "@/lib/access";
import { Briefcase, Users, Settings, BarChart3, LayoutDashboard, UserPlus } from "lucide-react";

import DashboardTab    from "@/components/hr/hiring/DashboardTab";
import JobsTab         from "@/components/hr/hiring/JobsTab";
import CandidatesTab   from "@/components/hr/hiring/CandidatesTab";
import PreboardingTab  from "@/components/hr/hiring/PreboardingTab";
import SettingsTab     from "@/components/hr/hiring/SettingsTab";
import ReportsTab      from "@/components/hr/hiring/ReportsTab";

type TabKey = "dashboard" | "jobs" | "candidates" | "preboarding" | "settings" | "reports";

const TABS: { key: TabKey; label: string; Icon: any }[] = [
  { key: "dashboard",   label: "Dashboard",    Icon: LayoutDashboard },
  { key: "jobs",        label: "Jobs",         Icon: Briefcase       },
  { key: "candidates",  label: "Candidates",   Icon: Users           },
  { key: "preboarding", label: "Preboarding",  Icon: UserPlus        },
  { key: "settings",    label: "Settings",     Icon: Settings        },
  { key: "reports",     label: "Reports",      Icon: BarChart3       },
];

export default function HiringPage() {
  const { data: session } = useSession();
  const me = session?.user as any;
  const canManage = isHRAdmin(me);
  const [tab, setTab] = useState<TabKey>("dashboard");

  // Per-tab unread-notification badge. `typedCount` = the number of
  // unread "job_application" notifications for the current viewer.
  // Refetched every 30s. The Candidates tab badge clears as soon as
  // anyone opens this tab (PATCH read_by_type) — drives a fresh
  // SWR re-fetch.
  const NOTIF_COUNT_KEY = "/api/hr/notifications?type=job_application&countOnly=1";
  const { data: notifCount } = useSWR<{ typedCount: number }>(
    canManage ? NOTIF_COUNT_KEY : null,
    fetcher,
    { refreshInterval: 30_000, revalidateOnFocus: true },
  );
  const candidateBadge = notifCount?.typedCount ?? 0;

  // When the viewer lands on the Candidates tab, mark every unread
  // job_application notification as read for them. Per-user — viewing
  // the tab as one HR doesn't clear it for another HR.
  useEffect(() => {
    if (!canManage)            return;
    if (tab !== "candidates")  return;
    if (candidateBadge === 0)  return;
    (async () => {
      try {
        await fetch("/api/hr/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "read_by_type", type: "job_application" }),
        });
        mutate(NOTIF_COUNT_KEY);
        // Bust the NotificationBell cache too so the global unread
        // count drops in lockstep with the tab badge.
        mutate((k) => typeof k === "string" && k.startsWith("/api/hr/notifications"));
      } catch { /* non-fatal */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, candidateBadge, canManage]);

  if (!canManage) {
    return (
      <div className="px-6 py-12 text-center text-slate-500 text-[14px]">
        You don't have access to the Hiring console.
      </div>
    );
  }

  return (
    <div className="px-6 py-6 max-w-[1400px]">
      {/* Header */}
      <header className="mb-5">
        <h1 className="text-[20px] font-bold text-slate-800 inline-flex items-center gap-2">
          <Briefcase size={20} className="text-[#008CFF]" /> Hiring
        </h1>
        <p className="mt-1 text-[12.5px] text-slate-500">
          Manage job openings, candidate pipelines, interviews, offers, and email automation — all in one console.
        </p>
      </header>

      {/* Tab strip — fixed (non-scrolling). Tabs auto-fit on every
          viewport size we care about; if you ever add more tabs and
          they collide on narrow screens, switch to flex-wrap rather
          than re-enabling overflow-x-auto so the bar stays single-row
          on common widths but wraps cleanly below 600px. */}
      <div className="mb-5 flex gap-0 border-b border-slate-200">
        {TABS.map(({ key, label, Icon }) => {
          const active   = tab === key;
          const badgeN   = key === "candidates" ? candidateBadge : 0;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-[12.5px] font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${
                active
                  ? "border-[#008CFF] text-[#008CFF]"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Icon size={14} />
              {label}
              {badgeN > 0 && (
                <span
                  className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold tabular-nums leading-none ${
                    active ? "bg-[#008CFF] text-white" : "bg-[#008CFF]/15 text-[#008CFF]"
                  }`}
                  aria-label={`${badgeN} new applicants`}
                >
                  {badgeN > 99 ? "99+" : badgeN}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active tab content */}
      {tab === "dashboard"   && <DashboardTab />}
      {tab === "jobs"        && <JobsTab />}
      {tab === "candidates"  && <CandidatesTab />}
      {tab === "preboarding" && <PreboardingTab />}
      {tab === "settings"    && <SettingsTab />}
      {tab === "reports"     && <ReportsTab />}
    </div>
  );
}
