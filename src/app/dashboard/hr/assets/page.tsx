"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { X } from "lucide-react";

const CATEGORIES = ["All", "Laptop", "Monitor", "Keyboard", "Mouse", "Headset", "Phone", "Other"];

const FIELD_CLS = "mt-1 w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none focus:border-[#008CFF]";

export default function AssetsPage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const isAdmin = user?.orgLevel === "ceo" || user?.isDeveloper;
  const [category, setCategory] = useState("All");
  const [showCreate, setShowCreate] = useState(false);
  const [assetForm, setAssetForm] = useState({ name: "", category: "Laptop", serialNumber: "", purchaseDate: "", currentValue: "", condition: "good", notes: "" });
  const setF = (k: string, v: string) => setAssetForm(f => ({ ...f, [k]: v }));

  const handleCreateAsset = async () => {
    const body: any = { ...assetForm };
    if (!body.name || !body.category) return alert("Name and category are required");
    if (body.purchaseDate) body.purchaseDate = new Date(body.purchaseDate).toISOString();
    if (body.currentValue) body.currentValue = parseFloat(body.currentValue); else delete body.currentValue;
    if (!body.serialNumber) delete body.serialNumber;
    if (!body.notes) delete body.notes;
    const res = await fetch("/api/hr/assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return alert((await res.json()).error ?? "Failed to create asset");
    setShowCreate(false);
    setAssetForm({ name: "", category: "Laptop", serialNumber: "", purchaseDate: "", currentValue: "", condition: "good", notes: "" });
    mutate("/api/hr/assets");
  };

  const { data: assets = [], isLoading } = useSWR("/api/hr/assets", fetcher);
  const filtered = category === "All" ? assets : assets.filter((a: any) => a.type === category);

  const counts = {
    total: assets.length,
    assigned: assets.filter((a: any) => a.status === "assigned").length,
    available: assets.filter((a: any) => a.status === "available").length,
    maintenance: assets.filter((a: any) => a.status === "maintenance").length,
  };

  return (
    <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">
      {/* ── Header ── */}
      <div className="bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-6 py-5">
        <div className="flex items-center text-xs text-slate-500 mb-3 gap-1.5">
          <Link href="/dashboard" className="hover:text-slate-800 dark:text-white transition-colors">Home</Link><span>/</span>
          <span className="text-slate-800 dark:text-white">Assets</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-semibold text-slate-800 dark:text-white tracking-tight">Asset Management</h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">{assets.length} assets registered</p>
          </div>
          {isAdmin && <button onClick={() => setShowCreate(true)} className="h-9 px-4 bg-[#008CFF] hover:bg-[#0077dd] text-slate-800 dark:text-white rounded-lg text-[13px] font-semibold">+ Add Asset</button>}
        </div>
      </div>

      <div className="px-6 pt-5 space-y-5">
        {/* ── Status Cards ── */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total Assets", value: counts.total, color: "text-cyan-400", bg: "bg-cyan-500/8" },
            { label: "Assigned", value: counts.assigned, color: "text-[#008CFF]", bg: "bg-blue-500/8" },
            { label: "Available", value: counts.available, color: "text-emerald-400", bg: "bg-emerald-500/8" },
            { label: "Maintenance", value: counts.maintenance, color: "text-amber-400", bg: "bg-amber-500/8" },
          ].map((s) => (
            <div key={s.label} className={`${s.bg} rounded-xl px-5 py-4`}>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* ── Category Tabs ── */}
        <div className="flex gap-0 border-b border-slate-200 dark:border-white/[0.06]">
          {CATEGORIES.map((c) => (
            <button key={c} onClick={() => setCategory(c)} className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${category === c ? "border-[#008CFF] text-slate-800 dark:text-white" : "border-transparent text-slate-500 hover:text-slate-800 dark:text-white"}`}>{c}</button>
          ))}
        </div>

        {/* ── Assets Table ── */}
        {isLoading ? (
          <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
            <table className="w-full">
              <thead><tr className="border-b border-slate-200 dark:border-white/[0.06]">{["Asset Name", "Type", "Serial No.", "Assigned To", "Condition", "Status", "Date"].map((h) => <th key={h} className="px-5 py-3 text-left text-[11px] uppercase tracking-wider text-slate-500 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {filtered.map((a: any, i: number) => (
                  <tr key={a.id} className={`border-b border-slate-100 dark:border-white/[0.03] ${i % 2 === 0 ? "" : "bg-slate-50 dark:bg-white/[0.01]"}`}>
                    <td className="px-5 py-3"><div className="flex items-center gap-2"><span className="material-icons-outlined text-[#008CFF]">laptop_mac</span><span className="text-[13px] text-slate-800 dark:text-white font-medium">{a.name}</span></div></td>
                    <td className="px-5 py-3"><span className="text-[12px] px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300">{a.type}</span></td>
                    <td className="px-5 py-3 text-[13px] text-slate-500 dark:text-slate-400 font-mono">{a.serialNumber || "—"}</td>
                    <td className="px-5 py-3">
                      {a.assignedTo ? (
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-slate-800 dark:text-white text-[10px] font-bold">{a.assignedTo.name?.charAt(0)}</div>
                          <span className="text-[13px] text-slate-800 dark:text-white">{a.assignedTo.name}</span>
                        </div>
                      ) : <span className="text-[12px] text-slate-600">Unassigned</span>}
                    </td>
                    <td className="px-5 py-3"><span className={`text-[11px] px-2 py-0.5 rounded-full ${a.condition === "good" ? "bg-emerald-500/10 text-emerald-400" : a.condition === "fair" ? "bg-amber-500/10 text-amber-400" : "bg-red-500/10 text-red-400"}`}>{a.condition}</span></td>
                    <td className="px-5 py-3"><span className={`text-[11px] px-2 py-0.5 rounded-full capitalize ${a.status === "assigned" ? "bg-blue-500/10 text-[#008CFF]" : a.status === "available" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>{a.status}</span></td>
                    <td className="px-5 py-3 text-[13px] text-slate-500">{new Date(a.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <p className="text-[13px] text-slate-500 text-center py-12">No assets found</p>}
          </div>
        )}
      </div>

      {/* ── Add Asset Slide Panel ── */}
      {showCreate && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowCreate(false)} />
          <div className="fixed top-0 right-0 bottom-0 w-[380px] bg-[#f4f7f8] dark:bg-[#001529] border-l border-slate-200 dark:border-white/[0.08] shadow-2xl z-50 flex flex-col animate-slide-in">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
              <h2 className="text-[16px] font-semibold text-slate-800 dark:text-white">Add Asset</h2>
              <button onClick={() => setShowCreate(false)} className="text-slate-500 hover:text-slate-800 dark:text-white text-xl">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Asset Name *</label>
                <input value={assetForm.name} onChange={e => setF("name", e.target.value)} className={FIELD_CLS} placeholder="e.g. MacBook Pro 14" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Category *</label>
                  <select value={assetForm.category} onChange={e => setF("category", e.target.value)} className={FIELD_CLS}>
                    {CATEGORIES.filter(c => c !== "All").map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Condition</label>
                  <select value={assetForm.condition} onChange={e => setF("condition", e.target.value)} className={FIELD_CLS}>
                    {["new","good","fair","poor"].map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Serial Number</label>
                <input value={assetForm.serialNumber} onChange={e => setF("serialNumber", e.target.value)} className={FIELD_CLS} placeholder="SN-XXXXXX" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Purchase Date</label>
                  <input type="date" value={assetForm.purchaseDate} onChange={e => setF("purchaseDate", e.target.value)} className={FIELD_CLS} />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Value (₹)</label>
                  <input type="number" value={assetForm.currentValue} onChange={e => setF("currentValue", e.target.value)} className={FIELD_CLS} placeholder="0" />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Notes</label>
                <textarea value={assetForm.notes} onChange={e => setF("notes", e.target.value)} rows={2}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none resize-none" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 dark:border-white/[0.06] flex justify-end gap-3">
              <button onClick={() => setShowCreate(false)} className="h-9 px-5 text-[13px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:text-white rounded-lg">Cancel</button>
              <button onClick={handleCreateAsset} className="h-9 px-5 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[13px] font-semibold">Add Asset</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
