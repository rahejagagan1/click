"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import OrgTree from "@/components/admin/org-tree";
import UserAvatar from "@/components/ui/user-avatar";
import {
    type TeamCapsuleCatalog,
    teamCapsuleSelectionKeyToName,
} from "@/lib/team-capsule-catalog-ui";
import { USER_ROLE_OPTIONS } from "@/lib/user-role-options";

interface ListItem {
    id: string;
    name: string;
    taskCount: number;
    selected: boolean;
}

interface Folder {
    id: string;
    name: string;
    lists: ListItem[];
}

interface SpaceDetail {
    folders: Folder[];
    folderlessLists: ListItem[];
}

interface Space {
    id: string;
    name: string;
    detail?: SpaceDetail;
    loading?: boolean;
}

type AdminTab = "workspaces" | "users" | "ytviews" | "reports" | "crons" | "permissions";

export default function AdminPage() {
    const { data: session } = useSession();
    const sessionUser = session?.user as any;
    const canManageUsers = sessionUser?.orgLevel === "ceo" || sessionUser?.isDeveloper === true;

    const [spaces, setSpaces] = useState<Space[]>([]);
    const [selectedLists, setSelectedLists] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [syncing, setSyncing] = useState<string | null>(null);
    const [syncDone, setSyncDone] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [syncingReports, setSyncingReports] = useState(false);
    const [syncReportsDone, setSyncReportsDone] = useState(false);
    const [activeTab, setActiveTab] = useState<AdminTab>("workspaces");

    const adminTabs: readonly AdminTab[] = useMemo(
        () =>
            canManageUsers
                ? (["workspaces", "users", "ytviews", "reports", "crons", "permissions"] as const)
                : (["workspaces", "users", "ytviews", "reports", "permissions"] as const),
        [canManageUsers],
    );

    // Add/Delete user state
    const [showAddUser, setShowAddUser] = useState(false);
    const [addingUser, setAddingUser] = useState(false);
    const [deletingUserId, setDeletingUserId] = useState<number | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
    const [newUser, setNewUser] = useState({
        name: "",
        email: "",
        role: "member",
        orgLevel: "member",
        clickupUserId: "",
        teamCapsuleKey: "",
        managerId: "",
    });
    const [teamCapsuleCatalog, setTeamCapsuleCatalog] = useState<TeamCapsuleCatalog | null>(null);
    const [reports, setReports]       = useState<any[]>([]);
    const [reportsLoading, setReportsLoading] = useState(false);
    const [togglingReport, setTogglingReport] = useState<string | null>(null); // "id-weekly" or "id-monthly"
    const [refreshingReportId, setRefreshingReportId] = useState<number | null>(null);
    const [refreshedReportId, setRefreshedReportId] = useState<number | null>(null);
    const [users, setUsers] = useState<any[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [unmatchedClickup, setUnmatchedClickup] = useState<any[]>([]);
    const [unmatchedLoading, setUnmatchedLoading] = useState(false);
    const [unmatchedBusyId, setUnmatchedBusyId] = useState<number | null>(null);
    const [expandedSpaces, setExpandedSpaces] = useState<Set<string>>(new Set());
    const [lastSyncs, setLastSyncs] = useState<Record<string, string | null>>({});
    const [ytUrl, setYtUrl] = useState("");
    const [ytFetching, setYtFetching] = useState(false);
    const [ytVideos, setYtVideos] = useState<any[]>([]);
    const [ytError, setYtError] = useState<string | null>(null);
    const [userView, setUserView] = useState<"tree" | "table">("tree");
    const [ytApiMode, setYtApiMode] = useState<"data_api" | "analytics_api">("data_api");
    const [ytChannelCount, setYtChannelCount] = useState(0);

    // Permissions tab
    const [permUsers, setPermUsers] = useState<any[]>([]);
    const [permManagers, setPermManagers] = useState<any[]>([]);
    const [permLoading, setPermLoading] = useState(false);
    const [permSearch, setPermSearch] = useState("");
    const [permRoleFilter, setPermRoleFilter] = useState<string>("all");
    const [togglingPerm, setTogglingPerm] = useState<number | null>(null);
    const [expandedPermUserId, setExpandedPermUserId] = useState<number | null>(null);
    const [togglingManagerAccess, setTogglingManagerAccess] = useState<string | null>(null); // "userId-managerId"

    // Crons tab (CEO / Developer)
    const [cronLoading, setCronLoading] = useState(false);
    const [cronSaving, setCronSaving] = useState(false);
    const [cronRunLoading, setCronRunLoading] = useState(false);
    const [cronBanner, setCronBanner] = useState<{ type: "ok" | "err"; text: string } | null>(null);
    const [cronServerNote, setCronServerNote] = useState<string | null>(null);
    const [cronInternalOff, setCronInternalOff] = useState(false);
    const [youtubeCron, setYoutubeCron] = useState<{
        name: string;
        description: string;
        enabled: boolean;
        intervalHours: number;
        lastAutoRunAt: string | null;
        lastManualRunAt: string | null;
    } | null>(null);
    const [cronEnabledDraft, setCronEnabledDraft] = useState(false);
    const [cronHoursDraft, setCronHoursDraft] = useState("5");

    useEffect(() => {
        if (!canManageUsers && activeTab === "crons") {
            setActiveTab("workspaces");
        }
    }, [canManageUsers, activeTab]);

    useEffect(() => {
        if (activeTab !== "crons" || !canManageUsers) return;
        let cancelled = false;
        setCronLoading(true);
        setCronBanner(null);
        fetch("/api/admin/cron-jobs")
            .then((r) => r.json())
            .then((data) => {
                if (cancelled) return;
                if (data?.error) {
                    setCronBanner({ type: "err", text: data.error });
                    return;
                }
                setCronInternalOff(!!data.internalSchedulerDisabled);
                setCronServerNote(typeof data.serverNote === "string" ? data.serverNote : null);
                const job = (data.jobs as any[] | undefined)?.find((j) => j?.id === "youtube_dashboard");
                if (job) {
                    setYoutubeCron({
                        name: job.name ?? "YouTube dashboard sync",
                        description: job.description ?? "",
                        enabled: !!job.enabled,
                        intervalHours: Number(job.intervalHours) || 5,
                        lastAutoRunAt: job.lastAutoRunAt ?? null,
                        lastManualRunAt: job.lastManualRunAt ?? null,
                    });
                    setCronEnabledDraft(!!job.enabled);
                    setCronHoursDraft(String(Math.min(168, Math.max(1, Math.floor(Number(job.intervalHours)) || 5))));
                } else {
                    setYoutubeCron(null);
                }
            })
            .catch(() => {
                if (!cancelled) setCronBanner({ type: "err", text: "Failed to load cron settings" });
            })
            .finally(() => {
                if (!cancelled) setCronLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [activeTab, canManageUsers]);

    useEffect(() => {
        fetch("/api/capsules/catalog")
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (d && typeof d === "object" && Array.isArray((d as TeamCapsuleCatalog).capsules)) {
                    setTeamCapsuleCatalog({
                        capsules: (d as TeamCapsuleCatalog).capsules,
                        productionLists: Array.isArray((d as TeamCapsuleCatalog).productionLists)
                            ? (d as TeamCapsuleCatalog).productionLists
                            : [],
                    });
                } else {
                    setTeamCapsuleCatalog({ capsules: [], productionLists: [] });
                }
            })
            .catch(() => setTeamCapsuleCatalog({ capsules: [], productionLists: [] }));
    }, []);

    // Close dropdown when clicking outside
    useEffect(() => {
        if (!expandedPermUserId) return;
        const handler = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest("[data-perm-dropdown]")) setExpandedPermUserId(null);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [expandedPermUserId]);

    // Load spaces list (fast)
    useEffect(() => {
        fetch("/api/admin/workspaces?allDetails=true")
            .then(r => r.json())
            .then(data => {
                if (data.error) { setError(data.error); }
                else {
                    setSpaces(data.spaces || []);
                    setSelectedLists(new Set(data.selectedLists || []));
                }
                setLoading(false);
            })
            .catch(() => { setError("Failed to load workspaces"); setLoading(false); });
        // Fetch last sync timestamps
        fetch("/api/admin/sync-status")
            .then(r => r.json())
            .then(data => { if (!data.error) setLastSyncs(data); })
            .catch(() => { });
    }, []);

    // Load users
    useEffect(() => {
        if (activeTab === "users" && users.length === 0) {
            setUsersLoading(true);
            fetch("/api/users?all=true")
                .then(r => r.json())
                .then(data => { setUsers(Array.isArray(data) ? data : data.users || []); setUsersLoading(false); })
                .catch(() => setUsersLoading(false));
        }
    }, [activeTab, users.length]);

    // Load ClickUp users that didn't match any HR user at last sync
    useEffect(() => {
        if (activeTab !== "users" || !canManageUsers) return;
        setUnmatchedLoading(true);
        fetch("/api/admin/clickup-unmatched")
            .then(r => r.ok ? r.json() : [])
            .then(data => { setUnmatchedClickup(Array.isArray(data) ? data : []); })
            .catch(() => { })
            .finally(() => setUnmatchedLoading(false));
    }, [activeTab, canManageUsers]);

    const handleOnboardUnmatched = async (id: number) => {
        setUnmatchedBusyId(id);
        try {
            const res = await fetch("/api/admin/clickup-unmatched", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                alert(err.error || `Onboard failed (${res.status})`);
                return;
            }
            setUnmatchedClickup(prev => prev.filter(u => u.id !== id));
            const freshRes = await fetch("/api/users?all=true");
            const fresh = await freshRes.json();
            if (Array.isArray(fresh)) setUsers(fresh);
        } finally {
            setUnmatchedBusyId(null);
        }
    };

    const handleDismissUnmatched = async (id: number) => {
        setUnmatchedBusyId(id);
        try {
            const res = await fetch("/api/admin/clickup-unmatched", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id }),
            });
            if (res.ok) setUnmatchedClickup(prev => prev.filter(u => u.id !== id));
        } finally {
            setUnmatchedBusyId(null);
        }
    };

    // Load reports when tab is active
    useEffect(() => {
        if (activeTab === "reports" && reports.length === 0) {
            setReportsLoading(true);
            fetch("/api/admin/reports")
                .then(r => r.json())
                .then(data => { setReports(Array.isArray(data) ? data : []); setReportsLoading(false); })
                .catch(() => setReportsLoading(false));
        }
    }, [activeTab, reports.length]);

    const toggleReportLock = async (id: number, currentLocked: boolean, isMonthly: boolean) => {
        const key = `${id}-${isMonthly ? "monthly" : "weekly"}`;
        setTogglingReport(key);
        try {
            const res = await fetch(`/api/admin/reports/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isLocked: !currentLocked, isMonthly }),
            });
            if (res.ok) {
                setReports(prev => prev.map(r =>
                    r.id === id && r.isMonthly === isMonthly
                        ? { ...r, isLocked: !currentLocked }
                        : r
                ));
            }
        } catch { }
        setTogglingReport(null);
    };

    const refreshReportFromDb = async (r: any) => {
        setRefreshingReportId(r.id);
        try {
            await Promise.all([
                fetch(`/api/reports/${r.managerId}/weekly/${r.week}/writer-cases?month=${r.month}&year=${r.year}`),
                fetch(`/api/reports/${r.managerId}/weekly/${r.week}/editor-cases?month=${r.month}&year=${r.year}`),
            ]);
            setRefreshedReportId(r.id);
            setTimeout(() => setRefreshedReportId(null), 3000);
        } catch { }
        setRefreshingReportId(null);
    };

    // Load YT API mode setting
    useEffect(() => {
        fetch("/api/admin/yt-settings").then(r => r.json()).then(data => {
            if (data.mode) setYtApiMode(data.mode);
            if (data.channels) setYtChannelCount(data.channels.length);
        }).catch(() => { });
    }, []);

    // Lazy-load space details when expanded
    const toggleSpace = async (spaceId: string) => {
        const isExpanded = expandedSpaces.has(spaceId);
        if (isExpanded) {
            setExpandedSpaces(prev => { const n = new Set(prev); n.delete(spaceId); return n; });
            return;
        }
        setExpandedSpaces(prev => new Set([...prev, spaceId]));
        const space = spaces.find(s => s.id === spaceId);
        if (space?.detail) return; // Already loaded

        // Mark as loading
        setSpaces(prev => prev.map(s => s.id === spaceId ? { ...s, loading: true } : s));
        try {
            const data = await fetch(`/api/admin/workspaces?spaceId=${spaceId}`).then(r => r.json());
            setSpaces(prev => prev.map(s => s.id === spaceId
                ? { ...s, loading: false, detail: { folders: data.folders || [], folderlessLists: data.folderlessLists || [] } }
                : s
            ));
        } catch {
            setSpaces(prev => prev.map(s => s.id === spaceId ? { ...s, loading: false } : s));
        }
    };

    const toggleList = (listId: string) => {
        setSelectedLists(prev => {
            const n = new Set(prev);
            n.has(listId) ? n.delete(listId) : n.add(listId);
            return n;
        });
    };

    const toggleAllInFolder = (lists: ListItem[], select: boolean) => {
        setSelectedLists(prev => {
            const n = new Set(prev);
            lists.forEach(l => select ? n.add(l.id) : n.delete(l.id));
            return n;
        });
    };

    const saveSelection = async () => {
        setSaving(true);
        try {
            await fetch("/api/admin/workspaces", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ selectedSpaces: [], selectedLists: Array.from(selectedLists) }),
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch { setError("Failed to save"); }
        setSaving(false);
    };

    const formatSyncTime = (iso: string | null | undefined) => {
        if (!iso) return null;
        const d = new Date(iso);
        return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) + ", " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    };

    const runSync = async (type: string) => {
        setSyncing(type);
        setSyncDone(null);
        try {
            await fetch(`/api/sync/${type}`, { method: "POST" });
            setSyncDone(type);
            setLastSyncs(prev => ({ ...prev, [type]: new Date().toISOString() }));
            setTimeout(() => setSyncDone(null), 4000);
            // Refresh users list after user sync
            if (type === "users") {
                const data = await fetch("/api/users?all=true").then(r => r.json());
                setUsers(Array.isArray(data) ? data : data.users || []);
            }
        } catch { setError("Sync failed"); }
        setSyncing(null);
    };

    const handleAddUser = async () => {
        if (!newUser.name || !newUser.email) return;
        setAddingUser(true);
        try {
            const res = await fetch("/api/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: newUser.name,
                    email: newUser.email,
                    role: newUser.role,
                    orgLevel: newUser.orgLevel,
                    clickupUserId: newUser.clickupUserId || undefined,
                    teamCapsule:
                        teamCapsuleSelectionKeyToName(newUser.teamCapsuleKey, teamCapsuleCatalog) ??
                        undefined,
                    managerId: newUser.managerId ? parseInt(newUser.managerId) : undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || "Failed to add user");
            } else {
                setShowAddUser(false);
                setNewUser({
                    name: "",
                    email: "",
                    role: "member",
                    orgLevel: "member",
                    clickupUserId: "",
                    teamCapsuleKey: "",
                    managerId: "",
                });
                // Refresh users
                const fresh = await fetch("/api/users?all=true").then(r => r.json());
                setUsers(Array.isArray(fresh) ? fresh : fresh.users || []);
            }
        } catch { alert("Failed to add user"); }
        setAddingUser(false);
    };

    const handleDeleteUser = async (userId: number) => {
        setDeletingUserId(userId);
        try {
            const res = await fetch("/api/users", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: userId }),
            });
            if (res.ok) {
                const fresh = await fetch("/api/users?all=true").then(r => r.json());
                setUsers(Array.isArray(fresh) ? fresh : fresh.users || []);
            }
        } catch { }
        setDeletingUserId(null);
        setConfirmDeleteId(null);
    };

    return (
        <div className="p-6 mx-auto space-y-6">
            <div className="max-w-7xl">
                <h1 className="text-3xl font-bold text-white">Admin</h1>
                <p className="text-slate-400 text-sm mt-1">Manage sync settings and users</p>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-[#12122a] border border-white/5 rounded-2xl p-1 w-fit flex-wrap">
                {adminTabs.map((tab) => (
                    <button
                        key={tab}
                        onClick={() => {
                            setActiveTab(tab);
                            if (tab === "ytviews" && ytVideos.length === 0) {
                                fetch("/api/admin/yt-views")
                                    .then((r) => r.json())
                                    .then((data) => {
                                        if (Array.isArray(data)) setYtVideos(data);
                                    })
                                    .catch(() => {});
                            }
                            if (tab === "permissions" && permUsers.length === 0) {
                                setPermLoading(true);
                                fetch("/api/admin/permissions")
                                    .then((r) => r.json())
                                    .then((data) => {
                                        if (Array.isArray(data.users)) setPermUsers(data.users);
                                        if (Array.isArray(data.managers)) setPermManagers(data.managers);
                                    })
                                    .catch(() => {})
                                    .finally(() => setPermLoading(false));
                            }
                        }}
                        className={`px-5 py-2 rounded-xl text-sm font-medium transition-all capitalize ${activeTab === tab ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"}`}
                    >
                        {tab === "workspaces"
                            ? "Workspaces & Sync"
                            : tab === "users"
                              ? "Users"
                              : tab === "ytviews"
                                ? "YT Views"
                                : tab === "reports"
                                  ? "Reports"
                                  : tab === "crons"
                                    ? "Crons"
                                    : "Permissions"}
                    </button>
                ))}
            </div>

            {activeTab === "workspaces" && (
                <div className="max-w-7xl">
                    {/* Sync Actions */}
                    <div className="rounded-2xl bg-[#12122a] border border-white/5 p-5">
                        <h2 className="text-sm font-semibold text-white mb-4">Sync Actions</h2>
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                            {[
                                { key: "all", label: "Full Sync", icon: "⚡" },
                                { key: "clickup", label: "Sync ClickUp", icon: "📥" },
                                { key: "youtube", label: "Sync YouTube", icon: "▶️" },
                                { key: "ratings", label: "Sync Ratings", icon: "⭐" },
                            ].map(({ key, label, icon }) => (
                                <div key={key} className="flex flex-col items-center gap-1.5">
                                    <button onClick={() => runSync(key)} disabled={!!syncing}
                                        className={`w-full flex items-center gap-2 justify-center px-4 py-2.5 rounded-xl border text-sm text-white transition-all disabled:opacity-50 ${syncDone === key ? "bg-green-600/20 border-green-500/30 text-green-400" : "bg-white/5 hover:bg-violet-600/20 border-white/10 hover:border-violet-500/30"}`}>
                                        <span>{icon}</span>
                                        {syncing === key ? "Syncing..." : syncDone === key ? "✓ Done" : label}
                                    </button>
                                    {lastSyncs[key] && (
                                        <span className="text-[10px] text-slate-600">{formatSyncTime(lastSyncs[key])}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Workspace Selector */}
                    <div className="rounded-2xl bg-[#12122a] border border-white/5 overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
                            <div>
                                <h2 className="text-sm font-semibold text-white">Select Lists to Sync</h2>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    {selectedLists.size} list{selectedLists.size !== 1 ? "s" : ""} selected — click a space to expand
                                </p>
                            </div>
                            <button onClick={saveSelection} disabled={saving}
                                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${saved ? "bg-green-600 text-white" : "bg-violet-600 hover:bg-violet-500 text-white"} disabled:opacity-50`}>
                                {saving ? "Saving..." : saved ? "✓ Saved!" : "Save Selection"}
                            </button>
                        </div>

                        {loading ? (
                            <div className="p-10 text-center text-slate-500 text-sm animate-pulse">Loading spaces from ClickUp...</div>
                        ) : error ? (
                            <div className="p-10 text-center text-red-400 text-sm">{error}</div>
                        ) : spaces.length === 0 ? (
                            <div className="p-10 text-center text-slate-500 text-sm">No spaces found in your ClickUp workspace.</div>
                        ) : (
                            <div className="divide-y divide-white/[0.03]">
                                {spaces.map(space => (
                                    <div key={space.id}>
                                        {/* Space row */}
                                        {(() => {
                                            const allListIds = space.detail
                                                ? [...space.detail.folders.flatMap(f => f.lists.map(l => l.id)), ...space.detail.folderlessLists.map(l => l.id)]
                                                : [];
                                            const selectedCount = allListIds.filter(id => selectedLists.has(id)).length;
                                            return (
                                                <button onClick={() => toggleSpace(space.id)}
                                                    className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-white/[0.02] transition-colors text-left">
                                                    <span className="text-slate-500 text-xs w-3">{expandedSpaces.has(space.id) ? "▼" : "▶"}</span>
                                                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${selectedCount > 0 ? "bg-emerald-500" : "bg-violet-500"}`} />
                                                    <span className="text-white font-medium text-sm flex-1">{space.name}</span>
                                                    {selectedCount > 0 && (
                                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 font-medium">
                                                            {selectedCount} selected
                                                        </span>
                                                    )}
                                                    {space.loading && <span className="text-slate-500 text-xs animate-pulse">Loading...</span>}
                                                </button>
                                            );
                                        })()}

                                        {/* Space detail */}
                                        {expandedSpaces.has(space.id) && space.detail && (
                                            <div className="bg-[#0e0e24] border-t border-white/[0.03]">
                                                {space.detail.folders.map(folder => {
                                                    const allSelected = folder.lists.every(l => selectedLists.has(l.id));
                                                    return (
                                                        <div key={folder.id} className="px-8 py-3 border-b border-white/[0.02]">
                                                            <div className="flex items-center gap-2 mb-2">
                                                                <span className="text-amber-400 text-xs">📁</span>
                                                                <span className="text-slate-300 text-xs font-medium flex-1">{folder.name}</span>
                                                                <button onClick={() => toggleAllInFolder(folder.lists, !allSelected)}
                                                                    className="text-[10px] text-violet-400 hover:text-violet-300 transition-colors">
                                                                    {allSelected ? "Deselect all" : "Select all"}
                                                                </button>
                                                            </div>
                                                            <div className="space-y-1 pl-5">
                                                                {folder.lists.map(list => (
                                                                    <label key={list.id} className="flex items-center gap-3 py-1 cursor-pointer hover:bg-white/[0.02] rounded-lg px-2 transition-colors">
                                                                        <input type="checkbox" checked={selectedLists.has(list.id)} onChange={() => toggleList(list.id)}
                                                                            className="accent-violet-500 w-3.5 h-3.5 flex-shrink-0" />
                                                                        <span className="text-slate-300 text-xs flex-1">{list.name}</span>
                                                                        {list.taskCount > 0 && <span className="text-slate-600 text-[10px]">{list.taskCount} tasks</span>}
                                                                    </label>
                                                                ))}
                                                                {folder.lists.length === 0 && <p className="text-slate-600 text-xs py-1">No lists in this folder</p>}
                                                            </div>
                                                        </div>
                                                    );
                                                })}

                                                {space.detail.folderlessLists.length > 0 && (
                                                    <div className="px-8 py-3">
                                                        <p className="text-slate-500 text-[10px] uppercase tracking-wider mb-2">Folderless Lists</p>
                                                        <div className="space-y-1">
                                                            {space.detail.folderlessLists.map(list => (
                                                                <label key={list.id} className="flex items-center gap-3 py-1 cursor-pointer hover:bg-white/[0.02] rounded-lg px-2 transition-colors">
                                                                    <input type="checkbox" checked={selectedLists.has(list.id)} onChange={() => toggleList(list.id)}
                                                                        className="accent-violet-500 w-3.5 h-3.5 flex-shrink-0" />
                                                                    <span className="text-slate-300 text-xs flex-1">{list.name}</span>
                                                                    {list.taskCount > 0 && <span className="text-slate-600 text-[10px]">{list.taskCount} tasks</span>}
                                                                </label>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {space.detail.folders.length === 0 && space.detail.folderlessLists.length === 0 && (
                                                    <div className="px-8 py-4 text-slate-600 text-xs">No lists found in this space.</div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === "users" && (
                <div className="rounded-2xl bg-[#12122a] border border-white/5 overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
                        <div>
                            <h2 className="text-sm font-semibold text-white">Users ({users.length})</h2>
                            <p className="text-xs text-slate-500 mt-0.5">Manage roles, org levels, and team hierarchy</p>
                        </div>
                        <div className="flex items-center gap-3">
                            {canManageUsers && userView === "table" && (
                                <button onClick={() => setShowAddUser(true)}
                                    className="flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all bg-emerald-600 hover:bg-emerald-500 border-emerald-500/30 text-white">
                                    + Add User
                                </button>
                            )}
                            {/* Tree/Table toggle */}
                            <div className="flex bg-white/5 border border-white/10 rounded-lg p-0.5">
                                <button onClick={() => setUserView("tree")}
                                    className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${userView === "tree" ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"}`}>
                                    🌳 Tree
                                </button>
                                <button onClick={() => setUserView("table")}
                                    className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${userView === "table" ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"}`}>
                                    📋 Table
                                </button>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                                <button onClick={() => runSync("users")} disabled={!!syncing}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all disabled:opacity-50 ${syncDone === "users" ? "bg-green-600/20 border-green-500/30 text-green-400" : "bg-violet-600 hover:bg-violet-500 border-violet-500/30 text-white"}`}>
                                    <span>👥</span>
                                    {syncing === "users" ? "Syncing..." : syncDone === "users" ? "✓ Done" : "Sync ClickUp Users"}
                                </button>
                                {lastSyncs["users"] && (
                                    <span className="text-[10px] text-slate-600">{formatSyncTime(lastSyncs["users"])}</span>
                                )}
                            </div>
                        </div>
                    </div>
                    {usersLoading ? (
                        <div className="p-10 text-center text-slate-500 text-sm animate-pulse">Loading users...</div>
                    ) : userView === "tree" ? (
                        <OrgTree
                            users={users}
                            onUserUpdate={async (userId, data) => {
                                const patchRes = await fetch(`/api/admin/users/${userId}`, {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify(data),
                                });
                                if (!patchRes.ok) {
                                    const err = await patchRes.json().catch(() => ({}));
                                    throw new Error((err as { error?: string }).error || `Save failed (${patchRes.status})`);
                                }
                                const res = await fetch("/api/users?all=true");
                                const freshUsers = await res.json();
                                if (Array.isArray(freshUsers)) setUsers(freshUsers);
                            }}
                        />
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-white/5">
                                        <th className="w-10 px-5 py-3"></th>
                                        <th className="text-left px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500">Name</th>
                                        <th className="text-left px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500">Org Level</th>
                                        <th className="text-left px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500">Role</th>
                                        <th className="text-left px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500">Manager</th>
                                        <th className="text-center px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500">Status</th>
                                        <th className="text-center px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.map((user: any) => {
                                        const managers = users.filter((u: any) =>
                                            ["ceo", "special_access", "hod", "manager", "hr_manager", "lead", "sub_lead"].includes(u.orgLevel || "member") ||
                                            u.role === "production_manager" ||
                                            u.role === "researcher_manager"
                                        );
                                        return (
                                            <tr key={user.id} className="border-b border-white/[0.02] hover:bg-white/[0.02]">
                                                <td className="px-5 py-3">
                                                    <UserAvatar
                                                        name={user.name}
                                                        src={user.profilePictureUrl}
                                                        size="sm"
                                                        rounded="full"
                                                        gradient="from-violet-600 to-violet-400"
                                                        className="ring-2 ring-white/10"
                                                    />
                                                </td>
                                                <td className="px-3 py-3">
                                                    <span className="text-white text-xs font-medium">{user.name}</span>
                                                    <span className="block text-[10px] text-slate-500">{user.email}</span>
                                                </td>
                                                <td className="px-3 py-3">
                                                    <select
                                                        value={user.orgLevel || "member"}
                                                        onChange={(e) => {
                                                            const updated = users.map((u: any) =>
                                                                u.id === user.id ? { ...u, orgLevel: e.target.value, _dirty: true } : u
                                                            );
                                                            setUsers(updated);
                                                        }}
                                                        className="px-2 py-1 bg-white/5 border border-white/10 rounded-lg text-[11px] text-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                                                    >
                                                        <option value="ceo">CEO</option>
                                                        <option value="special_access">Special Access</option>
                                                        <option value="hod">HOD</option>
                                                        <option value="manager">Manager</option>
                                                        <option value="hr_manager">HR</option>
                                                        <option value="lead">Lead</option>
                                                        <option value="sub_lead">Sub Lead</option>
                                                        <option value="production_team">Production Team</option>
                                                        <option value="member">Member (No Access)</option>
                                                    </select>
                                                </td>
                                                <td className="px-3 py-3">
                                                    <select
                                                        value={user.role || "member"}
                                                        onChange={(e) => {
                                                            const updated = users.map((u: any) =>
                                                                u.id === user.id ? { ...u, role: e.target.value, _dirty: true } : u
                                                            );
                                                            setUsers(updated);
                                                        }}
                                                        className="px-2 py-1 bg-white/5 border border-white/10 rounded-lg text-[11px] text-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                                                    >
                                                        {USER_ROLE_OPTIONS.map((o) => (
                                                            <option key={o.value} value={o.value}>{o.label}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td className="px-3 py-3">
                                                    <select
                                                        value={user.managerId || ""}
                                                        onChange={(e) => {
                                                            const updated = users.map((u: any) =>
                                                                u.id === user.id ? { ...u, managerId: e.target.value ? parseInt(e.target.value) : null, _dirty: true } : u
                                                            );
                                                            setUsers(updated);
                                                        }}
                                                        className="px-2 py-1 bg-white/5 border border-white/10 rounded-lg text-[11px] text-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                                                    >
                                                        <option value="">No Manager</option>
                                                        {managers.filter((m: any) => m.id !== user.id).map((m: any) => (
                                                            <option key={m.id} value={m.id}>{m.name} ({m.orgLevel})</option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td className="px-3 py-3 text-center">
                                                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${user.isActive ? "bg-green-500/10 text-green-400" : "bg-slate-500/10 text-slate-500"}`}>
                                                        {user.isActive ? "Active" : "Inactive"}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-3 text-center">
                                                    <div className="flex items-center justify-center gap-2">
                                                        {user._dirty && (
                                                            <button
                                                                onClick={async () => {
                                                                    try {
                                                                        await fetch(`/api/admin/users/${user.id}`, {
                                                                            method: "PATCH",
                                                                            headers: { "Content-Type": "application/json" },
                                                                            body: JSON.stringify({
                                                                                role: user.role,
                                                                                orgLevel: user.orgLevel,
                                                                                managerId: user.managerId || null,
                                                                            }),
                                                                        });
                                                                        const updated = users.map((u: any) =>
                                                                            u.id === user.id ? { ...u, _dirty: false } : u
                                                                        );
                                                                        setUsers(updated);
                                                                    } catch { }
                                                                }}
                                                                className="px-3 py-1 bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-medium rounded-lg transition-all"
                                                            >
                                                                Save
                                                            </button>
                                                        )}
                                                        {canManageUsers && user.isActive && (
                                                            confirmDeleteId === user.id ? (
                                                                <div className="flex items-center gap-1">
                                                                    <button
                                                                        onClick={() => handleDeleteUser(user.id)}
                                                                        disabled={deletingUserId === user.id}
                                                                        className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white text-[10px] font-medium rounded-lg transition-all disabled:opacity-50"
                                                                    >
                                                                        {deletingUserId === user.id ? "..." : "Confirm"}
                                                                    </button>
                                                                    <button
                                                                        onClick={() => setConfirmDeleteId(null)}
                                                                        className="px-2 py-1 bg-white/10 hover:bg-white/20 text-slate-300 text-[10px] font-medium rounded-lg transition-all"
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <button
                                                                    onClick={() => setConfirmDeleteId(user.id)}
                                                                    className="px-2 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-[10px] font-medium rounded-lg transition-all"
                                                                >
                                                                    Delete
                                                                </button>
                                                            )
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {users.length === 0 && (
                                        <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-500 text-sm">No users yet — click Sync ClickUp Users</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {canManageUsers && (
                        <div className="border-t border-white/5">
                            <div className="px-5 py-4 flex items-center justify-between">
                                <div>
                                    <h3 className="text-sm font-semibold text-white">ClickUp users not in HR ({unmatchedClickup.length})</h3>
                                    <p className="text-xs text-slate-500 mt-0.5">Seen in ClickUp sync but no matching HR user by email. Onboard creates an HR record and links the ClickUp ID.</p>
                                </div>
                            </div>
                            {unmatchedLoading ? (
                                <div className="px-5 py-6 text-center text-slate-500 text-sm animate-pulse">Loading…</div>
                            ) : unmatchedClickup.length === 0 ? (
                                <div className="px-5 py-6 text-center text-slate-500 text-sm">All ClickUp users are matched to HR.</div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-y border-white/5">
                                                <th className="text-left px-5 py-2 text-[11px] uppercase tracking-wider text-slate-500">Name</th>
                                                <th className="text-left px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500">Email</th>
                                                <th className="text-left px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500">ClickUp ID</th>
                                                <th className="text-left px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500">Last seen</th>
                                                <th className="text-right px-5 py-2 text-[11px] uppercase tracking-wider text-slate-500">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {unmatchedClickup.map((u: any) => (
                                                <tr key={u.id} className="border-b border-white/5 hover:bg-white/5">
                                                    <td className="px-5 py-2 text-slate-200">{u.name || "—"}</td>
                                                    <td className="px-3 py-2 text-slate-400">{u.email}</td>
                                                    <td className="px-3 py-2 text-slate-500 font-mono text-[11px]">{u.clickupUserId}</td>
                                                    <td className="px-3 py-2 text-slate-500 text-[11px]">{u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : "—"}</td>
                                                    <td className="px-5 py-2">
                                                        <div className="flex items-center justify-end gap-2">
                                                            <button
                                                                onClick={() => handleOnboardUnmatched(u.id)}
                                                                disabled={unmatchedBusyId === u.id}
                                                                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium rounded-lg transition-all disabled:opacity-50">
                                                                {unmatchedBusyId === u.id ? "…" : "Onboard to HR"}
                                                            </button>
                                                            <button
                                                                onClick={() => handleDismissUnmatched(u.id)}
                                                                disabled={unmatchedBusyId === u.id}
                                                                className="px-2 py-1 bg-white/5 hover:bg-white/10 text-slate-300 text-[11px] font-medium rounded-lg transition-all disabled:opacity-50">
                                                                Dismiss
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Add User Modal */}
            {showAddUser && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowAddUser(false)}>
                    <div className="bg-[#12122a] border border-white/10 rounded-2xl p-6 w-full max-w-lg space-y-4" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold text-white">Add New User</h3>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2 sm:col-span-1">
                                <label className="text-[11px] text-slate-400 mb-1 block">Name *</label>
                                <input type="text" value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))}
                                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                                    placeholder="Full name" />
                            </div>
                            <div className="col-span-2 sm:col-span-1">
                                <label className="text-[11px] text-slate-400 mb-1 block">Email *</label>
                                <input type="email" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))}
                                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                                    placeholder="email@example.com" />
                            </div>
                            <div>
                                <label className="text-[11px] text-slate-400 mb-1 block">Role</label>
                                <select value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}
                                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500/40">
                                    {USER_ROLE_OPTIONS.map((o) => (
                                        <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-[11px] text-slate-400 mb-1 block">Org Level</label>
                                <select value={newUser.orgLevel} onChange={e => setNewUser(p => ({ ...p, orgLevel: e.target.value }))}
                                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500/40">
                                    <option value="member">Member</option>
                                    <option value="production_team">Production Team</option>
                                    <option value="sub_lead">Sub Lead</option>
                                    <option value="lead">Lead</option>
                                    <option value="hr_manager">HR</option>
                                    <option value="manager">Manager</option>
                                    <option value="hod">HOD</option>
                                    <option value="special_access">Special Access</option>
                                    <option value="ceo">CEO</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-[11px] text-slate-400 mb-1 block">Team / production list</label>
                                <select
                                    value={newUser.teamCapsuleKey}
                                    onChange={(e) => setNewUser((p) => ({ ...p, teamCapsuleKey: e.target.value }))}
                                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                                >
                                    <option value="">— Not set —</option>
                                    {teamCapsuleCatalog && teamCapsuleCatalog.productionLists.length > 0 && (
                                        <optgroup label="Production lists">
                                            {teamCapsuleCatalog.productionLists.map((pl) => {
                                                const capLabel =
                                                    pl.capsule?.shortName || pl.capsule?.name || pl.name;
                                                return (
                                                    <option key={`nl-${pl.id}`} value={`l:${pl.id}`}>
                                                        {capLabel} — {pl.name}
                                                    </option>
                                                );
                                            })}
                                        </optgroup>
                                    )}
                                    {teamCapsuleCatalog && teamCapsuleCatalog.capsules.length > 0 && (
                                        <optgroup label="Whole capsule">
                                            {teamCapsuleCatalog.capsules.map((c) => (
                                                <option key={`nc-${c.id}`} value={`c:${c.id}`}>
                                                    All lists — {c.shortName || c.name}
                                                </option>
                                            ))}
                                        </optgroup>
                                    )}
                                </select>
                            </div>
                            <div>
                                <label className="text-[11px] text-slate-400 mb-1 block">Manager</label>
                                <select value={newUser.managerId} onChange={e => setNewUser(p => ({ ...p, managerId: e.target.value }))}
                                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-500/40">
                                    <option value="">No Manager</option>
                                    {users.filter((u: any) => ["ceo", "special_access", "hod", "manager", "hr_manager", "lead", "sub_lead"].includes(u.orgLevel || "member")).map((m: any) => (
                                        <option key={m.id} value={m.id}>{m.name} ({m.orgLevel})</option>
                                    ))}
                                </select>
                            </div>
                            <div className="col-span-2">
                                <label className="text-[11px] text-slate-400 mb-1 block">ClickUp User ID (optional)</label>
                                <input type="text" value={newUser.clickupUserId} onChange={e => setNewUser(p => ({ ...p, clickupUserId: e.target.value }))}
                                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                                    placeholder="Leave empty — auto-linked when user appears in ClickUp sync" />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 pt-2">
                            <button onClick={() => setShowAddUser(false)}
                                className="px-4 py-2 rounded-xl text-sm text-slate-400 hover:text-white transition-all">
                                Cancel
                            </button>
                            <button onClick={handleAddUser} disabled={addingUser || !newUser.name || !newUser.email}
                                className="px-5 py-2 rounded-xl text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-all disabled:opacity-50">
                                {addingUser ? "Adding..." : "Add User"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === "ytviews" && (
                <div className="max-w-7xl space-y-5">
                    {/* Fetch Form */}
                    {/* API Mode Toggle + Fetch Form */}
                    <div className="rounded-2xl bg-[#12122a] border border-white/5 p-5">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-sm font-semibold text-white">Fetch YouTube Video Views</h2>
                            <div className="flex items-center gap-3">
                                {ytChannelCount > 0 && (
                                    <span className="text-[10px] text-slate-500">{ytChannelCount} channel{ytChannelCount > 1 ? 's' : ''} configured</span>
                                )}
                                <div className="flex items-center bg-[#1a1a2e] border border-white/10 rounded-xl overflow-hidden">
                                    <button
                                        onClick={async () => {
                                            setYtApiMode("data_api");
                                            await fetch("/api/admin/yt-settings", {
                                                method: "POST",
                                                headers: { "Content-Type": "application/json" },
                                                body: JSON.stringify({ mode: "data_api" }),
                                            });
                                        }}
                                        className={`px-3 py-1.5 text-[11px] font-medium transition-all ${ytApiMode === "data_api"
                                            ? "bg-violet-500/20 text-violet-300 border-r border-violet-500/30"
                                            : "text-slate-500 hover:text-slate-300 border-r border-white/5"
                                            }`}
                                    >
                                        Data API
                                    </button>
                                    <button
                                        onClick={async () => {
                                            setYtApiMode("analytics_api");
                                            await fetch("/api/admin/yt-settings", {
                                                method: "POST",
                                                headers: { "Content-Type": "application/json" },
                                                body: JSON.stringify({ mode: "analytics_api" }),
                                            });
                                        }}
                                        className={`px-3 py-1.5 text-[11px] font-medium transition-all ${ytApiMode === "analytics_api"
                                            ? "bg-emerald-500/20 text-emerald-300"
                                            : "text-slate-500 hover:text-slate-300"
                                            }`}
                                    >
                                        Analytics API
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <input
                                type="text"
                                value={ytUrl}
                                onChange={(e) => { setYtUrl(e.target.value); setYtError(null); }}
                                placeholder="Paste YouTube video URL here..."
                                className="flex-1 px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                            />
                            <button
                                onClick={async () => {
                                    if (!ytUrl.trim()) return;
                                    setYtFetching(true);
                                    setYtError(null);
                                    try {
                                        const res = await fetch("/api/admin/yt-views", {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ url: ytUrl.trim() }),
                                        });
                                        const data = await res.json();
                                        if (data.error) {
                                            setYtError(data.error);
                                        } else {
                                            setYtUrl("");
                                            // Refresh the list
                                            const list = await fetch("/api/admin/yt-views").then(r => r.json());
                                            if (Array.isArray(list)) setYtVideos(list);
                                        }
                                    } catch { setYtError("Failed to fetch"); }
                                    setYtFetching(false);
                                }}
                                disabled={ytFetching || !ytUrl.trim()}
                                className="px-6 py-2.5 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-xl transition-all disabled:opacity-50"
                            >
                                {ytFetching ? "Fetching..." : "▶ Fetch"}
                            </button>
                        </div>
                        {ytError && <p className="text-red-400 text-xs mt-2">{ytError}</p>}
                    </div>

                    {/* Results Table */}
                    <div className="rounded-2xl bg-[#12122a] border border-white/5 overflow-hidden">
                        <div className="px-5 py-4 border-b border-white/5">
                            <h2 className="text-sm font-semibold text-white">Fetched Videos ({ytVideos.length})</h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-white/[0.06]">
                                        <th className="text-left pl-5 pr-3 py-3 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Title</th>
                                        <th className="text-right px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Views</th>
                                        <th className="text-right px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">First 30 Days</th>
                                        <th className="text-right px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Published</th>
                                        <th className="text-right pr-5 pl-3 py-3 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Fetched</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ytVideos.map((v: any) => (
                                        <tr key={v.id} className="border-b border-white/[0.03] hover:bg-white/[0.03]">
                                            <td className="pl-5 pr-3 py-3">
                                                <a href={v.videoUrl} target="_blank" rel="noopener noreferrer" className="text-white text-xs font-medium hover:text-violet-400 transition-colors line-clamp-1 block max-w-[320px]">
                                                    {v.title}
                                                </a>
                                            </td>
                                            <td className="px-3 py-3 text-right text-white font-mono text-xs font-semibold">
                                                {Number(v.viewCount).toLocaleString()}
                                            </td>
                                            <td className="px-3 py-3 text-right text-slate-400 font-mono text-xs">
                                                —
                                            </td>
                                            <td className="px-3 py-3 text-right text-slate-400 text-xs">
                                                {v.publishedAt ? new Date(v.publishedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                                            </td>
                                            <td className="pr-5 pl-3 py-3 text-right text-slate-500 text-[11px]">
                                                {new Date(v.fetchedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                                            </td>
                                        </tr>
                                    ))}
                                    {ytVideos.length === 0 && (
                                        <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-500 text-sm">No videos fetched yet — paste a YouTube URL above</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === "reports" && (
                <div className="max-w-7xl">
                    <div className="rounded-2xl bg-[#12122a] border border-white/5 overflow-hidden">
                        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
                            <h2 className="text-sm font-semibold text-white">Weekly Report Submissions</h2>
                            <div className="flex items-center gap-3">
                                <button
                                    disabled={syncingReports}
                                    onClick={async () => {
                                        setSyncingReports(true);
                                        setSyncReportsDone(false);
                                        try {
                                            await fetch("/api/admin/reports/sync-all", { method: "POST" });
                                            setSyncReportsDone(true);
                                            setTimeout(() => setSyncReportsDone(false), 4000);
                                            setReportsLoading(true);
                                            setReports([]);
                                            fetch("/api/admin/reports")
                                                .then(r => r.json())
                                                .then(d => { setReports(Array.isArray(d) ? d : []); setReportsLoading(false); })
                                                .catch(() => setReportsLoading(false));
                                        } catch { }
                                        setSyncingReports(false);
                                    }}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-60 ${syncReportsDone ? "bg-emerald-600/20 text-emerald-400 border border-emerald-500/30" : "bg-violet-600/20 hover:bg-violet-600/30 text-violet-400 border border-violet-500/20"}`}>
                                    <span>{syncingReports ? "⏳" : syncReportsDone ? "✅" : "📊"}</span>
                                    {syncingReports ? "Syncing…" : syncReportsDone ? "Synced!" : "Sync Reports Data"}
                                </button>
                                <button
                                    onClick={() => { setReports([]); setReportsLoading(true); fetch("/api/admin/reports").then(r => r.json()).then(d => { setReports(Array.isArray(d) ? d : []); setReportsLoading(false); }).catch(() => setReportsLoading(false)); }}
                                    className="text-xs text-slate-400 hover:text-white transition-colors"
                                >
                                    Refresh
                                </button>
                            </div>
                        </div>
                        {reportsLoading ? (
                            <div className="px-5 py-10 text-center text-slate-500 text-sm">Loading reports…</div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-white/[0.06]">
                                        <th className="text-left pl-5 pr-3 py-3 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Manager</th>
                                        <th className="text-left px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Period</th>
                                        <th className="text-left px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Submitted At</th>
                                        <th className="text-center px-3 py-3 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Status</th>
                                        <th className="text-right pr-5 pl-3 py-3 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {reports.length === 0 ? (
                                        <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-500 text-sm">No reports submitted yet</td></tr>
                                    ) : reports.map(r => (
                                        <tr key={r.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                                            <td className="pl-5 pr-3 py-3 text-white font-medium text-xs">{r.managerName}</td>
                                            <td className="px-3 py-3 text-xs">
                                                <span className={`font-medium ${r.isMonthly ? "text-violet-300" : "text-slate-300"}`}>{r.period}</span>
                                            </td>
                                            <td className="px-3 py-3 text-slate-400 text-xs">
                                                {new Date(r.submittedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                                                {" · "}
                                                {new Date(r.submittedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                                            </td>
                                            <td className="px-3 py-3 text-center">
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${r.isLocked ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
                                                    {r.isLocked ? "✓ Submitted" : "Draft"}
                                                </span>
                                            </td>
                                            <td className="pr-5 pl-3 py-3 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <a
                                                        href={r.viewUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600/20 hover:bg-violet-600/30 text-violet-400 transition-colors"
                                                    >
                                                        View
                                                    </a>
                                                    {!r.isMonthly && (
                                                        <button
                                                            onClick={() => refreshReportFromDb(r)}
                                                            disabled={refreshingReportId === r.id}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${refreshedReportId === r.id ? "bg-green-600/20 text-green-400" : "bg-sky-600/20 hover:bg-sky-600/30 text-sky-400"}`}
                                                        >
                                                            {refreshingReportId === r.id ? "…" : refreshedReportId === r.id ? "✓ Done" : "Refresh DB"}
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => toggleReportLock(r.id, r.isLocked, r.isMonthly)}
                                                        disabled={togglingReport === `${r.id}-${r.isMonthly ? "monthly" : "weekly"}`}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${r.isLocked ? "bg-amber-600/20 hover:bg-amber-600/30 text-amber-400" : "bg-red-600/20 hover:bg-red-600/30 text-red-400"} disabled:opacity-50`}
                                                    >
                                                        {togglingReport === `${r.id}-${r.isMonthly ? "monthly" : "weekly"}` ? "…" : r.isLocked ? "Unlock" : "Lock"}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

            {activeTab === "crons" && canManageUsers && (
                <div className="max-w-7xl space-y-4">
                    {cronInternalOff && (
                        <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                            Internal scheduler is disabled on this server (<code className="text-xs opacity-90">DISABLE_INTERNAL_CRON_SCHEDULER=true</code>). Stored
                            settings still apply if you use an external cron calling{" "}
                            <code className="text-xs bg-black/20 px-1 rounded">/api/cron/youtube-dashboard-sync</code>.
                        </div>
                    )}
                    {cronServerNote && (
                        <p className="text-xs text-slate-500 leading-relaxed max-w-3xl">{cronServerNote}</p>
                    )}
                    {cronBanner && (
                        <div
                            className={`rounded-xl px-4 py-2 text-sm ${cronBanner.type === "ok" ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25" : "bg-red-500/15 text-red-300 border border-red-500/25"}`}
                        >
                            {cronBanner.text}
                        </div>
                    )}

                    <div className="rounded-2xl bg-[#12122a] border border-white/5 p-5">
                        {cronLoading ? (
                            <div className="py-10 text-center text-slate-500 text-sm animate-pulse">Loading cron jobs…</div>
                        ) : !youtubeCron ? (
                            <p className="text-slate-500 text-sm">No cron jobs configured.</p>
                        ) : (
                            <div className="space-y-5">
                                <div>
                                    <h2 className="text-sm font-semibold text-white">{youtubeCron.name}</h2>
                                    <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">{youtubeCron.description}</p>
                                </div>

                                <label className="flex items-center gap-3 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={cronEnabledDraft}
                                        onChange={(e) => setCronEnabledDraft(e.target.checked)}
                                        className="accent-violet-500 w-4 h-4 rounded"
                                    />
                                    <span className="text-sm text-slate-200">Auto-fetch on interval (when the Node server scheduler is running)</span>
                                </label>

                                <div className="flex flex-wrap items-end gap-4">
                                    <div>
                                        <label className="block text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Every (hours)</label>
                                        <input
                                            type="number"
                                            min={1}
                                            max={168}
                                            value={cronHoursDraft}
                                            onChange={(e) => setCronHoursDraft(e.target.value)}
                                            className="w-28 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                                        />
                                        <p className="text-[10px] text-slate-600 mt-1">1–168 hours between automatic runs</p>
                                    </div>
                                    <button
                                        type="button"
                                        disabled={cronSaving}
                                        onClick={async () => {
                                            const h = Math.min(168, Math.max(1, Math.floor(Number(cronHoursDraft)) || 5));
                                            setCronHoursDraft(String(h));
                                            setCronSaving(true);
                                            setCronBanner(null);
                                            try {
                                                const res = await fetch("/api/admin/cron-jobs", {
                                                    method: "PATCH",
                                                    headers: { "Content-Type": "application/json" },
                                                    body: JSON.stringify({
                                                        youtube_dashboard: { enabled: cronEnabledDraft, intervalHours: h },
                                                    }),
                                                });
                                                const data = await res.json();
                                                if (!res.ok) {
                                                    setCronBanner({ type: "err", text: data.error || "Save failed" });
                                                    return;
                                                }
                                                const y = data.youtube_dashboard;
                                                if (y) {
                                                    setYoutubeCron((prev) =>
                                                        prev
                                                            ? {
                                                                  ...prev,
                                                                  enabled: !!y.enabled,
                                                                  intervalHours: Number(y.intervalHours) || h,
                                                                  lastAutoRunAt: y.lastAutoRunAt ?? prev.lastAutoRunAt,
                                                                  lastManualRunAt: y.lastManualRunAt ?? prev.lastManualRunAt,
                                                              }
                                                            : prev,
                                                    );
                                                    setCronEnabledDraft(!!y.enabled);
                                                    setCronHoursDraft(String(Math.min(168, Math.max(1, Math.floor(Number(y.intervalHours)) || h))));
                                                }
                                                setCronBanner({ type: "ok", text: "Settings saved." });
                                                setTimeout(() => setCronBanner(null), 4000);
                                            } catch {
                                                setCronBanner({ type: "err", text: "Save failed" });
                                            } finally {
                                                setCronSaving(false);
                                            }
                                        }}
                                        className="px-5 py-2 rounded-xl text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white transition-all disabled:opacity-50"
                                    >
                                        {cronSaving ? "Saving…" : "Save settings"}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={cronRunLoading}
                                        onClick={async () => {
                                            setCronRunLoading(true);
                                            setCronBanner(null);
                                            try {
                                                const res = await fetch("/api/admin/cron-jobs/youtube-dashboard/run", { method: "POST" });
                                                const data = await res.json();
                                                if (!res.ok) {
                                                    setCronBanner({ type: "err", text: data.error || "Run failed" });
                                                    return;
                                                }
                                                setCronBanner({ type: "ok", text: "YouTube dashboard sync finished." });
                                                setTimeout(() => setCronBanner(null), 5000);
                                                const r2 = await fetch("/api/admin/cron-jobs");
                                                const d2 = await r2.json();
                                                const job = (d2.jobs as any[] | undefined)?.find((j) => j?.id === "youtube_dashboard");
                                                if (job) {
                                                    setYoutubeCron((prev) =>
                                                        prev
                                                            ? {
                                                                  ...prev,
                                                                  lastManualRunAt: job.lastManualRunAt ?? prev.lastManualRunAt,
                                                                  lastAutoRunAt: job.lastAutoRunAt ?? prev.lastAutoRunAt,
                                                              }
                                                            : prev,
                                                    );
                                                }
                                            } catch {
                                                setCronBanner({ type: "err", text: "Run failed" });
                                            } finally {
                                                setCronRunLoading(false);
                                            }
                                        }}
                                        className="px-5 py-2 rounded-xl text-sm font-medium bg-white/10 hover:bg-white/15 border border-white/10 text-white transition-all disabled:opacity-50"
                                    >
                                        {cronRunLoading ? "Running…" : "Run now (manual)"}
                                    </button>
                                </div>

                                <div className="flex flex-wrap gap-6 text-xs text-slate-500 pt-2 border-t border-white/[0.06]">
                                    <span>
                                        Last auto run:{" "}
                                        <strong className="text-slate-300">{formatSyncTime(youtubeCron.lastAutoRunAt) ?? "—"}</strong>
                                    </span>
                                    <span>
                                        Last manual run:{" "}
                                        <strong className="text-slate-300">{formatSyncTime(youtubeCron.lastManualRunAt) ?? "—"}</strong>
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Permissions Tab ── */}
            {activeTab === "permissions" && (
                <div className="max-w-7xl space-y-6">
                    {/* Header */}
                    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-5">
                            <div className="flex-1">
                                <h2 className="text-sm font-semibold text-slate-800">Report Permissions</h2>
                                <p className="text-xs text-slate-500 mt-0.5">Control who can access and fill weekly &amp; monthly reports.</p>
                            </div>
                            <div className="flex gap-2 flex-wrap items-center">
                                <input
                                    type="text"
                                    placeholder="Search by name…"
                                    value={permSearch}
                                    onChange={e => setPermSearch(e.target.value)}
                                    className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-violet-500 w-44"
                                />
                                <select
                                    value={permRoleFilter}
                                    onChange={e => setPermRoleFilter(e.target.value)}
                                    className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-sm text-slate-700 focus:outline-none focus:border-violet-500"
                                >
                                    <option value="all">All Roles</option>
                                    {USER_ROLE_OPTIONS.filter((o) => o.value !== "member").map((o) => (
                                        <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                </select>
                                <button
                                    onClick={() => {
                                        setPermLoading(true);
                                        fetch("/api/admin/permissions").then(r => r.json()).then(data => {
                                            if (Array.isArray(data.users)) setPermUsers(data.users);
                                            if (Array.isArray(data.managers)) setPermManagers(data.managers);
                                        }).catch(() => {}).finally(() => setPermLoading(false));
                                    }}
                                    className="px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-300 text-sm text-slate-600 hover:bg-violet-50 hover:border-violet-400 hover:text-violet-600 transition-colors"
                                    title="Refresh"
                                >
                                    ↺
                                </button>
                            </div>
                        </div>

                        {permLoading ? (
                            <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Loading permissions…</div>
                        ) : (
                            <div className="rounded-xl border border-slate-200 overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-slate-50 text-slate-500 text-xs border-b border-slate-200">
                                            <th className="text-left px-4 py-3 font-semibold">Name</th>
                                            <th className="text-left px-4 py-3 font-semibold">Email</th>
                                            <th className="text-left px-4 py-3 font-semibold">Role</th>
                                            <th className="text-left px-4 py-3 font-semibold">Org Level</th>
                                            <th className="text-left px-4 py-3 font-semibold">Manager</th>
                                            <th className="text-center px-4 py-3 font-semibold">Report Access</th>
                                            <th className="text-center px-4 py-3 font-semibold">Specific Reports</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {permUsers
                                            .filter(u => {
                                                const matchesSearch = !permSearch || u.name?.toLowerCase().includes(permSearch.toLowerCase()) || u.email?.toLowerCase().includes(permSearch.toLowerCase());
                                                const matchesRole = permRoleFilter === "all" || u.role === permRoleFilter;
                                                return matchesSearch && matchesRole;
                                            })
                                            .flatMap(u => {
                                                const isExpanded = expandedPermUserId === u.id;
                                                const allowedIds: number[] = u.allowedManagerIds ?? [];
                                                const rows = [(
                                                    <tr key={u.id} className={`transition-colors ${isExpanded ? "bg-violet-50" : "hover:bg-slate-50"}`}>
                                                        <td className="px-4 py-3 font-medium text-slate-800">
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-7 h-7 rounded-full bg-violet-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                                                                    {u.name?.charAt(0)?.toUpperCase() ?? "?"}
                                                                </div>
                                                                {u.name}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3 text-slate-500 text-xs">{u.email}</td>
                                                        <td className="px-4 py-3">
                                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold capitalize border ${
                                                                u.role === "admin"   ? "bg-red-100 text-red-800 border-red-200" :
                                                                u.role === "manager" ? "bg-violet-100 text-violet-800 border-violet-200" :
                                                                u.role === "writer"  ? "bg-blue-100 text-blue-800 border-blue-200" :
                                                                u.role === "editor"  ? "bg-green-100 text-green-800 border-green-200" :
                                                                u.role === "qa"      ? "bg-orange-100 text-orange-800 border-orange-200" :
                                                                "bg-slate-100 text-slate-700 border-slate-200"
                                                            }`}>{u.role}</span>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold capitalize border ${
                                                                u.orgLevel === "ceo"            ? "bg-amber-100 text-amber-800 border-amber-200" :
                                                                u.orgLevel === "special_access" ? "bg-pink-100 text-pink-800 border-pink-200" :
                                                                u.orgLevel === "hod"            ? "bg-purple-100 text-purple-800 border-purple-200" :
                                                                u.orgLevel === "manager"        ? "bg-indigo-100 text-indigo-800 border-indigo-200" :
                                                                "bg-slate-100 text-slate-700 border-slate-200"
                                                            }`}>{u.orgLevel?.replace("_", " ")}</span>
                                                        </td>
                                                        <td className="px-4 py-3 text-slate-600 text-xs">{u.manager?.name ?? <span className="text-slate-400">—</span>}</td>
                                                        <td className="px-4 py-3 text-center">
                                                            <button
                                                                disabled={togglingPerm === u.id}
                                                                onClick={async () => {
                                                                    setTogglingPerm(u.id);
                                                                    try {
                                                                        const res = await fetch("/api/admin/permissions", {
                                                                            method: "PATCH",
                                                                            headers: { "Content-Type": "application/json" },
                                                                            body: JSON.stringify({ userId: u.id, reportAccess: !u.reportAccess }),
                                                                        });
                                                                        if (res.ok) {
                                                                            setPermUsers(prev => prev.map(p => p.id === u.id ? { ...p, reportAccess: !p.reportAccess } : p));
                                                                            // Refresh managers list since reportAccess changed
                                                                            fetch("/api/admin/permissions").then(r => r.json()).then(d => {
                                                                                if (Array.isArray(d.managers)) setPermManagers(d.managers);
                                                                            }).catch(() => {});
                                                                        }
                                                                    } finally {
                                                                        setTogglingPerm(null);
                                                                    }
                                                                }}
                                                                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${u.reportAccess ? "bg-violet-600" : "bg-slate-300"}`}
                                                            >
                                                                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${u.reportAccess ? "translate-x-4" : "translate-x-0.5"}`} />
                                                            </button>
                                                        </td>
                                                        <td className="px-4 py-3 text-center relative" data-perm-dropdown>
                                                            {/* Dropdown trigger */}
                                                            <button
                                                                onClick={() => setExpandedPermUserId(isExpanded ? null : u.id)}
                                                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                                                                    allowedIds.length > 0
                                                                        ? "bg-violet-50 border-violet-300 text-violet-700 hover:bg-violet-100"
                                                                        : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
                                                                }`}
                                                            >
                                                                {allowedIds.length > 0 ? (
                                                                    <span className="w-4 h-4 rounded-full bg-violet-600 text-white flex items-center justify-center text-[10px] font-bold">{allowedIds.length}</span>
                                                                ) : (
                                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                                                )}
                                                                {allowedIds.length > 0 ? `${allowedIds.length} manager${allowedIds.length > 1 ? "s" : ""}` : "Add access"}
                                                            </button>

                                                            {/* Dropdown panel */}
                                                            {isExpanded && (
                                                                <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden"
                                                                    style={{ minWidth: 220 }}>
                                                                    <div className="px-3 py-2 bg-violet-50 border-b border-violet-100">
                                                                        <p className="text-[11px] font-semibold text-violet-700">Report access for <span className="font-bold">{u.name}</span></p>
                                                                    </div>
                                                                    {permManagers.length === 0 ? (
                                                                        <p className="text-[11px] text-slate-400 italic px-3 py-3">No managers with report access yet.</p>
                                                                    ) : (
                                                                        <ul className="py-1 max-h-56 overflow-y-auto">
                                                                            {permManagers.map(m => {
                                                                                const granted = allowedIds.includes(m.id);
                                                                                const key = `${u.id}-${m.id}`;
                                                                                const toggling = togglingManagerAccess === key;
                                                                                return (
                                                                                    <li key={m.id}>
                                                                                        <button
                                                                                            disabled={toggling}
                                                                                            onClick={async () => {
                                                                                                setTogglingManagerAccess(key);
                                                                                                try {
                                                                                                    const res = await fetch("/api/admin/permissions", {
                                                                                                        method: "PATCH",
                                                                                                        headers: { "Content-Type": "application/json" },
                                                                                                        body: JSON.stringify({ userId: u.id, managerId: m.id, grant: !granted }),
                                                                                                    });
                                                                                                    if (res.ok) {
                                                                                                        setPermUsers(prev => prev.map(p => {
                                                                                                            if (p.id !== u.id) return p;
                                                                                                            const ids: number[] = p.allowedManagerIds ?? [];
                                                                                                            return {
                                                                                                                ...p,
                                                                                                                allowedManagerIds: !granted
                                                                                                                    ? [...ids, m.id]
                                                                                                                    : ids.filter((id: number) => id !== m.id),
                                                                                                            };
                                                                                                        }));
                                                                                                    }
                                                                                                } finally {
                                                                                                    setTogglingManagerAccess(null);
                                                                                                }
                                                                                            }}
                                                                                            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] transition-colors disabled:opacity-50 ${
                                                                                                granted
                                                                                                    ? "bg-violet-50 text-violet-700 font-medium"
                                                                                                    : "text-slate-700 hover:bg-slate-50"
                                                                                            }`}
                                                                                >
                                                                                    {granted ? (
                                                                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                                                                                    ) : (
                                                                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                                                                    )}
                                                                                    {m.name}
                                                                                </button>
                                                                                    </li>
                                                                                );
                                                                            })}
                                                                        </ul>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                )];
                                                return rows;
                                            })}
                                        {permUsers.filter(u => {
                                            const matchesSearch = !permSearch || u.name?.toLowerCase().includes(permSearch.toLowerCase()) || u.email?.toLowerCase().includes(permSearch.toLowerCase());
                                            const matchesRole = permRoleFilter === "all" || u.role === permRoleFilter;
                                            return matchesSearch && matchesRole;
                                        }).length === 0 && !permLoading && (
                                            <tr>
                                                <td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-sm">No users found.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* Summary footer */}
                        {!permLoading && permUsers.length > 0 && (
                            <div className="mt-4 flex gap-6 text-xs text-slate-500">
                                <span>Total users: <strong className="text-slate-700">{permUsers.length}</strong></span>
                                <span>Report access granted: <strong className="text-violet-600">{permUsers.filter(u => u.reportAccess).length}</strong></span>
                                <span>Specific report access: <strong className="text-violet-600">{permUsers.filter(u => (u.allowedManagerIds?.length ?? 0) > 0).length}</strong></span>
                                <span>No access: <strong className="text-slate-600">{permUsers.filter(u => !u.reportAccess && !(u.allowedManagerIds?.length)).length}</strong></span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
