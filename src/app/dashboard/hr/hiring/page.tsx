"use client";

// HR Hiring console — Keka-style redesign.
//
// Five top-level tabs:
//   1. Jobs        — list of openings → click into kanban pipeline
//   2. Candidates  — cross-job table of all applicants
//   3. Talent Pool — rated past candidates worth reaching out to
//   4. Settings    — email templates + pipeline stages + form fields
//   5. Reports     — funnel, time-to-hire, source breakdown
//
// Each tab is its own component under src/components/hr/hiring/*
// so this file stays small and the tabs can be iterated
// independently. Drag-and-drop on the kanban uses native HTML5 DnD
// — no new dependency added.

import { useState } from "react";
import { useSession } from "next-auth/react";
import { isHRAdmin } from "@/lib/access";
import { Briefcase, Users, Bookmark, Settings, BarChart3, LayoutDashboard, UserPlus } from "lucide-react";

import DashboardTab    from "@/components/hr/hiring/DashboardTab";
import JobsTab         from "@/components/hr/hiring/JobsTab";
import CandidatesTab   from "@/components/hr/hiring/CandidatesTab";
import TalentPoolTab   from "@/components/hr/hiring/TalentPoolTab";
import PreboardingTab  from "@/components/hr/hiring/PreboardingTab";
import SettingsTab     from "@/components/hr/hiring/SettingsTab";
import ReportsTab      from "@/components/hr/hiring/ReportsTab";

type TabKey = "dashboard" | "jobs" | "candidates" | "talent" | "preboarding" | "settings" | "reports";

const TABS: { key: TabKey; label: string; Icon: any }[] = [
  { key: "dashboard",   label: "Dashboard",    Icon: LayoutDashboard },
  { key: "jobs",        label: "Jobs",         Icon: Briefcase       },
  { key: "candidates",  label: "Candidates",   Icon: Users           },
  { key: "talent",      label: "Talent Pool",  Icon: Bookmark        },
  { key: "preboarding", label: "Preboarding",  Icon: UserPlus        },
  { key: "settings",    label: "Settings",     Icon: Settings        },
  { key: "reports",     label: "Reports",      Icon: BarChart3       },
];

export default function HiringPage() {
  const { data: session } = useSession();
  const me = session?.user as any;
  const canManage = isHRAdmin(me);
  const [tab, setTab] = useState<TabKey>("dashboard");

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
          const active = tab === key;
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
            </button>
          );
        })}
      </div>

      {/* Active tab content */}
      {tab === "dashboard"   && <DashboardTab />}
      {tab === "jobs"        && <JobsTab />}
      {tab === "candidates"  && <CandidatesTab />}
      {tab === "talent"      && <TalentPoolTab />}
      {tab === "preboarding" && <PreboardingTab />}
      {tab === "settings"    && <SettingsTab />}
      {tab === "reports"     && <ReportsTab />}
    </div>
  );
}
