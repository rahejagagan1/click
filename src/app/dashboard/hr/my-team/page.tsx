"use client";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Clock, TreePine, Target, CheckCircle2, AlertCircle, AlertTriangle } from "lucide-react";
import { getUserRoleLabel } from "@/lib/user-role-options";

const C = {
  card:    "bg-white dark:bg-[#101c2e] border border-[#e2e8f0] dark:border-[rgba(255,255,255,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.07)] dark:shadow-none rounded-2xl",
  t1:      "text-[#1e293b] dark:text-[#e2e8f0]",
  t2:      "text-[#475569] dark:text-[#8892a4]",
  t3:      "text-[#94a3b8] dark:text-[#64748b]",
  divider: "border-[#e2e8f0] dark:border-[rgba(255,255,255,0.06)]",
};

const TOP_TABS = [
  { key: "home",    label: "HOME",    href: "/dashboard/hr/analytics"  },
  { key: "myteam",  label: "MY TEAM", href: "/dashboard/hr/my-team"    },
];

function statusColor(s: string) {
  if (s === "present") return "bg-emerald-500";
  if (s === "late")    return "bg-amber-500";
  if (s === "on_leave")return "bg-violet-500";
  return "bg-slate-300 dark:bg-slate-600";
}
function statusLabel(s: string) {
  if (s === "present")  return "Present";
  if (s === "late")     return "Late";
  if (s === "on_leave") return "On Leave";
  if (s === "absent")   return "Absent";
  return "—";
}
function goalColor(s: string) {
  if (s === "on_track") return "text-emerald-500";
  if (s === "at_risk")  return "text-amber-500";
  if (s === "behind")   return "text-red-500";
  return "text-slate-400";
}

export default function MyTeamPage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const { data: members = [], isLoading } = useSWR("/api/hr/my-team", fetcher);

  return (
    <div className="min-h-screen bg-[#f1f5f9] dark:bg-[#0b1220]">
      {/* Top tabs */}
      <div className="flex items-center gap-0 bg-white dark:bg-[#0d1b2e] border-b border-[#e2e8f0] dark:border-[rgba(255,255,255,0.06)] px-6">
        {TOP_TABS.map(t => (
          <Link key={t.key} href={t.href}
            className={`px-5 py-3 text-[11px] font-bold tracking-wider transition-colors border-b-2 ${
              t.key === "myteam"
                ? "border-[#008CFF] text-[#008CFF]"
                : `border-transparent ${C.t2} hover:${C.t1}`
            }`}>
            {t.label}
          </Link>
        ))}
      </div>

      <div className="px-6 py-5">
        {/* Header */}
        <div className="mb-5">
          <h1 className={`text-[17px] font-semibold ${C.t1} tracking-tight`}>My Team</h1>
          <p className={`text-[12px] ${C.t3} mt-0.5`}>{members.length} direct report{members.length !== 1 ? "s" : ""}</p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin"/>
          </div>
        ) : members.length === 0 ? (
          <div className={`${C.card} p-10 text-center`}>
            <p className={`text-[14px] ${C.t2}`}>No direct reports found.</p>
            <p className={`text-[12px] ${C.t3} mt-1`}>Team members are assigned via the People directory.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {members.map((m: any) => {
              const todayAtt  = m.attendances?.[0];
              const attStatus = todayAtt?.status || "absent";
              const pendingLeaves = m.leaveApplications?.length || 0;

              return (
                <div key={m.id} className={`${C.card} p-5`}>
                  <div className="flex items-start gap-4">
                    {/* Avatar */}
                    <div className="relative shrink-0">
                      {m.profilePictureUrl ? (
                        <img src={m.profilePictureUrl} alt={m.name}
                          className="w-12 h-12 rounded-full object-cover ring-2 ring-white dark:ring-[#101c2e]"/>
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-[#008CFF]/20 flex items-center justify-center text-[#008CFF] font-bold text-[15px] ring-2 ring-white dark:ring-[#101c2e]">
                          {m.name.split(" ").map((p: string) => p[0]).join("").slice(0,2).toUpperCase()}
                        </div>
                      )}
                      <span className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full ring-2 ring-white dark:ring-[#101c2e] ${statusColor(attStatus)}`}/>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className={`text-[14px] font-semibold ${C.t1}`}>{m.name}</p>
                          <p className={`text-[12px] ${C.t3} mt-0.5`}>
                            {m.employeeProfile?.designation || getUserRoleLabel(m.role) || "—"}
                            {m.employeeProfile?.department ? ` · ${m.employeeProfile.department}` : ""}
                          </p>
                        </div>
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                          attStatus === "present"  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" :
                          attStatus === "late"     ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"      :
                          attStatus === "on_leave" ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"   :
                          "bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400"
                        }`}>
                          {statusLabel(attStatus)}
                        </span>
                      </div>

                      {/* Three columns: Attendance | Leaves | Goals */}
                      <div className={`grid grid-cols-3 gap-4 mt-4 pt-4 border-t ${C.divider}`}>

                        {/* Attendance */}
                        <div>
                          <p className={`text-[10px] font-semibold uppercase tracking-wider ${C.t3} mb-2 flex items-center gap-1`}>
                            <Clock className="w-3 h-3"/> Today
                          </p>
                          {todayAtt?.clockIn ? (
                            <div className="space-y-0.5">
                              <p className={`text-[12px] ${C.t2}`}>
                                In: <span className={`font-medium ${C.t1}`}>
                                  {new Date(todayAtt.clockIn).toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit" })}
                                </span>
                              </p>
                              {todayAtt.clockOut && (
                                <p className={`text-[12px] ${C.t2}`}>
                                  Out: <span className={`font-medium ${C.t1}`}>
                                    {new Date(todayAtt.clockOut).toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit" })}
                                  </span>
                                </p>
                              )}
                              <p className={`text-[11px] ${C.t3}`}>
                                {todayAtt.totalMinutes ? `${Math.floor(todayAtt.totalMinutes/60)}h ${todayAtt.totalMinutes%60}m` : "—"}
                              </p>
                            </div>
                          ) : (
                            <p className={`text-[12px] ${C.t3}`}>Not checked in</p>
                          )}
                        </div>

                        {/* Pending Leaves */}
                        <div>
                          <p className={`text-[10px] font-semibold uppercase tracking-wider ${C.t3} mb-2 flex items-center gap-1`}>
                            <TreePine className="w-3 h-3"/> Pending Leaves
                          </p>
                          {pendingLeaves > 0 ? (
                            <div className="space-y-1">
                              {m.leaveApplications.slice(0,2).map((l: any) => (
                                <p key={l.id} className={`text-[11px] ${C.t2}`}>
                                  {l.leaveType?.name} · {parseFloat(l.totalDays).toFixed(1)} d
                                </p>
                              ))}
                              {pendingLeaves > 2 && <p className={`text-[11px] ${C.t3}`}>+{pendingLeaves-2} more</p>}
                            </div>
                          ) : (
                            <p className={`text-[12px] ${C.t3}`}>None pending</p>
                          )}
                        </div>

                        {/* Goals */}
                        <div>
                          <p className={`text-[10px] font-semibold uppercase tracking-wider ${C.t3} mb-2 flex items-center gap-1`}>
                            <Target className="w-3 h-3"/> Goals
                          </p>
                          {m.goals?.length > 0 ? (
                            <div className="space-y-1">
                              {m.goals.slice(0,2).map((g: any) => (
                                <div key={g.id} className="flex items-center gap-1.5">
                                  <div className="flex-1 h-1.5 bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden">
                                    <div className="h-full bg-[#008CFF] rounded-full transition-all" style={{ width: `${g.progress}%` }}/>
                                  </div>
                                  <span className={`text-[10px] font-medium ${goalColor(g.status)} shrink-0`}>{g.progress}%</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className={`text-[12px] ${C.t3}`}>No active goals</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
