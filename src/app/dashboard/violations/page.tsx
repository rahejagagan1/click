"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import UserAvatar from "@/components/ui/user-avatar";
import SearchableSelect from "@/components/ui/searchable-select";

interface ViolationUser {
    id: number;
    name: string;
    role: string;
    orgLevel?: string | null;
    profilePictureUrl: string | null;
    teamCapsule?: string | null;
    managerId?: number | null;
}

interface Violation {
    id: number;
    userId: number;
    title: string;
    description: string | null;
    severity: "low" | "medium" | "high" | "critical";
    status: "open" | "in_progress" | "closed";
    category: string | null;
    actionTaken: string | null;
    actionTakenFileUrl: string | null;
    actionTakenFileName: string | null;
    notes: string | null;
    violationDate: string | null;
    responsiblePersonId: number | null;
    resolvedAt: string | null;
    createdAt: string;
    user: ViolationUser;
    reporter: ViolationUser;
    responsiblePerson: ViolationUser | null;
}

interface Summary {
    total: number;
    open: number;
    inProgress: number;
    closed: number;
    highCritical: number;
}

const SEVERITY_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
    // Severity labels are L0–L3 in the UI; DB still stores
    // low/medium/high/critical so existing rows keep working.
    low:      { label: "L0", color: "bg-slate-100 dark:bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-500/20", dot: "bg-slate-400" },
    medium:   { label: "L1", color: "bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/20", dot: "bg-amber-400" },
    high:     { label: "L2", color: "bg-orange-100 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-500/20", dot: "bg-orange-500" },
    critical: { label: "L3", color: "bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-500/20", dot: "bg-rose-500" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
    open: { label: "Open", color: "bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/20", dot: "bg-red-500" },
    in_progress: { label: "In Progress", color: "bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/20", dot: "bg-blue-500" },
    closed: { label: "Closed", color: "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20", dot: "bg-emerald-500" },
};

const VIOLATION_TYPE_OPTIONS = [
    { value: "attendance", label: "Attendance" },
    { value: "misconduct", label: "Behavioural Misconduct" },
    { value: "policy_breach", label: "Policy Breach" },
    { value: "performance_concern", label: "Performance Concern" },
    { value: "other", label: "Other" },
];

export default function ViolationsPage() {
    const { data: session } = useSession();
    const sessionUser = session?.user as any;
    // Mirrors the DELETE gate in /api/violations: admin tier only
    // (CEO / dev / special_access / role=admin). Was narrower before —
    // role=admin and special_access users couldn't see the delete
    // button even though they're admins.
    const canDelete =
        sessionUser?.orgLevel === "ceo" ||
        sessionUser?.orgLevel === "special_access" ||
        sessionUser?.role === "admin" ||
        sessionUser?.isDeveloper === true;

    const [violations, setViolations] = useState<Violation[]>([]);
    const [summary, setSummary] = useState<Summary>({ total: 0, open: 0, inProgress: 0, closed: 0, highCritical: 0 });
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState<string>("");
    const [filterSeverity, setFilterSeverity] = useState<string>("");
    const [filterMonth, setFilterMonth] = useState<string>("");
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [showNewForm, setShowNewForm] = useState(false);
    const [users, setUsers] = useState<ViolationUser[]>([]);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editData, setEditData] = useState<Record<string, any>>({});

    // New violation form. `actionTakenFile` holds the optional PDF /
    // doc evidence the reporter wants to attach to the action-taken
    // note; null when no file is selected. `notes` is now surfaced as
    // "Description" in the UI and is mandatory (see Submit disabled
    // state + handleCreate guard).
    const [newViolation, setNewViolation] = useState({
        userId: 0, severity: "medium", category: "",
        customCategory: "",
        violationDate: new Date().toISOString().split("T")[0],
        actionTaken: "", status: "open", notes: "",
        responsiblePersonId: 0,
        reportedById: 0,
    });
    const [actionTakenFile, setActionTakenFile] = useState<File | null>(null);

    const selectedEmployee = users.find(u => u.id === newViolation.userId);

    // Reporter picker — every employee. HR specifically asked for
    // the full directory here so they can log violations on behalf
    // of anyone who flagged something internally (e.g. a peer who
    // observed late attendance but isn't HR-tier). Tier label is
    // shown in the sublabel as a hint, but doesn't gate the option.
    const reporterOptions = useMemo(
        () =>
            users.map(u => ({
                value: u.id,
                label: u.name,
                sublabel:
                    u.orgLevel === "ceo"            ? "CEO" :
                    u.orgLevel === "special_access" ? "Admin" :
                    u.role     === "admin"          ? "Admin" :
                    u.role     === "hr_manager"     ? "HR Manager" :
                    u.role,
            })),
        [users],
    );

    // Default the reporter to the logged-in user once the user list
    // arrives — only if they're actually in the eligible pool. Skip if
    // the form is mid-edit (userId already touched) so we don't stomp
    // an explicit pick.
    useEffect(() => {
        const me = Number(sessionUser?.dbId);
        if (!me) return;
        if (newViolation.reportedById) return;
        if (reporterOptions.some(o => o.value === me)) {
            setNewViolation(p => ({ ...p, reportedById: me }));
        }
    }, [reporterOptions, sessionUser?.dbId, newViolation.reportedById]);

    // Auto-fill responsible person when employee changes
    useEffect(() => {
        if (selectedEmployee?.managerId) {
            setNewViolation(p => ({ ...p, responsiblePersonId: selectedEmployee.managerId! }));
        }
    }, [selectedEmployee?.id, selectedEmployee?.managerId]);

    const fetchData = useCallback(() => {
        setLoading(true);
        const params = new URLSearchParams();
        if (filterStatus) params.set("status", filterStatus);
        // Severity filter is applied client-side now so the L0-L3 tab
        // strip can show accurate per-tier counts without re-fetching.
        fetch(`/api/violations?${params}`)
            .then(r => r.json())
            .then(d => {
                setViolations(d.violations || []);
                setSummary(d.summary || { total: 0, open: 0, inProgress: 0, closed: 0, highCritical: 0 });
            })
            .catch(() => { })
            .finally(() => setLoading(false));
    }, [filterStatus]);

    useEffect(() => { fetchData(); }, [fetchData]);

    useEffect(() => {
        // ?all=true so the dropdown includes plain members (default
        // role/orgLevel after a Keka bulk import) — otherwise newly
        // onboarded employees can't be picked as the affected user.
        fetch("/api/users?all=true").then(r => r.json()).then(d => {
            if (Array.isArray(d)) setUsers(d);
        }).catch(() => { });
    }, []);

    const handleCreate = async () => {
        if (!newViolation.userId) return;
        if (!actionTakenFile) return;            // Action Document is now mandatory
        if (!newViolation.notes.trim()) return;  // Description is mandatory
        setSaving(true);
        try {
            // Switch to multipart/form-data so we can attach the
            // optional Action-Taken file alongside the form fields.
            // The route accepts both JSON (legacy callers) and form-
            // data, branching on Content-Type, so this is a one-sided
            // change.
            const fd = new FormData();
            const category = newViolation.category === "other"
                ? (newViolation.customCategory || "other")
                : newViolation.category;
            fd.set("userId",              String(newViolation.userId));
            fd.set("severity",            newViolation.severity);
            fd.set("status",              newViolation.status);
            fd.set("category",            category);
            fd.set("actionTaken",         newViolation.actionTaken);
            fd.set("notes",               newViolation.notes);
            fd.set("violationDate",       newViolation.violationDate);
            fd.set("responsiblePersonId", String(newViolation.responsiblePersonId || ""));
            fd.set("reportedById",        String(newViolation.reportedById || ""));
            if (actionTakenFile) fd.set("actionTakenFile", actionTakenFile);

            const res = await fetch("/api/violations", {
                method: "POST",
                body:   fd,
            });
            if (!res.ok) {
                const err = await res.json();
                alert(`Failed to submit: ${err.error || "Unknown error"}`);
                setSaving(false);
                return;
            }
            setShowNewForm(false);
            setNewViolation({
                userId: 0, severity: "medium", category: "",
                customCategory: "",
                violationDate: new Date().toISOString().split("T")[0],
                actionTaken: "", status: "open", notes: "",
                responsiblePersonId: 0,
                // Re-prime to the logged-in user if they're in the
                // eligible reporter pool; otherwise leave blank and the
                // mount-time effect will fill it in.
                reportedById: reporterOptions.some(o => o.value === Number(sessionUser?.dbId))
                    ? Number(sessionUser?.dbId) || 0
                    : 0,
            });
            setActionTakenFile(null);
            fetchData();
        } catch { }
        setSaving(false);
    };

    // Edit-mode attachment state. `editFile` is a freshly-picked
    // upload that should replace whatever is on the row; `clearEditFile`
    // is true when HR deliberately clicked "Remove" to drop the
    // existing attachment without putting one back. Either action
    // forces the save path onto multipart/form-data so the bytes (or
    // the explicit clear flag) reach the API.
    const [editFile, setEditFile] = useState<File | null>(null);
    const [clearEditFile, setClearEditFile] = useState(false);

    const startEditing = (v: Violation) => {
        setEditingId(v.id);
        setEditData({
            severity: v.severity,
            status: v.status,
            actionTaken: v.actionTaken || "",
            notes: v.notes || "",
            responsiblePersonId: v.responsiblePerson?.id || 0,
            // Capture the existing filename so the upload UI can show
            // "Currently attached: E-1.pdf" without needing a separate
            // re-fetch when entering edit mode.
            existingFileName: v.actionTakenFileName || null,
        });
        setEditFile(null);
        setClearEditFile(false);
    };

    const cancelEditing = () => {
        setEditingId(null);
        setEditData({});
        setEditFile(null);
        setClearEditFile(false);
    };

    const saveEdit = async (id: number) => {
        setSaving(true);
        try {
            // Branch on whether the file picker was touched. The JSON
            // path is the lighter of the two and stays the default for
            // edits that don't change the attachment (most of them).
            const hasFileChange = !!editFile || clearEditFile;
            let res: Response;
            if (hasFileChange) {
                const fd = new FormData();
                fd.set("id",                  String(id));
                fd.set("severity",            editData.severity ?? "");
                fd.set("status",              editData.status ?? "");
                fd.set("actionTaken",         editData.actionTaken ?? "");
                fd.set("notes",               editData.notes ?? "");
                fd.set("responsiblePersonId", String(editData.responsiblePersonId || ""));
                if (editFile) fd.set("actionTakenFile", editFile);
                if (clearEditFile && !editFile) fd.set("clearActionTakenFile", "1");
                res = await fetch("/api/violations", { method: "PATCH", body: fd });
            } else {
                res = await fetch("/api/violations", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id, ...editData }),
                });
            }
            if (!res.ok) {
                const err = await res.json();
                alert(`Failed to save: ${err.error || "Unknown error"}`);
            } else {
                setEditingId(null);
                setEditData({});
                setEditFile(null);
                setClearEditFile(false);
                fetchData();
            }
        } catch { }
        setSaving(false);
    };

    const formatDate = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

    const [statusDropdownId, setStatusDropdownId] = useState<number | null>(null);
    const changeStatus = async (e: React.MouseEvent, id: number, newStatus: string) => {
        e.stopPropagation();
        setStatusDropdownId(null);
        await fetch("/api/violations", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, status: newStatus }),
        });
        fetchData();
    };
    const handleDelete = async (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        if (!confirm("Are you sure you want to delete this violation?")) return;
        const res = await fetch("/api/violations", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
        });
        if (!res.ok) {
            const err = await res.json();
            alert(err.error || "Failed to delete");
        } else {
            fetchData();
        }
    };

    // Two-stage filter: month is applied first (used everywhere
    // including the per-tier counts on the tab strip), then severity
    // narrows it down for the actual list. This way the tab counts
    // reflect the month filter but ignore the active tier so HR can
    // see "if I cleared this tab, how many would there be?".
    const monthFilteredViolations = filterMonth
        ? violations.filter(v => {
            const d = v.violationDate ? new Date(v.violationDate) : new Date(v.createdAt);
            const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            return ym === filterMonth;
        })
        : violations;
    const filteredViolations = filterSeverity
        ? monthFilteredViolations.filter(v => v.severity === filterSeverity)
        : monthFilteredViolations;
    // Per-tier counts shown on the tab badges. Computed off
    // monthFilteredViolations so the strip always reflects the
    // current month/status scope.
    const tierCounts = {
        all:      monthFilteredViolations.length,
        low:      monthFilteredViolations.filter(v => v.severity === "low").length,
        medium:   monthFilteredViolations.filter(v => v.severity === "medium").length,
        high:     monthFilteredViolations.filter(v => v.severity === "high").length,
        critical: monthFilteredViolations.filter(v => v.severity === "critical").length,
    };

    const toggleStatusDropdown = (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        setStatusDropdownId(statusDropdownId === id ? null : id);
    };

    return (
        <div className="max-w-6xl mx-auto space-y-5 p-1">
            {/* ── Header ── */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <div>
                        <h1 className="text-[22px] font-bold tracking-tight text-slate-800 dark:text-white">System Violation Log</h1>
                        <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">Track and manage policy violations across the organization</p>
                    </div>
                </div>
                <button
                    onClick={() => setShowNewForm(true)}
                    className="self-start inline-flex items-center gap-2 px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white text-[13px] font-semibold rounded-lg transition-colors shadow-sm"
                >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    Report Violation
                </button>
            </div>

            {/* ── Summary Cards ── pastel tints + dark text, matches the
                KPI department-breakdown style for a consistent look. */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                {[
                    { label: "Total",           value: summary.total,        tint: "#64748b", iconPath: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" },
                    { label: "Open Cases",      value: summary.open,         tint: "#dc2626", iconPath: "M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636" },
                    { label: "In Progress",     value: summary.inProgress,   tint: "#0284c7", iconPath: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" },
                    { label: "Closed Cases",    value: summary.closed,       tint: "#059669", iconPath: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
                    { label: "L2 / L3",         value: summary.highCritical, tint: "#d97706", iconPath: "M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" },
                ].map((card) => (
                    <div
                        key={card.label}
                        className="relative overflow-hidden rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#0d1b2e] p-4 transition-shadow hover:shadow-[0_4px_18px_rgba(15,23,42,0.06)]"
                    >
                        <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${card.tint}, ${card.tint}80 65%, transparent)` }} />
                        <div className="flex items-start gap-3">
                            <span
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1"
                                style={{ background: `${card.tint}14`, color: card.tint, boxShadow: `inset 0 0 0 1px ${card.tint}33` }}
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={card.iconPath} />
                                </svg>
                            </span>
                            <div className="min-w-0">
                                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{card.label}</p>
                                <p className="mt-1 text-[22px] font-bold leading-none text-slate-800 dark:text-white tabular-nums">{card.value}</p>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* ── Filters bar — wrapped in a card so it visually anchors. */}
            <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#0d1b2e] px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 mr-1">Filter</span>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                    className="h-9 px-2.5 text-[12.5px] rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-500/15">
                    <option value="">All Status</option>
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="closed">Closed</option>
                </select>
                {/* Severity filter is now driven by the L0–L3 tab strip
                    above the records list — no dropdown duplicate. */}
                <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
                    className="h-9 px-2.5 text-[12.5px] rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-500/15 cursor-pointer"
                    onClick={e => (e.target as HTMLInputElement).showPicker()} />
                {(filterStatus || filterSeverity || filterMonth) && (
                    <button onClick={() => { setFilterStatus(""); setFilterSeverity(""); setFilterMonth(""); }}
                        className="h-9 px-2.5 text-[11.5px] font-semibold text-slate-500 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors">
                        Clear all
                    </button>
                )}
                <span className="ml-auto text-[11.5px] text-slate-500 tabular-nums">
                    {filteredViolations.length} record{filteredViolations.length !== 1 ? "s" : ""}
                </span>
            </div>

            {/* ── Records Card ── */}
            <div className="rounded-xl bg-white dark:bg-[#0d1b2e] border border-slate-200 dark:border-white/[0.06] shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 dark:border-white/[0.05] flex items-center gap-2">
                    <svg className="w-4 h-4 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    <h2 className="text-[13px] font-bold text-slate-800 dark:text-white">Violation Records</h2>
                    <span className="ml-auto text-[11px] text-slate-400 tabular-nums">
                        {filteredViolations.length} {filteredViolations.length === 1 ? "entry" : "entries"}
                    </span>
                </div>

                {/* L0–L3 tab strip — replaces the old severity dropdown.
                    Each tab shows the count for its tier in the current
                    month/status scope; clicking it narrows the list.
                    Tailwind class strings are spelled out per-tint so
                    JIT picks them up (dynamic `bg-${tint}-100` would
                    not be detected at build time). */}
                <div className="flex items-center gap-1 border-b border-slate-100 dark:border-white/[0.05] px-3 py-2 overflow-x-auto">
                    {([
                        { key: "",         label: "All", count: tierCounts.all,
                          activeCls: "bg-slate-100 text-slate-800 ring-1 ring-inset ring-slate-300 dark:bg-white/10 dark:text-slate-200" },
                        { key: "low",      label: "L0",  count: tierCounts.low,
                          activeCls: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-300 dark:bg-slate-500/15 dark:text-slate-300" },
                        { key: "medium",   label: "L1",  count: tierCounts.medium,
                          activeCls: "bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-300 dark:bg-amber-500/15 dark:text-amber-300" },
                        { key: "high",     label: "L2",  count: tierCounts.high,
                          activeCls: "bg-orange-100 text-orange-700 ring-1 ring-inset ring-orange-300 dark:bg-orange-500/15 dark:text-orange-300" },
                        { key: "critical", label: "L3",  count: tierCounts.critical,
                          activeCls: "bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-300 dark:bg-rose-500/15 dark:text-rose-300" },
                    ] as const).map((t) => {
                        const active = filterSeverity === t.key;
                        return (
                            <button
                                key={t.key || "all"}
                                type="button"
                                onClick={() => setFilterSeverity(t.key)}
                                className={
                                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors whitespace-nowrap " +
                                    (active
                                        ? t.activeCls
                                        : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5")
                                }
                            >
                                {t.label}
                                <span className={
                                    "inline-flex items-center justify-center min-w-[20px] rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums " +
                                    (active
                                        ? "bg-white/70 dark:bg-white/10"
                                        : "bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-400")
                                }>
                                    {t.count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {loading ? (
                    <div className="p-12 text-center">
                        <div className="inline-block w-7 h-7 rounded-full border-2 border-rose-200 border-t-rose-500 animate-spin" />
                        <p className="mt-3 text-[12.5px] text-slate-500">Loading violations…</p>
                    </div>
                ) : filteredViolations.length === 0 ? (
                    <div className="px-6 py-14 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center mx-auto mb-3">
                            <svg className="w-7 h-7 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <p className="text-[14px] font-semibold text-slate-700 dark:text-slate-200">No violations found</p>
                        <p className="mt-1 text-[12px] text-slate-500">
                            {filterStatus || filterSeverity || filterMonth
                                ? "Try clearing the filters above."
                                : "All clear — no policy violations have been logged."}
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-50 dark:divide-white/[0.03]">
                        {filteredViolations.map((v) => {
                            const sev = SEVERITY_CONFIG[v.severity];
                            const stat = STATUS_CONFIG[v.status];
                            const isExpanded = expandedId === v.id;

                            return (
                                <div key={v.id}>
                                    <div
                                        onClick={() => setExpandedId(isExpanded ? null : v.id)}
                                        className={`px-6 py-4 cursor-pointer transition-colors ${isExpanded ? "bg-slate-50 dark:bg-white/[0.02]" : "hover:bg-slate-50/50 dark:hover:bg-white/[0.01]"}`}
                                    >
                                        <div className="flex items-center gap-4">
                                            {/* Severity dot */}
                                            <div className={`w-2.5 h-2.5 rounded-full ${sev.dot} shrink-0`} />

                                            {/* User */}
                                            <div className="flex items-center gap-2.5 min-w-[160px]">
                                                <UserAvatar name={v.user.name} src={v.user.profilePictureUrl} size="sm" />
                                                <div>
                                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{v.user.name}</p>
                                                    <p className="text-[10px] text-slate-500">{v.user.teamCapsule || v.user.role}</p>
                                                </div>
                                            </div>

                                    {/* Title */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">{v.title}</p>
                                        {v.category && (
                                            <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">
                                                {VIOLATION_TYPE_OPTIONS.find(c => c.value === v.category)?.label || v.category}
                                            </p>
                                        )}
                                    </div>

                                    {/* Badges */}
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className={`text-[10px] px-2 py-0.5 rounded-md border font-semibold ${sev.color}`}>{sev.label}</span>
                                        <div className="relative">
                                            <span onClick={(e) => toggleStatusDropdown(e, v.id)}
                                                className={`text-[10px] px-2 py-0.5 rounded-md border font-semibold flex items-center gap-1 cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-current transition-all ${stat.color}`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${stat.dot}`} />
                                                {stat.label}
                                                <svg className="w-2.5 h-2.5 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </span>
                                            {statusDropdownId === v.id && (
                                                <div className="absolute right-0 top-full mt-1 bg-white dark:bg-[#1a1a35] border border-slate-200 dark:border-white/10 rounded-lg shadow-xl z-[100] py-1 min-w-[120px]">
                                                    {(["open", "in_progress", "closed"] as const).map((s) => {
                                                        const sc = STATUS_CONFIG[s];
                                                        return (
                                                            <button key={s} onClick={(e) => changeStatus(e, v.id, s)}
                                                                className={`w-full text-left px-3 py-1.5 text-xs font-medium flex items-center gap-2 transition-colors ${v.status === s
                                                                        ? "bg-slate-50 dark:bg-white/5 font-semibold"
                                                                        : "hover:bg-slate-50 dark:hover:bg-white/5"
                                                                    } text-slate-700 dark:text-slate-300`}>
                                                                <span className={`w-2 h-2 rounded-full ${sc.dot}`} />
                                                                {sc.label}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Date */}
                                    <p className="text-[11px] text-slate-500 shrink-0 w-20 text-right">{formatDate(v.createdAt)}</p>

                                    {/* Expand icon */}
                                    <svg className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ${isExpanded ? "rotate-180" : ""}`}
                                        fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </div>
                                    </div>

                                    {/* Expanded details */}
                {isExpanded && (
                    <div className="px-6 py-4 bg-slate-50/50 dark:bg-white/[0.01] border-t border-slate-100 dark:border-white/5">
                        {editingId === v.id ? (
                            /* ─── Edit Mode ─── */
                            <div className="space-y-4">
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Severity</label>
                                        <select value={editData.severity} onChange={e => setEditData(p => ({ ...p, severity: e.target.value }))}
                                            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500/30">
                                            <option value="low">L0</option>
                                            <option value="medium">L1</option>
                                            <option value="high">L2</option>
                                            <option value="critical">L3</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Status</label>
                                        <select value={editData.status} onChange={e => setEditData(p => ({ ...p, status: e.target.value }))}
                                            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500/30">
                                            <option value="open">Open</option>
                                            <option value="in_progress">In Progress</option>
                                            <option value="closed">Closed</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Manager</label>
                                        <select value={editData.responsiblePersonId} onChange={e => setEditData(p => ({ ...p, responsiblePersonId: Number(e.target.value) }))}
                                            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500/30">
                                            <option value={0}>Select...</option>
                                            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Action Taken</label>
                                    <textarea value={editData.actionTaken} onChange={e => setEditData(p => ({ ...p, actionTaken: e.target.value }))}
                                        rows={2} placeholder="Describe action taken..."
                                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500/30 resize-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Notes</label>
                                    <textarea value={editData.notes} onChange={e => setEditData(p => ({ ...p, notes: e.target.value }))}
                                        rows={2} placeholder="Additional notes..."
                                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500/30 resize-none" />
                                </div>
                                {/* Action Document — re-upload / replace.
                                    Three states packed into one block:
                                      1. existing file present, no edit  → "Currently attached: foo.pdf" + Replace + Remove
                                      2. new file picked                 → green chip with new filename + Undo
                                      3. cleared (Remove pressed)        → "Will remove on save" + Undo
                                    Re-uploading a file overrides the
                                    Remove flag automatically. */}
                                <div>
                                    <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Action Document</label>
                                    {editFile ? (
                                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/5">
                                            <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                            <span className="text-[12.5px] font-medium text-emerald-700 dark:text-emerald-300 truncate">{editFile.name}</span>
                                            <span className="text-[11px] text-emerald-600/70 dark:text-emerald-400/70 ml-auto">New (will replace on save)</span>
                                            <button type="button" onClick={() => setEditFile(null)}
                                                className="text-[11px] font-semibold text-rose-500 hover:underline shrink-0">
                                                Undo
                                            </button>
                                        </div>
                                    ) : clearEditFile ? (
                                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/5">
                                            <svg className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                            <span className="text-[12.5px] font-medium text-rose-700 dark:text-rose-300">Will remove attachment on save</span>
                                            <button type="button" onClick={() => setClearEditFile(false)}
                                                className="ml-auto text-[11px] font-semibold text-slate-600 dark:text-slate-400 hover:underline">
                                                Undo
                                            </button>
                                        </div>
                                    ) : editData.existingFileName ? (
                                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03]">
                                            <span className="text-[12.5px] text-slate-700 dark:text-slate-300 truncate">📎 {editData.existingFileName}</span>
                                            <span className="ml-auto flex items-center gap-3">
                                                <label className="text-[11px] font-semibold text-violet-600 dark:text-violet-400 hover:underline cursor-pointer">
                                                    Replace
                                                    <input
                                                        type="file"
                                                        accept=".pdf,.doc,.docx,.rtf,.odt,.txt,.md,.png,.jpg,.jpeg,.webp"
                                                        onChange={e => { setEditFile(e.target.files?.[0] ?? null); setClearEditFile(false); }}
                                                        className="hidden"
                                                    />
                                                </label>
                                                <button type="button" onClick={() => setClearEditFile(true)}
                                                    className="text-[11px] font-semibold text-rose-500 hover:underline">
                                                    Remove
                                                </button>
                                            </span>
                                        </div>
                                    ) : (
                                        <label className="flex items-center justify-center gap-1.5 w-full px-3 py-2.5 rounded-lg border-2 border-dashed border-slate-300 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] hover:border-violet-400/60 hover:bg-violet-50/40 dark:hover:bg-white/[0.05] cursor-pointer transition-colors">
                                            <input
                                                type="file"
                                                accept=".pdf,.doc,.docx,.rtf,.odt,.txt,.md,.png,.jpg,.jpeg,.webp"
                                                onChange={e => { setEditFile(e.target.files?.[0] ?? null); setClearEditFile(false); }}
                                                className="hidden"
                                            />
                                            <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.9 5 5 0 019.9-1A5.5 5.5 0 0118 16M12 12v8m0 0l-3-3m3 3l3-3" />
                                            </svg>
                                            <span className="text-[12.5px] text-slate-500 dark:text-slate-400">Click to upload PDF / image (≤10 MB)</span>
                                        </label>
                                    )}
                                </div>
                                <div className="flex justify-end gap-2">
                                    <button onClick={cancelEditing}
                                        className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors">
                                        Cancel
                                    </button>
                                    <button onClick={() => saveEdit(v.id)} disabled={saving}
                                        className="px-3 py-1.5 text-xs font-semibold text-white bg-violet-500 hover:bg-violet-600 disabled:opacity-50 rounded-lg transition-colors">
                                        {saving ? "Saving..." : "Save Changes"}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            /* ─── View Mode ─── */
                            <div>
                                <div className="flex justify-end gap-2 mb-3">
                                    <button onClick={() => startEditing(v)}
                                        className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 font-medium transition-colors flex items-center gap-1.5">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                        </svg>
                                        Edit
                                    </button>
                                    {canDelete && (
                                        <button onClick={(e) => handleDelete(e, v.id)}
                                            className="text-xs px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/5 font-medium transition-colors flex items-center gap-1.5">
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                            Delete
                                        </button>
                                    )}
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        {v.violationDate && (
                                            <div className="mb-3">
                                                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Violation Date</p>
                                                <p className="text-sm text-slate-700 dark:text-slate-300">{formatDate(v.violationDate)}</p>
                                            </div>
                                        )}
                                        {v.description && (
                                            <div className="mb-3">
                                                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Description</p>
                                                <p className="text-sm text-slate-700 dark:text-slate-300">{v.description}</p>
                                            </div>
                                        )}
                                        <div className="mb-3">
                                            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Reported By</p>
                                            <div className="flex items-center gap-2">
                                                <UserAvatar name={v.reporter.name} src={v.reporter.profilePictureUrl} size="sm" />
                                                <span className="text-sm text-slate-700 dark:text-slate-300">{v.reporter.name}</span>
                                            </div>
                                        </div>
                                        {v.responsiblePerson && (
                                            <div className="mb-3">
                                                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Manager</p>
                                                <div className="flex items-center gap-2">
                                                    <UserAvatar name={v.responsiblePerson.name} src={v.responsiblePerson.profilePictureUrl} size="sm" />
                                                    <span className="text-sm text-slate-700 dark:text-slate-300">{v.responsiblePerson.name}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <div>
                                        {v.actionTaken && (
                                            <div className="mb-3">
                                                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Action Taken</p>
                                                <p className="text-sm text-slate-700 dark:text-slate-300">{v.actionTaken}</p>
                                                {(v.actionTakenFileName || v.actionTakenFileUrl) && (
                                                    <a
                                                        href={`/api/violations/${v.id}/file`}
                                                        className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] font-medium text-violet-600 dark:text-violet-400 hover:underline"
                                                    >
                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                                        </svg>
                                                        {v.actionTakenFileName || "Attachment"}
                                                    </a>
                                                )}
                                            </div>
                                        )}
                                        {!v.actionTaken && (v.actionTakenFileName || v.actionTakenFileUrl) && (
                                            <div className="mb-3">
                                                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Action Taken</p>
                                                <a
                                                    href={`/api/violations/${v.id}/file`}
                                                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-violet-600 dark:text-violet-400 hover:underline"
                                                >
                                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                                    </svg>
                                                    {v.actionTakenFileName || "Attachment"}
                                                </a>
                                            </div>
                                        )}
                                        {v.notes && (
                                            <div className="mb-3">
                                                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Description</p>
                                                <p className="text-sm text-slate-700 dark:text-slate-300">{v.notes}</p>
                                            </div>
                                        )}
                                        {v.resolvedAt && (
                                            <div className="mt-2">
                                                <p className="text-[10px] text-slate-500">Resolved: {formatDate(v.resolvedAt)}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
            );
                        })}
        </div>
    )
}
            </div>

            {/* ── New Violation Modal ── */}
            {showNewForm && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowNewForm(false)}>
            <div className="bg-white dark:bg-[#1a1a35] rounded-2xl shadow-2xl w-full max-w-2xl border border-slate-200 dark:border-white/10 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between shrink-0">
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">Report New Violation</h3>
                    <button onClick={() => setShowNewForm(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div className="px-6 py-5 space-y-4 overflow-y-auto">
                    {/* Row 1: Employee + Date */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Employee</label>
                            {/* Searchable picker — the team list is long enough
                                that a native <select> required scrolling through
                                40+ names. Type-to-filter matches by name OR role. */}
                            <SearchableSelect
                                value={newViolation.userId || null}
                                onChange={(v) => setNewViolation(p => ({ ...p, userId: Number(v) }))}
                                options={users.map(u => ({ value: u.id, label: u.name, sublabel: u.role }))}
                                placeholder="Select employee…"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Date of Violation</label>
                            <input type="date" value={newViolation.violationDate} onChange={e => setNewViolation(p => ({ ...p, violationDate: e.target.value }))}
                                onClick={e => (e.target as HTMLInputElement).showPicker()}
                                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500/30 cursor-pointer" />
                        </div>
                    </div>

                    {/* Row: Violation Type + Manager */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Violation Type</label>
                            <select value={newViolation.category} onChange={e => setNewViolation(p => ({ ...p, category: e.target.value, customCategory: "" }))}
                                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500/30">
                                <option value="">Select type...</option>
                                {VIOLATION_TYPE_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Manager</label>
                            <SearchableSelect
                                value={newViolation.responsiblePersonId || null}
                                onChange={(v) => setNewViolation(p => ({ ...p, responsiblePersonId: Number(v) }))}
                                options={users.map(u => ({ value: u.id, label: u.name, sublabel: u.role }))}
                                placeholder="Select…"
                            />
                        </div>
                    </div>

                    {/* Custom violation type (shown only when "other" is selected) */}
                    {newViolation.category === "other" && (
                        <div>
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Specify Violation Type</label>
                            <input value={newViolation.customCategory} onChange={e => setNewViolation(p => ({ ...p, customCategory: e.target.value }))}
                                placeholder="Enter the violation type..."
                                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
                        </div>
                    )}

                    {/* Auto Department Display */}
                    {selectedEmployee && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-50 dark:bg-violet-500/5 border border-violet-200 dark:border-violet-500/15">
                            <svg className="w-4 h-4 text-violet-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                            </svg>
                            <span className="text-xs font-medium text-violet-700 dark:text-violet-300">
                                Department: <span className="font-semibold">{selectedEmployee.teamCapsule || selectedEmployee.role || "N/A"}</span>
                            </span>
                        </div>
                    )}

                    {/* Reported By — managers, HoDs, HR Manager, CEO and
                        admin-tier users only. Defaults to the logged-in
                        reporter so the common case is one click; HR can
                        override when filing on someone else's behalf. */}
                    <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Reported By</label>
                        <SearchableSelect
                            value={newViolation.reportedById || null}
                            onChange={(v) => setNewViolation(p => ({ ...p, reportedById: Number(v) }))}
                            options={reporterOptions}
                            placeholder="Select reporter…"
                        />
                    </div>

                    {/* Row: Severity + Status */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Severity</label>
                            <select value={newViolation.severity} onChange={e => setNewViolation(p => ({ ...p, severity: e.target.value }))}
                                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500/30">
                                <option value="low">L0</option>
                                <option value="medium">L1</option>
                                <option value="high">L2</option>
                                <option value="critical">L3</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Status</label>
                            <select value={newViolation.status} onChange={e => setNewViolation(p => ({ ...p, status: e.target.value }))}
                                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500/30">
                                <option value="open">Open</option>
                                <option value="in_progress">In Progress</option>
                                <option value="closed">Closed</option>
                            </select>
                        </div>
                    </div>

                    {/* Action Taken (Required) + optional PDF/doc evidence
                        side-by-side. The textarea is the headline write-up;
                        the file picker is for HR to attach the actual
                        warning letter / chat-screenshot / whatever proof
                        they want stapled to the record. */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">
                                Action Taken <span className="text-slate-400 normal-case font-normal tracking-normal">(Optional)</span>
                            </label>
                            <textarea value={newViolation.actionTaken} onChange={e => setNewViolation(p => ({ ...p, actionTaken: e.target.value }))}
                                rows={3} placeholder="Describe the action taken..."
                                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500/30 resize-none" />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">
                                Action Document <span className="text-rose-500">*</span>
                            </label>
                            <label className="flex flex-col items-center justify-center gap-1.5 w-full h-[88px] px-3 rounded-lg border-2 border-dashed border-slate-300 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] hover:border-violet-400/60 hover:bg-violet-50/40 dark:hover:bg-white/[0.05] cursor-pointer transition-colors">
                                <input
                                    type="file"
                                    accept=".pdf,.doc,.docx,.rtf,.odt,.txt,.md,.png,.jpg,.jpeg,.webp"
                                    onChange={e => setActionTakenFile(e.target.files?.[0] ?? null)}
                                    className="hidden"
                                />
                                {actionTakenFile ? (
                                    <>
                                        <span className="text-[12.5px] font-medium text-slate-700 dark:text-slate-200 truncate max-w-full">📎 {actionTakenFile.name}</span>
                                        <span
                                            role="button"
                                            tabIndex={0}
                                            onClick={(e) => { e.preventDefault(); setActionTakenFile(null); }}
                                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActionTakenFile(null); } }}
                                            className="text-[11px] text-rose-500 hover:underline cursor-pointer"
                                        >
                                            Remove
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        <svg className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.9 5 5 0 019.9-1A5.5 5.5 0 0118 16M12 12v8m0 0l-3-3m3 3l3-3" />
                                        </svg>
                                        <span className="text-[12px] text-slate-500 dark:text-slate-400">Click to upload PDF / image (≤10 MB)</span>
                                    </>
                                )}
                            </label>
                        </div>
                    </div>

                    {/* Description (mandatory) — was previously labelled
                        "Notes (Optional)". The internal field name stays
                        `notes` so existing rows + the API don't churn; only
                        the user-facing label and the required-flag changed. */}
                    <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">
                            Description <span className="text-rose-500">*</span>
                        </label>
                        <textarea value={newViolation.notes} onChange={e => setNewViolation(p => ({ ...p, notes: e.target.value }))}
                            rows={3} placeholder="What happened? Add context, dates, people involved…"
                            className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500/30 resize-none" />
                    </div>
                </div>
                <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 flex justify-end gap-3 shrink-0">
                    <button onClick={() => setShowNewForm(false)}
                        className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors">
                        Cancel
                    </button>
                    <button onClick={handleCreate} disabled={saving || !newViolation.userId || !actionTakenFile || !newViolation.notes.trim()}
                        className="px-4 py-2 text-sm font-semibold text-white bg-rose-500 hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors shadow-sm">
                        {saving ? "Saving..." : "Submit Violation"}
                    </button>
                </div>
            </div>
        </div>
            )}
        </div>
    );
}
