"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { TreePine, IndianRupee, Clock, CheckCircle2, Home, Briefcase, Gift, Plane } from "lucide-react";

const C = {
  card:    "bg-white dark:bg-[#101c2e] border border-[#e2e8f0] dark:border-[rgba(255,255,255,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.07)] dark:shadow-none rounded-2xl",
  t1:      "text-[#1e293b] dark:text-[#e2e8f0]",
  t2:      "text-[#475569] dark:text-[#8892a4]",
  t3:      "text-[#94a3b8] dark:text-[#64748b]",
  divider: "border-[#e2e8f0] dark:border-[rgba(255,255,255,0.06)]",
};

function Av({ name, url, size = 36 }: { name: string; url?: string; size?: number }) {
  const initials = name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
  const colors = ["#4f46e5","#0891b2","#059669","#d97706","#dc2626","#7c3aed"];
  const bg = colors[name.charCodeAt(0) % colors.length];
  if (url) return <img src={url} alt={name} className="rounded-full object-cover" style={{ width: size, height: size, flexShrink: 0 }} />;
  return (
    <div className="rounded-full flex items-center justify-center font-bold text-white shrink-0"
      style={{ width: size, height: size, background: bg, fontSize: size * 0.33 }}>
      {initials}
    </div>
  );
}

function ActionRow({ item, prefix, onApprove, onReject, approving, children }: any) {
  const key = `${prefix}${item.id}`;
  return (
    <div className={`flex items-center gap-4 px-5 py-4 border-b last:border-0 ${C.divider}`}>
      <Av name={item.user?.name || "?"} url={item.user?.profilePictureUrl} />
      <div className="flex-1 min-w-0">{children}</div>
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={() => onApprove(item.id)} disabled={approving[key]}
          className="h-7 px-3 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg text-[11px] font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-500/20 disabled:opacity-40">
          Approve
        </button>
        <button onClick={() => onReject(item.id)} disabled={approving[key]}
          className="h-7 px-3 bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400 rounded-lg text-[11px] font-semibold hover:bg-red-100 dark:hover:bg-red-500/20 disabled:opacity-40">
          Reject
        </button>
      </div>
    </div>
  );
}

function SectionBlock({ icon: Icon, label, count, color, bgColor, items, prefix, onApprove, onReject, approving, children }: any) {
  if (!items?.length) return null;
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <Icon className={`w-4 h-4 ${color}`} />
        <h2 className={`text-[13px] font-semibold ${C.t1}`}>{label}</h2>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${bgColor}`}>{count}</span>
      </div>
      <div className={`${C.card} overflow-hidden`}>
        {items.map((item: any) => (
          <ActionRow key={item.id} item={item} prefix={prefix} onApprove={onApprove} onReject={onReject} approving={approving}>
            {children(item)}
          </ActionRow>
        ))}
      </div>
    </section>
  );
}

type Tab = "all" | "leaves" | "expenses" | "attendance" | "travel";

export default function InboxPage() {
  const [tab, setTab] = useState<Tab>("all");
  const [approving, setApproving] = useState<Record<string, boolean>>({});

  const { data, isLoading, mutate: revalidate } = useSWR("/api/hr/inbox", fetcher);

  const leaves         = data?.leaves          ?? [];
  const expenses       = data?.expenses        ?? [];
  const regs           = data?.regularizations ?? [];
  const wfh            = data?.wfh             ?? [];
  const onDuty         = data?.onDuty          ?? [];
  const compOff        = data?.compOff         ?? [];
  const travel         = data?.travel          ?? [];
  const total          = data?.total ?? 0;

  const attendanceTotal = regs.length + wfh.length + onDuty.length + compOff.length;

  const act = async (url: string, body: object, key: string) => {
    setApproving(p => ({ ...p, [key]: true }));
    await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setApproving(p => ({ ...p, [key]: false }));
    revalidate();
    mutate((k: string) => typeof k === "string" && (
      k.includes("/api/hr/leaves") || k.includes("/api/hr/expenses") ||
      k.includes("/api/hr/attendance") || k.includes("/api/hr/travel") || k.includes("/api/hr/inbox")
    ));
  };

  const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  const tabs: { key: Tab; label: string; count: number; icon: any; color: string; bg: string }[] = [
    { key: "all",        label: "All",        count: total,          icon: null,        color: "text-[#008CFF]",    bg: "bg-[#008CFF]/10 text-[#008CFF]"       },
    { key: "leaves",     label: "Leaves",     count: leaves.length,  icon: TreePine,    color: "text-violet-500",   bg: "bg-violet-100 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400" },
    { key: "expenses",   label: "Expenses",   count: expenses.length + travel.length, icon: IndianRupee, color: "text-emerald-500", bg: "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
    { key: "attendance", label: "Attendance", count: attendanceTotal, icon: Clock,       color: "text-amber-500",    bg: "bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400"   },
    { key: "travel",     label: "Travel",     count: travel.length,  icon: Plane,       color: "text-sky-500",      bg: "bg-sky-100 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400"           },
  ];

  return (
    <div className="min-h-screen bg-[#f1f5f9] dark:bg-[#0b1220]">
      <div className="bg-white dark:bg-[#0d1b2e] border-b border-[#e2e8f0] dark:border-[rgba(255,255,255,0.06)] px-6 py-4">
        <h1 className={`text-[17px] font-semibold ${C.t1}`}>Inbox</h1>
        <p className={`text-[12px] ${C.t3} mt-0.5`}>{total} pending action{total !== 1 ? "s" : ""} require your attention</p>
      </div>

      <div className="flex gap-0 bg-white dark:bg-[#0d1b2e] border-b border-[#e2e8f0] dark:border-[rgba(255,255,255,0.06)] px-6">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-3 text-[11px] font-bold tracking-wider border-b-2 transition-colors ${
              tab === t.key ? "border-[#008CFF] text-[#008CFF]" : `border-transparent ${C.t2}`
            }`}>
            {t.icon && <t.icon className={`w-3.5 h-3.5 ${tab === t.key ? "text-[#008CFF]" : t.color}`} />}
            {t.label}
            {t.count > 0 && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab === t.key ? "bg-[#008CFF] text-white" : "bg-slate-100 dark:bg-white/10 " + C.t3}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="px-6 py-5 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : total === 0 ? (
          <div className={`${C.card} p-12 text-center`}>
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
            <p className={`text-[14px] font-medium ${C.t1}`}>All caught up!</p>
            <p className={`text-[12px] ${C.t3} mt-1`}>No pending actions in your inbox.</p>
          </div>
        ) : (
          <>
            {/* Leaves */}
            {(tab === "all" || tab === "leaves") && (
              <SectionBlock icon={TreePine} label="Leave Requests" count={leaves.length}
                color="text-violet-500" bgColor="bg-violet-100 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400"
                items={leaves} prefix="l"
                onApprove={(id: number) => act(`/api/hr/leaves/${id}`, { action: "approve" }, `l${id}`)}
                onReject={(id: number)  => act(`/api/hr/leaves/${id}`, { action: "reject"  }, `l${id}`)}
                approving={approving}>
                {(l: any) => (
                  <>
                    <p className={`text-[13px] font-semibold ${C.t1}`}>{l.user?.name}</p>
                    <p className={`text-[11px] ${C.t3} mt-0.5`}>
                      {l.leaveType?.name} · {fmtDate(l.fromDate)}{l.fromDate !== l.toDate && ` → ${fmtDate(l.toDate)}`} · {parseFloat(l.totalDays).toFixed(1)} day{parseFloat(l.totalDays) !== 1 ? "s" : ""}
                    </p>
                    {l.reason && <p className={`text-[11px] ${C.t2} mt-0.5 truncate max-w-sm`}>"{l.reason}"</p>}
                  </>
                )}
              </SectionBlock>
            )}

            {/* Expenses */}
            {(tab === "all" || tab === "expenses") && (
              <SectionBlock icon={IndianRupee} label="Expense Claims" count={expenses.length}
                color="text-emerald-500" bgColor="bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                items={expenses} prefix="e"
                onApprove={(id: number) => act(`/api/hr/expenses/${id}`, { action: "approve" }, `e${id}`)}
                onReject={(id: number)  => act(`/api/hr/expenses/${id}`, { action: "reject"  }, `e${id}`)}
                approving={approving}>
                {(e: any) => (
                  <>
                    <p className={`text-[13px] font-semibold ${C.t1}`}>{e.user?.name}</p>
                    <p className={`text-[11px] ${C.t3} mt-0.5`}>{e.title} · {e.category} · <span className="text-emerald-500 font-bold">₹{Number(e.amount).toLocaleString("en-IN")}</span></p>
                    {e.description && <p className={`text-[11px] ${C.t2} mt-0.5 truncate max-w-sm`}>"{e.description}"</p>}
                  </>
                )}
              </SectionBlock>
            )}

            {/* Regularizations */}
            {(tab === "all" || tab === "attendance") && (
              <SectionBlock icon={Clock} label="Attendance Regularizations" count={regs.length}
                color="text-amber-500" bgColor="bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400"
                items={regs} prefix="r"
                onApprove={(id: number) => act(`/api/hr/attendance/regularize`, { id, action: "approve" }, `r${id}`)}
                onReject={(id: number)  => act(`/api/hr/attendance/regularize`, { id, action: "reject"  }, `r${id}`)}
                approving={approving}>
                {(r: any) => (
                  <>
                    <p className={`text-[13px] font-semibold ${C.t1}`}>{r.user?.name}</p>
                    <p className={`text-[11px] ${C.t3} mt-0.5`}>
                      {fmtDate(r.date)}
                      {r.requestedIn && ` · In: ${new Date(r.requestedIn).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}`}
                      {r.requestedOut && ` · Out: ${new Date(r.requestedOut).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}`}
                    </p>
                    {r.reason && <p className={`text-[11px] ${C.t2} mt-0.5 truncate max-w-sm`}>"{r.reason}"</p>}
                  </>
                )}
              </SectionBlock>
            )}

            {/* WFH */}
            {(tab === "all" || tab === "attendance") && (
              <SectionBlock icon={Home} label="Work From Home Requests" count={wfh.length}
                color="text-cyan-500" bgColor="bg-cyan-100 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
                items={wfh} prefix="w"
                onApprove={(id: number) => act(`/api/hr/attendance/wfh`, { id, action: "approve" }, `w${id}`)}
                onReject={(id: number)  => act(`/api/hr/attendance/wfh`, { id, action: "reject"  }, `w${id}`)}
                approving={approving}>
                {(w: any) => (
                  <>
                    <p className={`text-[13px] font-semibold ${C.t1}`}>{w.user?.name}</p>
                    <p className={`text-[11px] ${C.t3} mt-0.5`}>{fmtDate(w.date)}</p>
                    {w.reason && <p className={`text-[11px] ${C.t2} mt-0.5 truncate max-w-sm`}>"{w.reason}"</p>}
                  </>
                )}
              </SectionBlock>
            )}

            {/* On Duty */}
            {(tab === "all" || tab === "attendance") && (
              <SectionBlock icon={Briefcase} label="On-Duty Requests" count={onDuty.length}
                color="text-indigo-500" bgColor="bg-indigo-100 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                items={onDuty} prefix="od"
                onApprove={(id: number) => act(`/api/hr/attendance/on-duty`, { id, action: "approve" }, `od${id}`)}
                onReject={(id: number)  => act(`/api/hr/attendance/on-duty`, { id, action: "reject"  }, `od${id}`)}
                approving={approving}>
                {(od: any) => (
                  <>
                    <p className={`text-[13px] font-semibold ${C.t1}`}>{od.user?.name}</p>
                    <p className={`text-[11px] ${C.t3} mt-0.5`}>
                      {fmtDate(od.date)}
                      {od.fromTime && ` · ${od.fromTime}`}{od.toTime && ` → ${od.toTime}`}
                      {od.location && ` · ${od.location}`}
                    </p>
                    {od.purpose && <p className={`text-[11px] ${C.t2} mt-0.5 truncate max-w-sm`}>"{od.purpose}"</p>}
                  </>
                )}
              </SectionBlock>
            )}

            {/* Comp-Off */}
            {(tab === "all" || tab === "attendance") && (
              <SectionBlock icon={Gift} label="Comp-Off Requests" count={compOff.length}
                color="text-pink-500" bgColor="bg-pink-100 dark:bg-pink-500/10 text-pink-600 dark:text-pink-400"
                items={compOff} prefix="co"
                onApprove={(id: number) => act(`/api/hr/leaves/comp-off`, { id, action: "approve" }, `co${id}`)}
                onReject={(id: number)  => act(`/api/hr/leaves/comp-off`, { id, action: "reject"  }, `co${id}`)}
                approving={approving}>
                {(co: any) => (
                  <>
                    <p className={`text-[13px] font-semibold ${C.t1}`}>{co.user?.name}</p>
                    <p className={`text-[11px] ${C.t3} mt-0.5`}>Worked: {fmtDate(co.workedDate)} · Credit: {parseFloat(co.creditDays).toFixed(1)} day</p>
                    {co.reason && <p className={`text-[11px] ${C.t2} mt-0.5 truncate max-w-sm`}>"{co.reason}"</p>}
                  </>
                )}
              </SectionBlock>
            )}

            {/* Travel */}
            {(tab === "all" || tab === "travel") && (
              <SectionBlock icon={Plane} label="Travel Requests" count={travel.length}
                color="text-sky-500" bgColor="bg-sky-100 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400"
                items={travel} prefix="tr"
                onApprove={(id: number) => act(`/api/hr/travel/${id}`, { action: "approve" }, `tr${id}`)}
                onReject={(id: number)  => act(`/api/hr/travel/${id}`, { action: "reject"  }, `tr${id}`)}
                approving={approving}>
                {(tr: any) => (
                  <>
                    <p className={`text-[13px] font-semibold ${C.t1}`}>{tr.user?.name}</p>
                    <p className={`text-[11px] ${C.t3} mt-0.5`}>
                      {fmtDate(tr.travelDate)} · {tr.fromLocation} → {tr.toLocation}
                      {tr.estimatedCost && ` · ₹${Number(tr.estimatedCost).toLocaleString("en-IN")}`}
                    </p>
                    {tr.purpose && <p className={`text-[11px] ${C.t2} mt-0.5 truncate max-w-sm`}>"{tr.purpose}"</p>}
                  </>
                )}
              </SectionBlock>
            )}
          </>
        )}
      </div>
    </div>
  );
}
