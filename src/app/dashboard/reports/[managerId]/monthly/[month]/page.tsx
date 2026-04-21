"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ResizableTh } from "@/components/ui/ResizableTh";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import type { ManagerReportFormat } from "@/lib/reports/manager-report-format";
import dynamic from "next/dynamic";
import "react-quill-new/dist/quill.snow.css";

const FONT_WHITELIST = [
    "inter",
    "calibri",
    "cambria",
    "times-new-roman",
    "arial",
    "arial-black",
    "arial-narrow",
    "bahnschrift",
    "book-antiqua",
    "bookman-old-style",
    "bookshelf-symbol-7",
    "bradley-hand-itc"
];

const ReactQuill = dynamic(async () => {
    const reactQuillModule = await import("react-quill-new");
    const RQ = reactQuillModule.default;

    // Safely extract Quill from the module or window
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Quill = (RQ as any).Quill || (reactQuillModule as any).Quill || (typeof window !== 'undefined' ? (window as any).Quill : null);

    if (Quill) {
        try {
            const Font = Quill.import('formats/font');
            if (Font) {
                Font.whitelist = FONT_WHITELIST;
                Quill.register(Font, true);
            }
        } catch (err) {
            console.error("Failed to register Quill fonts", err);
        }
    }

    return RQ;
}, {
    ssr: false,
    loading: () => <div className="h-32 w-full bg-slate-50 dark:bg-[#1a1a32] animate-pulse rounded-md border border-slate-200 dark:border-white/20" />
});
const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

/* ──────────────────────────────────────────────────────────────
   Reusable helpers
   ────────────────────────────────────────────────────────────── */

/** Read-only field pulled from ClickUp — managers cannot edit */
function ClickUpField({ value, className = "" }: { value: string; className?: string }) {
    return (
        <span className={`text-slate-700 dark:text-slate-300 ${className}`}>
            {value}
        </span>
    );
}

/** Editable textarea for manager input */
function EditableField({
    value,
    onChange,
    rows = 2,
    className = "",
    readOnly = false,
}: {
    value: string;
    onChange: (v: string) => void;
    rows?: number;
    className?: string;
    readOnly?: boolean;
}) {
    return (
        <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={readOnly ? "" : "Type here"}
            rows={rows}
            readOnly={readOnly}
            className={`w-full bg-slate-50 dark:bg-[#1a1a32] border border-slate-200 dark:border-white/20 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500/80 placeholder:italic focus:outline-none focus:ring-1 focus:ring-violet-500/40 focus:border-violet-400 dark:focus:border-violet-500/50 resize-y transition-all ${readOnly ? "opacity-75 cursor-default" : ""} ${className}`}
        />
    );
}

function EditableCell({
    value,
    onChange,
    className = "",
    readOnly = false,
}: {
    value: string;
    onChange: (v: string) => void;
    className?: string;
    readOnly?: boolean;
}) {
    return (
        <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={readOnly ? "" : "Type here"}
            readOnly={readOnly}
            className={`w-full bg-transparent border-0 border-b border-dashed border-slate-300 dark:border-white/30 px-1 py-0.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500/80 placeholder:italic focus:outline-none focus:border-violet-400 dark:focus:border-violet-500/50 transition-all ${readOnly ? "opacity-75 cursor-default" : ""} ${className}`}
        />
    );
}

/** Editable Rich Text Field using ReactQuill */
function RichTextField({
    value,
    onChange,
    placeholder = "Type here...",
    className = "",
}: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    className?: string;
}) {
    const modules = {
        toolbar: [
            [{ 'header': [1, 2, 3, false] }],
            [{ 'font': FONT_WHITELIST }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ 'list': 'ordered' }, { 'list': 'bullet' }],
            ['clean']
        ],
    };

    return (
        <div className={`quill-editor ${className}`}>
            <ReactQuill
                theme="snow"
                value={value}
                onChange={onChange}
                modules={modules}
                placeholder={placeholder}
            />
        </div>
    );
}

/** Andrew table cell — module-level so React doesn't remount inputs inside it */
function ATd({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
    return (
        <td className={`px-2 py-2 border border-slate-200 dark:border-white/10 bg-white dark:bg-[#32324a] text-[13px] align-top text-slate-800 dark:text-slate-200 ${className}`}>
            {children}
        </td>
    );
}

/** Nishant table cell — module-level so React doesn't remount inputs inside it */
function NCell({ children, bold, center, colored }: { children?: React.ReactNode; bold?: boolean; center?: boolean; colored?: string }) {
    return (
        <td className={`px-3 py-2 border border-slate-300 dark:border-white/10 text-[13px] align-middle ${bold ? "font-semibold" : ""} ${center ? "text-center" : ""} ${colored || "text-slate-800 dark:text-slate-200 bg-white dark:bg-[#32324a]"}`}>
            {children}
        </td>
    );
}

/** Nishant report input — module-level so React doesn't remount on every render */
function NInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
    return (
        <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder ?? "Type here…"}
            className="w-full text-[13px] text-slate-800 dark:text-slate-200 focus:outline-none rounded px-1 cursor-text bg-transparent hover:bg-emerald-50 dark:hover:bg-emerald-900/20 focus:bg-white dark:focus:bg-white/10 focus:ring-1 focus:ring-emerald-400/50 placeholder:text-slate-300 dark:placeholder:text-slate-500 transition-colors"
        />
    );
}

/** Andrew report input — module-level so React doesn't remount on every render */
function AInput({ value, onChange, placeholder = "", disabled = false }: {
    value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean;
}) {
    return (
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
            placeholder={placeholder} disabled={disabled}
            className={`w-full bg-transparent text-[13px] text-slate-800 dark:text-slate-200 placeholder:text-slate-300 focus:outline-none ${disabled ? "opacity-60 cursor-default" : ""}`} />
    );
}

/** Andrew report textarea — module-level so React doesn't remount on every render */
function ATextarea({ value, onChange, placeholder = "", disabled = false }: {
    value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean;
}) {
    return (
        <textarea value={value} onChange={e => onChange(e.target.value)}
            placeholder={placeholder} disabled={disabled} rows={3}
            className="w-full bg-transparent text-[13px] text-slate-800 dark:text-slate-200 placeholder:text-slate-300 focus:outline-none resize-y" />
    );
}

/* ──────────────────────────────────────────────────────────────
   Main page component
   ────────────────────────────────────────────────────────────── */


interface NishantResearcherRow {
    id: string;
    researcher: string;
    approvedCasesRTC: string;
    avgRating: string;
    approvedCasesFOIA: string;
    expectedTargetRTC: string;
    expectedFOIAPitched: string;
    actualFOIAPitched: string;
    foiaReceived: string;
    overallRemarks: string;
}

interface NishantOverview {
    totalCasesRTC: string;
    avgCaseRating: string;
    totalCasesFOIA: string;
    totalExpectedTargetRTC: string;
    totalExpectedFOIAPitched: string;
    totalFOIAPitched: string;
    totalFOIAReceived: string;
    monthlyDeadlineMet: string;
}

/* ── Andrew James monthly interfaces ── */
interface AndrewBRow {
    id: string; reviewer: string; targetForMonth: string; totalReviewsDone: string; avgWriterEditorQaScore: string;
    reasonVariance: string; avgRating: string; casesMajorChanges: string;
    bestCase: string; leastInterestingCase: string; suggestedPattern: string;
    repetitiveIssues: string; winLastMonth: string; roadblockLastMonth: string;
    remark: string;
}
const mkAB = (id: string, reviewer = ""): AndrewBRow => ({ id, reviewer, targetForMonth: "40", totalReviewsDone: "", avgWriterEditorQaScore: "", reasonVariance: "", avgRating: "", casesMajorChanges: "", bestCase: "", leastInterestingCase: "", suggestedPattern: "", repetitiveIssues: "", winLastMonth: "", roadblockLastMonth: "", remark: "" });

interface AndrewSBRow { id: string; person: string; thumbnailsDone: string; avgCtr: string; remark: string; autoFilled?: boolean; }
const mkSBRow = (id: string, person = ""): AndrewSBRow => ({ id, person, thumbnailsDone: "", avgCtr: "", remark: "" });

interface AndrewSCRow { id: string; capsule: string; currentMonthViews: string; lastMonthViews: string; remark: string; autoFilled?: boolean; }
const mkSCRow = (id: string, capsule = ""): AndrewSCRow => ({ id, capsule, currentMonthViews: "", lastMonthViews: "", remark: "" });

const mkNishantRow = (id: string, name = ""): NishantResearcherRow => ({
    id, researcher: name, approvedCasesRTC: "", avgRating: "",
    approvedCasesFOIA: "", expectedTargetRTC: "", expectedFOIAPitched: "",
    actualFOIAPitched: "", foiaReceived: "", overallRemarks: "",
});

const defaultNishantOverview = (): NishantOverview => ({
    totalCasesRTC: "", avgCaseRating: "", totalCasesFOIA: "",
    totalExpectedTargetRTC: "", totalExpectedFOIAPitched: "",
    totalFOIAPitched: "", totalFOIAReceived: "", monthlyDeadlineMet: "",
});

/* ──────────────── Drag-scroll wrapper (module-level to avoid remount on every render) ── */
function DragScrollDiv({ children, className }: { children: React.ReactNode; className?: string }) {
    const ref      = React.useRef<HTMLDivElement>(null);
    const dragging = React.useRef(false);
    const startX   = React.useRef(0);
    const scrollL  = React.useRef(0);

    // Non-passive touch listeners so we can call preventDefault for smooth horizontal drag
    React.useEffect(() => {
        const el = ref.current;
        if (!el) return;
        let touching = false;
        let tStartX = 0;
        let tScrollL = 0;
        const onTouchStart = (e: TouchEvent) => {
            touching = true;
            tStartX  = e.touches[0].pageX;
            tScrollL = el.scrollLeft;
        };
        const onTouchMove = (e: TouchEvent) => {
            if (!touching) return;
            const dx = e.touches[0].pageX - tStartX;
            if (Math.abs(dx) > 5) e.preventDefault();
            el.scrollLeft = tScrollL - dx;
        };
        const onTouchEnd = () => { touching = false; };
        el.addEventListener("touchstart", onTouchStart, { passive: true });
        el.addEventListener("touchmove",  onTouchMove,  { passive: false });
        el.addEventListener("touchend",   onTouchEnd,   { passive: true });
        return () => {
            el.removeEventListener("touchstart", onTouchStart);
            el.removeEventListener("touchmove",  onTouchMove);
            el.removeEventListener("touchend",   onTouchEnd);
        };
    }, []);

    // Mouse drag — no preventDefault on mousedown so clicks still focus inputs
    const onMouseDown = (e: React.MouseEvent) => {
        const el = e.target as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (["input", "select", "textarea", "a", "button"].includes(tag)) return;
        dragging.current = true;
        startX.current   = e.pageX - (ref.current?.offsetLeft ?? 0);
        scrollL.current  = ref.current?.scrollLeft ?? 0;
        if (ref.current) ref.current.style.cursor = "grabbing";
    };
    const stop = () => { dragging.current = false; if (ref.current) ref.current.style.cursor = "grab"; };
    const onMouseMove = (e: React.MouseEvent) => {
        if (!dragging.current || !ref.current) return;
        e.preventDefault();
        const x = e.pageX - ref.current.offsetLeft;
        ref.current.scrollLeft = scrollL.current - (x - startX.current) * 1.2;
    };

    return (
        <div ref={ref} className={className} style={{ cursor: "grab" }}
            onMouseDown={onMouseDown} onMouseLeave={stop} onMouseUp={stop} onMouseMove={onMouseMove}>
            {children}
        </div>
    );
}

export default function MonthlyReportPage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const managerId = params.managerId as string;
    const monthIndex = Number(params.month);
    const monthName = MONTH_NAMES[monthIndex] || "Unknown";
    const yearParam = searchParams.get("year");
    const year =
        yearParam != null && yearParam !== "" && Number.isFinite(Number(yearParam))
            ? Number(yearParam)
            : new Date().getFullYear();

    const { data: session, status: sessionStatus } = useSession();
    const sessionUser = session?.user as any;
    const isAdmin      = sessionUser?.isDeveloper === true || sessionUser?.orgLevel === "special_access";
    const isCeo        = sessionUser?.orgLevel === "ceo" && !isAdmin;
    const isOwner      = sessionUser?.dbId && String(sessionUser.dbId) === String(managerId);

    // Explicit per-manager access granted by admin
    const [allowedManagerIds, setAllowedManagerIds] = useState<number[]>([]);
    useEffect(() => {
        if (!sessionUser?.dbId || isOwner || isAdmin) return;
        fetch("/api/user/report-access").then(r => r.json()).then(d => {
            setAllowedManagerIds(d.allowedManagerIds ?? []);
        }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionUser?.dbId]);
    const hasExplicitAccess = allowedManagerIds.includes(Number(managerId));

    // CEO: view-only. Admin/developer/special_access: full access like owner
    const viewOnly     = sessionStatus === "authenticated" && !isOwner && !isAdmin;

    // Data Fetching
    const fetcher = (url: string) => fetch(url).then((res) => res.json());
    const { data, error, isLoading } = useSWR(`/api/reports/${managerId}`, fetcher);

    const manager = data?.manager;
    const reportFmt = (manager?.reportFormat ?? "production") as ManagerReportFormat;
    const isResearcherReport = !isLoading && reportFmt === "researcher";
    const isQaReport = !isLoading && reportFmt === "qa";
    const isHrReport = !isLoading && reportFmt === "hr";

    // Researcher stats from ClickUp (approved RTC count + avg rating per researcher)
    const { data: statsData } = useSWR(
        isResearcherReport ? `/api/reports/${managerId}/monthly/${monthIndex}/researcher-stats?year=${year}` : null,
        fetcher
    );

    // Contributor stats — casesCompleted per editor/writer from MonthlyRating
    const { data: contributorData } = useSWR(
        (!isResearcherReport && !isQaReport && managerId)
            ? `/api/reports/${managerId}/monthly/${monthIndex}/contributor-stats?year=${year}`
            : null,
        fetcher
    );
    const editorStats: Record<number, number> = contributorData?.editorStats ?? {};
    const writerStats: Record<number, number> = contributorData?.writerStats ?? {};

    const editors = useMemo(() => {
        if (!data?.teamMembers) return [];
        return data.teamMembers.filter((u: any) => u.role === "editor");
    }, [data]);

    const writers = useMemo(() => {
        if (!data?.teamMembers) return [];
        return data.teamMembers.filter((u: any) => u.role === "writer");
    }, [data]);

    const researchers = useMemo(() => {
        if (!data?.teamMembers) return [];
        return data.teamMembers.filter((u: any) => u.role === "researcher");
    }, [data]);

    // ── Editable state for all manager fields ──────────────
    const [executiveSummary, setExecutiveSummary] = useState("");
    const [shortfallSummary, setShortfallSummary] = useState("");
    const [editorNotes, setEditorNotes] = useState<Record<number, string>>({});
    const [writerNotes, setWriterNotes] = useState<Record<number, string>>({});
    const handleEditorNoteChange = (userId: number, value: string) => {
        setEditorNotes(prev => ({ ...prev, [userId]: value }));
    };

    const handleWriterNoteChange = (userId: number, value: string) => {
        setWriterNotes(prev => ({ ...prev, [userId]: value }));
    };
    const [teamRecognition, setTeamRecognition] = useState("");
    const [keyLearnings, setKeyLearnings] = useState(["", "", ""]);
    const [risksAttention, setRisksAttention] = useState("");
    const [behavioralConcerns, setBehavioralConcerns] = useState("");
    const [remark, setRemark] = useState("");

    // ── Nishant column resize state ──
    const [nColWidths, setNColWidths] = React.useState<Record<number, number>>({});
    const [nOvColWidths, setNOvColWidths] = React.useState<Record<number, number>>({});
    const nResTableRef = React.useRef<HTMLTableElement>(null);
    const nOvTableRef  = React.useRef<HTMLTableElement>(null);

    // ── Andrew James monthly state ──
    const [andrewA1Rows, setAndrewA1Rows] = useState<any[]>([]);
    const [andrewA2Rows, setAndrewA2Rows] = useState<any[]>([]);
    const [andrewBRows,  setAndrewBRows]  = useState<AndrewBRow[]>([mkAB("b-1","Andrew"), mkAB("b-2","Abhishek")]);
    const [abColWidths,  setAbColWidths]  = useState<Record<number,number>>({});
    const abTableRef = React.useRef<HTMLTableElement>(null);
    const setAB = (idx: number, f: keyof AndrewBRow,  v: string) => setAndrewBRows(p  => p.map((r,i) => i===idx ? {...r,[f]:v} : r));

    // Section B — Rohini & Shikha thumbnails
    const [andrewSBRows,  setAndrewSBRows]  = useState<AndrewSBRow[]>([mkSBRow("sb-1","Rohini"), mkSBRow("sb-2","Shikha")]);
    const [sbColWidths,   setSbColWidths]   = useState<Record<number,number>>({});
    const sbTableRef = React.useRef<HTMLTableElement>(null);
    const setSBR = (idx: number, f: keyof AndrewSBRow, v: string) => setAndrewSBRows(p => p.map((r,i) => i===idx ? {...r,[f]:v} : r));

    // Section C — Monthly views comparison
    const [andrewSCRows,  setAndrewSCRows]  = useState<AndrewSCRow[]>([mkSCRow("sc-1"), mkSCRow("sc-2"), mkSCRow("sc-3")]);
    const [scColWidths,   setScColWidths]   = useState<Record<number,number>>({});
    const scTableRef = React.useRef<HTMLTableElement>(null);
    const setSCR = (idx: number, f: keyof AndrewSCRow, v: string) => setAndrewSCRows(p => p.map((r,i) => i===idx ? {...r,[f]:v} : r));

    // Active tab for Andrew monthly
    const [andrewTab, setAndrewTab] = useState<"A" | "B" | "C">("A");

    // ── Tanvi Dogra HR Manager monthly state ──
    const [hrHighlights, setHrHighlights] = useState({ top3Achievements: "", top3Risks: "", criticalEscalations: "", supportRequired: "" });
    const [hrComplianceRows, setHrComplianceRows] = useState([{ id: "c-1", employeeName: "", issueType: "", descriptionOfIssue: "", severity: "", actionTakenByHR: "", currentStatus: "" }]);
    const [hrNewJoineeRows, setHrNewJoineeRows] = useState([{ id: "nj-1", employeeName: "", position: "", daysTakenToClose: "", qualityOfHire: "", issueObserved: "", hrIntervention: "", currentStatus: "" }]);
    const [hrHiringSummary, setHrHiringSummary] = useState({ totalPositionsClosed: "", rolesLongToClose: "", offerAcceptanceRate: "", qualityConcerns: "" });
    const [hrGovernanceWork, setHrGovernanceWork] = useState({ contractsCreated: "", recordsAudited: "", policyUpdates: "" });
    const [hrGovernanceGaps, setHrGovernanceGaps] = useState({ missingIncorrectRecords: "", delaysProcessBreakdowns: "" });
    const [hrRetentionRows, setHrRetentionRows] = useState([{ id: "r-1", employeeName: "", position: "", reasonForLeaving: "", avoidable: "", highValueEmployee: "", actionTakenToRetain: "", keyLearning: "" }]);
    const [hrEngagementRows, setHrEngagementRows] = useState([{ id: "e-1", initiative: "", objective: "", participationLevel: "", feedbackResponse: "", observedImpact: "" }]);
    const [hrFunRows, setHrFunRows] = useState([{ id: "f-1", activityName: "", objective: "", participationLevel: "", feedbackResponse: "", observedImpact: "" }]);
    const [hrFeedbackRows, setHrFeedbackRows] = useState([{ id: "fs-1", methodOfSurvey: "", topicCovered: "", keyInsights: "", actionTaken: "" }]);
    const [hrGrievanceRows, setHrGrievanceRows] = useState([{ id: "g-1", employeeName: "", issueType: "", briefDescription: "", actionTaken: "", status: "" }]);

    // Auto-fill Section B thumbnail counts from DB
    const { data: thumbnailData } = useSWR(
        isQaReport ? `/api/reports/${managerId}/monthly/${monthIndex}/andrew-thumbnail-cases?year=${year}` : null,
        fetcher
    );

    // Auto-fill Section C capsule views from DB
    const { data: capsuleViewsData } = useSWR(
        isQaReport ? `/api/reports/${managerId}/monthly/${monthIndex}/capsule-views?year=${year}` : null,
        fetcher
    );

    // ── Nishant Bhatia monthly researcher state ──
    const defaultNishantRows = useMemo((): NishantResearcherRow[] => {
        return researchers.length > 0
            ? researchers.map((r: any) => mkNishantRow(String(r.id), r.name))
            : [mkNishantRow("nr-1"), mkNishantRow("nr-2"), mkNishantRow("nr-3")];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [researchers]);

    const [nishantRows, setNishantRows] = useState<NishantResearcherRow[] | null>(null);
    const nRows = nishantRows ?? defaultNishantRows;
    const [nishantOverview, setNishantOverview] = useState<NishantOverview>(defaultNishantOverview());
    const setNR = useCallback((idx: number, f: keyof NishantResearcherRow, v: string) =>
        setNishantRows(p => (p ?? defaultNishantRows).map((r, i) => i === idx ? { ...r, [f]: v } : r)),
    [defaultNishantRows]);
    const setNO = (f: keyof NishantOverview, v: string) =>
        setNishantOverview(p => ({ ...p, [f]: v }));
    const addNR    = () => setNishantRows(p => [...(p ?? defaultNishantRows), mkNishantRow(`nr-${Date.now()}`)]);
    const removeNR = (idx: number) => setNishantRows(p => (p ?? defaultNishantRows).filter((_, i) => i !== idx));

    /* ── Lock / submit state ── */
    const [isLocked,     setIsLocked]     = useState(false);
    const [isSubmitted,  setIsSubmitted]  = useState(false);
    const [isDraftSaved, setIsDraftSaved] = useState(false);
    const [submitting,        setSubmitting]        = useState(false);
    const [submitError,       setSubmitError]       = useState<string | null>(null);
    const [statusLoaded,      setStatusLoaded]      = useState(false);
    const [showConfirm,       setShowConfirm]       = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deletingDraft,     setDeletingDraft]     = useState(false);

    // Fetch submission status on mount
    useEffect(() => {
        if (!managerId || isNaN(monthIndex)) return;
        fetch(`/api/reports/${managerId}/monthly/${monthIndex}?year=${year}`)
            .then(r => r.json())
            .then(d => {
                if (d.submitted) {
                    setIsSubmitted(d.locked);
                    setIsDraftSaved(!d.locked);
                    setIsLocked(d.locked);
                    const saved = d.data as any;
                    if (saved?.executiveSummary)   setExecutiveSummary(saved.executiveSummary);
                    if (saved?.shortfallSummary)   setShortfallSummary(saved.shortfallSummary);
                    if (saved?.editorNotes)        setEditorNotes(saved.editorNotes);
                    if (saved?.writerNotes)        setWriterNotes(saved.writerNotes);
                    if (saved?.teamRecognition)    setTeamRecognition(saved.teamRecognition);
                    if (saved?.keyLearning1 || saved?.keyLearning2 || saved?.keyLearning3) {
                        setKeyLearnings([saved.keyLearning1 || "", saved.keyLearning2 || "", saved.keyLearning3 || ""]);
                    } else if (saved?.keyLearnings) {
                        setKeyLearnings(saved.keyLearnings); // legacy fallback
                    }
                    if (saved?.risksAttention)     setRisksAttention(saved.risksAttention);
                    if (saved?.behavioralConcerns) setBehavioralConcerns(saved.behavioralConcerns);
                    if (saved?.remark)             setRemark(saved.remark);
                    if (saved?.nishantResearcherRows) setNishantRows(saved.nishantResearcherRows);
                    if (saved?.nishantOverview)       setNishantOverview(saved.nishantOverview);
                    if (saved?.andrewA1Rows?.length)  setAndrewA1Rows(saved.andrewA1Rows);
                    if (saved?.andrewA2Rows?.length)  setAndrewA2Rows(saved.andrewA2Rows);
                    if (saved?.andrewBRows?.length)   setAndrewBRows(saved.andrewBRows);
                    if (saved?.andrewSBRows?.length)  setAndrewSBRows(saved.andrewSBRows);
                    if (saved?.andrewSCRows?.length)  setAndrewSCRows(saved.andrewSCRows);
                    // HR Manager (Tanvi) data
                    if (saved?.hrMonthlyData) {
                        const hr = saved.hrMonthlyData as any;
                        if (hr.highlights)       setHrHighlights(hr.highlights);
                        if (hr.complianceRows?.length)  setHrComplianceRows(hr.complianceRows);
                        if (hr.newJoineeRows?.length)   setHrNewJoineeRows(hr.newJoineeRows);
                        if (hr.hiringSummary)    setHrHiringSummary(hr.hiringSummary);
                        if (hr.governanceWork)   setHrGovernanceWork(hr.governanceWork);
                        if (hr.governanceGaps)   setHrGovernanceGaps(hr.governanceGaps);
                        if (hr.retentionRows?.length)   setHrRetentionRows(hr.retentionRows);
                        if (hr.engagementRows?.length)  setHrEngagementRows(hr.engagementRows);
                        if (hr.funRows?.length)         setHrFunRows(hr.funRows);
                        if (hr.feedbackRows?.length)    setHrFeedbackRows(hr.feedbackRows);
                        if (hr.grievanceRows?.length)   setHrGrievanceRows(hr.grievanceRows);
                    }
                }
                setStatusLoaded(true);
            })
            .catch(() => setStatusLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [managerId, monthIndex, year]);

    // ── Andrew monthly auto-fill ──
    const fetchAndFillAndrewMonthly = useCallback(() => {
        if (!isQaReport) return;
        fetch(`/api/reports/${managerId}/monthly/${monthIndex}/andrew-cases?year=${year}`)
            .then(r => r.json()).then(d => {
                const cases: any[] = d.andrewCases ?? [];
                if (!cases.length) return;
                setAndrewA1Rows(cases.map((c, i) => ({
                    id: `ma1-${i}-${Date.now()}`,
                    caseName: c.caseName, capsuleName: c.capsuleName,
                    caseRating: c.caseRating, caseType: c.caseType,
                    writer: c.writerName, qaScriptStartDate: c.qaScriptStartDate,
                    ratingByQATeam: c.scriptQualityRating,
                    reasonForRating: "", writerQualityScore: c.writerQualityScore,
                    structuralChanges: "", autoFilled: true,
                })));
            }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [managerId, monthIndex, year, isQaReport]);

    const fetchAndFillAbhishekMonthly = useCallback(() => {
        if (!isQaReport) return;
        fetch(`/api/reports/${managerId}/monthly/${monthIndex}/andrew-video-cases?year=${year}`)
            .then(r => r.json()).then(d => {
                const cases: any[] = d.videoCases ?? [];
                if (!cases.length) return;
                setAndrewA2Rows(cases.map((c, i) => ({
                    id: `ma2-${i}-${Date.now()}`,
                    caseName: c.caseName, capsuleName: c.capsuleName,
                    caseRating: c.caseRating, caseType: c.caseType,
                    writer: c.writerName, writerQualityScore: c.writerQualityScore,
                    editor: c.editorName, qaVideoStartDate: c.qaVideoStartDate,
                    ratingByAbhishek: c.videoQualityRating,
                    reasonForRating: "", editorQualityScore: c.editorQualityScore,
                    structuralChanges: "", autoFilled: true,
                })));
            }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [managerId, monthIndex, year, isQaReport]);

    // Trigger auto-fill on load when no draft exists
    useEffect(() => {
        if (!statusLoaded || !isQaReport) return;
        if (isLocked || isSubmitted || isDraftSaved) return;
        fetchAndFillAndrewMonthly();
        fetchAndFillAbhishekMonthly();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusLoaded, isQaReport, managerId, monthIndex, year]);

    // Auto-fill Section B thumbnail counts from API
    useEffect(() => {
        if (!thumbnailData?.thumbnailData?.length) return;
        setAndrewSBRows(prev => prev.map(row => {
            const match = thumbnailData.thumbnailData.find(
                (t: any) => t.person?.toLowerCase() === row.person?.toLowerCase()
            );
            if (!match) return row;
            return { ...row, thumbnailsDone: match.thumbnailsDone, autoFilled: true };
        }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [thumbnailData]);

    // Auto-fill Section C monthly views from DB (only when no draft exists)
    useEffect(() => {
        if (!capsuleViewsData?.views?.length) return;
        if (isLocked || isSubmitted || isDraftSaved) return;
        const rows: AndrewSCRow[] = capsuleViewsData.views.map((v: any, i: number) => ({
            id:                `sc-auto-${i}-${Date.now()}`,
            capsule:           v.capsule           ?? "",
            currentMonthViews: v.currentMonthViews ?? "",
            lastMonthViews:    v.lastMonthViews    ?? "",
            remark:            "",
            autoFilled:        true,
        }));
        // Pad with at least one empty row if data is sparse
        if (rows.length === 0) rows.push(mkSCRow("sc-1"));
        setAndrewSCRows(rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [capsuleViewsData]);

    // Auto-compute Section B from A1/A2 data
    useEffect(() => {
        if (!isQaReport || isLocked || isSubmitted || isDraftSaved) return;
        const andrewCount = andrewA1Rows.filter(r => r.caseName && r.caseName !== "N/A").length;
        const abhishekCount = andrewA2Rows.filter(r => r.caseName && r.caseName !== "N/A").length;
        const andrewRatings = andrewA1Rows.map(r => parseFloat(r.ratingByQATeam)).filter(n => !isNaN(n));
        const abhishekRatings = andrewA2Rows.map(r => parseFloat(r.ratingByAbhishek)).filter(n => !isNaN(n));
        const andrewAvg = andrewRatings.length ? (andrewRatings.reduce((s,n)=>s+n,0)/andrewRatings.length).toFixed(2) : "";
        const abhishekAvg = abhishekRatings.length ? (abhishekRatings.reduce((s,n)=>s+n,0)/abhishekRatings.length).toFixed(2) : "";
        const andrewWQS = andrewA1Rows.map(r => parseFloat(r.writerQualityScore)).filter(n => !isNaN(n));
        const abhishekEQS = andrewA2Rows.map(r => parseFloat(r.editorQualityScore)).filter(n => !isNaN(n));
        const andrewAvgQS = andrewWQS.length ? (andrewWQS.reduce((s,n)=>s+n,0)/andrewWQS.length).toFixed(1) : "";
        const abhishekAvgQS = abhishekEQS.length ? (abhishekEQS.reduce((s,n)=>s+n,0)/abhishekEQS.length).toFixed(1) : "";
        setAndrewBRows(prev => prev.map(row => {
            if (row.reviewer === "Andrew") return { ...row,
                totalReviewsDone: andrewCount > 0 ? String(andrewCount) : row.totalReviewsDone,
                avgRating: andrewAvg || row.avgRating,
                avgWriterEditorQaScore: andrewAvgQS || row.avgWriterEditorQaScore,
            };
            if (row.reviewer === "Abhishek") return { ...row,
                totalReviewsDone: abhishekCount > 0 ? String(abhishekCount) : row.totalReviewsDone,
                avgRating: abhishekAvg || row.avgRating,
                avgWriterEditorQaScore: abhishekAvgQS || row.avgWriterEditorQaScore,
            };
            return row;
        }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [andrewA1Rows, andrewA2Rows, isQaReport]);

    // Merge ClickUp-derived stats into rows whenever they load
    useEffect(() => {
        if (!statsData?.stats?.length) return;
        setNishantRows(prev => {
            const rows = prev ?? defaultNishantRows;
            return rows.map(row => {
                const match = statsData.stats.find(
                    (s: any) => row.researcher && s.name?.toLowerCase().trim() === row.researcher.toLowerCase().trim()
                );
                if (!match) return row;
                return {
                    ...row,
                    approvedCasesRTC: String(match.approvedCasesRTC ?? row.approvedCasesRTC),
                    avgRating: match.avgRating ?? row.avgRating,
                };
            });
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statsData]);

    const validateRequired = (): string | null => {
        // Andrew: validate Section A rows
        if (isQaReport) {
            for (let i = 0; i < andrewBRows.length; i++) {
                const row = andrewBRows[i];
                const label = andrewBRows.length > 1 ? ` (row ${i + 1})` : "";
                if (!row.reviewer)           return `Reviewer is required${label}.`;
                if (!row.targetForMonth)     return `Target for the month is required${label}.`;
                if (!row.totalReviewsDone)   return `Total reviews done is required${label}.`;
                if (!row.reasonVariance)     return `Reason for variance is required${label}.`;
                if (!row.avgRating)          return `Average rating is required${label}.`;
                if (!row.casesMajorChanges)  return `No. of cases with major changes is required${label}.`;
                if (!row.bestCase)           return `Best case is required${label}.`;
                if (!row.leastInterestingCase) return `Least interesting case is required${label}.`;
                if (!row.suggestedPattern)   return `Suggested pattern is required${label}.`;
                if (!row.repetitiveIssues)   return `Repetitive issues is required${label}.`;
                if (!row.winLastMonth)       return `1 Win from last month is required${label}.`;
                if (!row.roadblockLastMonth) return `1 Roadblock from last month is required${label}.`;
            }
            return null;
        }
        // Nishant: validate at least one researcher row has a name
        if (isResearcherReport) {
            const hasAny = nRows.some(r => r.researcher.trim());
            if (!hasAny) return "Please add at least one researcher row with a name.";
            return null;
        }
        // Standard managers
        const strip = (html: string) => html.replace(/<[^>]*>/g, "").trim();
        if (!strip(executiveSummary))      return "Executive Summary is required.";
        if (!strip(shortfallSummary))      return "Shortfall is required.";
        if (!strip(teamRecognition))       return "Team/Individual Recognition is required.";
        if (!keyLearnings[0].trim())       return "Key Learning 1 (What Worked Well) is required.";
        if (!keyLearnings[1].trim())       return "Key Learning 2 (What Did Not Work) is required.";
        if (!keyLearnings[2].trim())       return "Key Learning 3 (Improvements Adapted) is required.";
        if (!risksAttention.trim())        return "Risks & Immediate Attention is required.";
        return null;
    };

    const postReport = async (isDraft: boolean) => {
        if (isLocked && !isAdmin) return;
        if (!isDraft) {
            const err = validateRequired();
            if (err) { setSubmitError(err); setShowConfirm(false); return; }
        }
        setSubmitting(true);
        setSubmitError(null);
        setShowConfirm(false);
        try {
            const res = await fetch(`/api/reports/${managerId}/monthly/${monthIndex}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    year,
                    isDraft,
                    executiveSummary,
                    shortfallSummary,
                    editorNotes,
                    writerNotes,
                    teamRecognition,
                    keyLearning1: keyLearnings[0],
                    keyLearning2: keyLearnings[1],
                    keyLearning3: keyLearnings[2],
                    nishantResearcherRows: isResearcherReport ? nRows        : undefined,
                    nishantOverview:       isResearcherReport ? nishantOverview : undefined,
                    andrewBRows:  isQaReport ? andrewBRows  : undefined,
                    andrewSBRows: isQaReport ? andrewSBRows : undefined,
                    andrewSCRows: isQaReport ? andrewSCRows : undefined,
                    hrMonthlyData: isHrReport ? {
                        highlights: hrHighlights,
                        complianceRows: hrComplianceRows,
                        newJoineeRows: hrNewJoineeRows,
                        hiringSummary: hrHiringSummary,
                        governanceWork: hrGovernanceWork,
                        governanceGaps: hrGovernanceGaps,
                        retentionRows: hrRetentionRows,
                        engagementRows: hrEngagementRows,
                        funRows: hrFunRows,
                        feedbackRows: hrFeedbackRows,
                        grievanceRows: hrGrievanceRows,
                    } : undefined,
                    risksAttention,
                    behavioralConcerns,
                    remark,
                }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Submission failed");
            if (isDraft) {
                setIsDraftSaved(true);
                setIsSubmitted(false);
            } else {
                setIsSubmitted(true);
                setIsDraftSaved(false);
                setIsLocked(true);
            }
        } catch (e: any) {
            setSubmitError(e.message);
        }
        setSubmitting(false);
    };

    const handleSubmit    = () => postReport(false);
    const handleSaveDraft = () => postReport(true);

    const handleDeleteDraft = async () => {
        setDeletingDraft(true);
        setShowDeleteConfirm(false);
        try {
            const res = await fetch(
                `/api/reports/${managerId}/monthly/${monthIndex}?year=${year}`,
                { method: "DELETE" }
            );
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Delete failed");
            // Reset all state back to blank
            setIsDraftSaved(false);
            setIsSubmitted(false);
            setIsLocked(false);
            setExecutiveSummary("");
            setShortfallSummary("");
            setEditorNotes({});
            setWriterNotes({});
            setTeamRecognition("");
            setKeyLearnings(["", "", ""]);
            setRisksAttention("");
            setBehavioralConcerns("");
            setRemark("");
            setNishantRows(null);
            setNishantOverview(defaultNishantOverview());
            setAndrewA1Rows([]);
            setAndrewA2Rows([]);
            setAndrewBRows([mkAB("b-1","Andrew"), mkAB("b-2","Abhishek")]);
            setHrHighlights({ top3Achievements: "", top3Risks: "", criticalEscalations: "", supportRequired: "" });
            setHrComplianceRows([{ id: "c-1", employeeName: "", issueType: "", descriptionOfIssue: "", severity: "", actionTakenByHR: "", currentStatus: "" }]);
            setHrNewJoineeRows([{ id: "nj-1", employeeName: "", position: "", daysTakenToClose: "", qualityOfHire: "", issueObserved: "", hrIntervention: "", currentStatus: "" }]);
            setHrHiringSummary({ totalPositionsClosed: "", rolesLongToClose: "", offerAcceptanceRate: "", qualityConcerns: "" });
            setHrGovernanceWork({ contractsCreated: "", recordsAudited: "", policyUpdates: "" });
            setHrGovernanceGaps({ missingIncorrectRecords: "", delaysProcessBreakdowns: "" });
            setHrRetentionRows([{ id: "r-1", employeeName: "", position: "", reasonForLeaving: "", avoidable: "", highValueEmployee: "", actionTakenToRetain: "", keyLearning: "" }]);
            setHrEngagementRows([{ id: "e-1", initiative: "", objective: "", participationLevel: "", feedbackResponse: "", observedImpact: "" }]);
            setHrFunRows([{ id: "f-1", activityName: "", objective: "", participationLevel: "", feedbackResponse: "", observedImpact: "" }]);
            setHrFeedbackRows([{ id: "fs-1", methodOfSurvey: "", topicCovered: "", keyInsights: "", actionTaken: "" }]);
            setHrGrievanceRows([{ id: "g-1", employeeName: "", issueType: "", briefDescription: "", actionTaken: "", status: "" }]);
        } catch (e: any) {
            setSubmitError(e.message);
        }
        setDeletingDraft(false);
    };

    const updateArrayItem = (
        setter: React.Dispatch<React.SetStateAction<string[]>>,
        index: number,
        value: string
    ) => {
        setter((prev) => {
            const copy = [...prev];
            copy[index] = value;
            return copy;
        });
    };


    /* ──────────────── Andrew James Monthly Report ──────────────── */
    if (isQaReport) {
        const ATh = ({ children, colIndex, widths, setWidths, tableRef, colCount }: { children: React.ReactNode; colIndex: number; widths: Record<number,number>; setWidths: React.Dispatch<React.SetStateAction<Record<number,number>>>; tableRef?: React.RefObject<HTMLTableElement>; colCount?: number }) => (
            <ResizableTh colIndex={colIndex} widths={widths} setWidths={setWidths} minWidth={80} tableRef={tableRef} colCount={colCount}
                className="px-3 py-2.5 text-left text-[12px] font-bold bg-[#1e3a5f] border border-[#2a4a6f] whitespace-normal leading-tight">
                <span style={{ color: '#ffffff' }}>{children}</span>
            </ResizableTh>
        );
        // Pre-compute disabled helpers for Andrew inputs
        const aDisabled  = isLocked && !isAdmin;   // manually-filled columns: editable unless report is locked (admins can always edit)
        const aAutoLock  = true;                   // auto-filled columns (Month, Reviewer, Target, Total Reviews, Avg QA Score, Avg Rating): always read-only for everyone

        return (
            <div className="max-w-7xl mx-auto flex flex-col gap-3 px-2 pt-2 pb-6" style={{minHeight:"calc(100vh - 80px)"}}>
                {/* Back */}
                <button onClick={()=>router.back()} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 transition-colors group self-start mt-1">
                    <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    Back to Reports
                </button>
                {viewOnly && isSubmitted && (
                    <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 text-[13px] font-medium">
                        You are viewing this report in read-only mode.
                    </div>
                )}
                {/* Card */}
                <div className="flex flex-col flex-1 min-h-0 bg-white dark:bg-[#28283a] border border-slate-300 dark:border-white/10 rounded-xl shadow-md overflow-hidden">
                    {/* Header */}
                    <div className="px-7 py-5 border-b border-slate-200 dark:border-white/10 bg-gradient-to-r from-slate-50 to-white dark:from-[#2e2e48] dark:to-[#32324a]">
                        <h1 className="text-lg font-bold text-slate-900 dark:text-white">QA Team Monthly Report — {monthName} {year}</h1>
                    </div>
                    {/* Scrollable body */}
                    <div className="flex-1 overflow-y-auto px-7 py-6">
                        {submitError && <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{submitError}</div>}

                        {/* ── Section A ── */}
                        {andrewTab === "A" && (
                        <div>
                            <div className="mb-3 rounded-t-lg px-4 py-2" style={{background:"linear-gradient(90deg,#e87722,#f59e0b)"}}>
                                <h2 className="text-base font-bold text-white">Section A <span className="text-[11px] font-normal opacity-90">(To be filled by Andrew and Abhishek both)</span></h2>
                            </div>
                            <DragScrollDiv className="overflow-x-auto rounded-b-lg border border-t-0 border-slate-300 shadow-sm">
                                <table ref={abTableRef as any} className="border-collapse w-full" style={{minWidth:1600}}>
                                    <thead>
                                        <tr>
                                            <ATh colIndex={0} widths={abColWidths} setWidths={setAbColWidths} tableRef={abTableRef as any} colCount={15}>Month <span style={{color:"#fca5a5"}}>*</span></ATh>
                                            <ATh colIndex={1} widths={abColWidths} setWidths={setAbColWidths}>Reviewer <span style={{color:"#fca5a5"}}>*</span></ATh>
                                            <ATh colIndex={2} widths={abColWidths} setWidths={setAbColWidths}>Target for the month? <span style={{color:"#fca5a5"}}>*</span></ATh>
                                            <ATh colIndex={3} widths={abColWidths} setWidths={setAbColWidths}>Total No. of Reviews Done for the month? <span style={{color:"#fca5a5"}}>*</span></ATh>
                                            <ATh colIndex={4} widths={abColWidths} setWidths={setAbColWidths}>Avg. Writer/Editor QA Score</ATh>
                                            <ATh colIndex={5} widths={abColWidths} setWidths={setAbColWidths}>Reason for variance if any? <span style={{color:"#fca5a5"}}>*</span></ATh>
                                            <ATh colIndex={6} widths={abColWidths} setWidths={setAbColWidths}>Average Rating of the cases reviewed? <span style={{color:"#fca5a5"}}>*</span></ATh>
                                            <ATh colIndex={7} widths={abColWidths} setWidths={setAbColWidths}>No. of cases in which major changes came? <span style={{color:"#fca5a5"}}>*</span></ATh>
                                            <ATh colIndex={8} widths={abColWidths} setWidths={setAbColWidths}>Best case for the last month along with a reason? <span style={{color:"#fca5a5"}}>*</span></ATh>
                                            <ATh colIndex={9} widths={abColWidths} setWidths={setAbColWidths}>Least interesting case for the last month along with a reason? <span style={{color:"#fca5a5"}}>*</span></ATh>
                                            <ATh colIndex={10} widths={abColWidths} setWidths={setAbColWidths}>Cases where you suggested something new or identified some pattern? <span style={{color:"#fca5a5"}}>*</span></ATh>
                                            <ATh colIndex={11} widths={abColWidths} setWidths={setAbColWidths}>Capsules in which repetitive issues are occurring? (mention writer/editor) <span style={{color:"#fca5a5"}}>*</span></ATh>
                                            <ATh colIndex={12} widths={abColWidths} setWidths={setAbColWidths}>1 Win from last month <span style={{color:"#fca5a5"}}>*</span></ATh>
                                            <ATh colIndex={13} widths={abColWidths} setWidths={setAbColWidths}>1 Roadblock from last month <span style={{color:"#fca5a5"}}>*</span></ATh>
                                            <ATh colIndex={14} widths={abColWidths} setWidths={setAbColWidths}><span style={{color:"#fde68a",fontStyle:"italic",fontSize:"10px",fontWeight:400}}>Remark (optional)</span></ATh>
                                            <th className="px-2 py-2 bg-[#1e3a5f] border border-[#2a4a6f] w-8"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {andrewBRows.map((row,idx) => (
                                            <tr key={row.id} className="hover:bg-amber-50/40">
                                                <ATd><span className="font-medium text-slate-600 text-[12px]">{idx===0 ? monthName : ""}</span></ATd>
                                                <ATd>
                                                    <select value={row.reviewer} onChange={e=>setAB(idx,"reviewer",e.target.value)} disabled={!isAdmin} className={`w-full bg-transparent text-[13px] focus:outline-none appearance-none ${!isAdmin ? "opacity-60 cursor-default" : ""}`}>
                                                        <option value="">—</option>
                                                        <option>Andrew</option><option>Abhishek</option><option>Andrew/Diya</option>
                                                    </select>
                                                </ATd>
                                                <ATd><AInput value={row.targetForMonth} onChange={v=>setAB(idx,"targetForMonth",v)} disabled={aAutoLock} /></ATd>
                                                <ATd><AInput value={row.totalReviewsDone} onChange={v=>setAB(idx,"totalReviewsDone",v)} disabled={aAutoLock} /></ATd>
                                                <ATd><AInput value={row.avgWriterEditorQaScore} onChange={v=>setAB(idx,"avgWriterEditorQaScore",v)} disabled={aAutoLock} /></ATd>
                                                <ATd><ATextarea value={row.reasonVariance} onChange={v=>setAB(idx,"reasonVariance",v)} disabled={aDisabled} /></ATd>
                                                <ATd><AInput value={row.avgRating} onChange={v=>setAB(idx,"avgRating",v)} disabled={aAutoLock} /></ATd>
                                                <ATd><AInput value={row.casesMajorChanges} onChange={v=>setAB(idx,"casesMajorChanges",v)} disabled={aDisabled} /></ATd>
                                                <ATd><ATextarea value={row.bestCase} onChange={v=>setAB(idx,"bestCase",v)} disabled={aDisabled} /></ATd>
                                                <ATd><ATextarea value={row.leastInterestingCase} onChange={v=>setAB(idx,"leastInterestingCase",v)} disabled={aDisabled} /></ATd>
                                                <ATd><ATextarea value={row.suggestedPattern} onChange={v=>setAB(idx,"suggestedPattern",v)} disabled={aDisabled} /></ATd>
                                                <ATd><ATextarea value={row.repetitiveIssues} onChange={v=>setAB(idx,"repetitiveIssues",v)} disabled={aDisabled} /></ATd>
                                                <ATd><ATextarea value={row.winLastMonth} onChange={v=>setAB(idx,"winLastMonth",v)} disabled={aDisabled} /></ATd>
                                                <ATd><ATextarea value={row.roadblockLastMonth} onChange={v=>setAB(idx,"roadblockLastMonth",v)} disabled={aDisabled} /></ATd>
                                                <ATd><ATextarea value={row.remark} onChange={v=>setAB(idx,"remark",v)} placeholder="Remark…" disabled={aDisabled} /></ATd>
                                                <td className="px-2 py-2 border border-slate-200 bg-white text-center">
                                                    {andrewBRows.length>1 && !isLocked && (
                                                        <button onClick={()=>setAndrewBRows(p=>p.filter((_,i)=>i!==idx))} className="text-red-400 hover:text-red-600 transition-colors">
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </DragScrollDiv>
                            {!isLocked && (
                                <button onClick={()=>setAndrewBRows(p=>[...p,mkAB(`b-${Date.now()}`)])} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-amber-600 hover:text-amber-700">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>Add row
                                </button>
                            )}
                        </div>
                        )}

                        {/* ── Section B — Rohini & Shikha Thumbnails ── */}
                        {andrewTab === "B" && (
                        <div>
                            <div className="mb-3 rounded-t-lg px-4 py-2 flex items-center gap-3" style={{background:"linear-gradient(90deg,#e87722,#f59e0b)"}}>
                                <h2 className="text-base font-bold text-white">Section B: A Quick Overview of Rohini &amp; Shikha</h2>
                                <span className="text-[11px] text-amber-100 font-medium">(To be filled by Abhishek)</span>
                            </div>
                            <DragScrollDiv className="overflow-x-auto rounded-b-lg border border-t-0 border-slate-300 shadow-sm">
                                <table ref={sbTableRef as any} className="border-collapse w-full" style={{minWidth:900}}>
                                    <thead>
                                        <tr>
                                            <ATh colIndex={0} widths={sbColWidths} setWidths={setSbColWidths} tableRef={sbTableRef as any} colCount={5}>Month <span style={{color:"#fca5a5"}}>*</span></ATh>
                                            <ATh colIndex={1} widths={sbColWidths} setWidths={setSbColWidths}>Respective Person <span style={{color:"#fca5a5"}}>*</span></ATh>
                                            <ATh colIndex={2} widths={sbColWidths} setWidths={setSbColWidths}>Number of Thumbnails Done <span style={{color:"#fca5a5"}}>*</span></ATh>
                                            <ATh colIndex={3} widths={sbColWidths} setWidths={setSbColWidths}>Average CTR of Monthly Uploads <span style={{color:"#fca5a5"}}>*</span></ATh>
                                            <ATh colIndex={4} widths={sbColWidths} setWidths={setSbColWidths}><span style={{color:"#fde68a",fontStyle:"italic",fontSize:"10px",fontWeight:400}}>Remark (optional)</span></ATh>
                                            <th className="px-2 py-2 bg-[#1e3a5f] border border-[#2a4a6f] w-8"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {andrewSBRows.map((row,idx) => (
                                            <tr key={row.id} className="hover:bg-amber-50/40">
                                                <ATd><span className="font-medium text-slate-600 text-[12px]">{idx===0 ? monthName : ""}</span></ATd>
                                                <ATd>
                                                    <span className="text-[13px] text-slate-800 dark:text-slate-200">{row.person || "—"}</span>
                                                </ATd>
                                                <ATd>
                                                    <span className="text-[13px] text-slate-800 dark:text-slate-200">{row.thumbnailsDone || "—"}</span>
                                                </ATd>
                                                <ATd>
                                                    <ATextarea value={row.avgCtr} onChange={v=>setSBR(idx,"avgCtr",v)} placeholder="e.g. M7cs -9.7 and M7 - 8.1" disabled={aDisabled} />
                                                </ATd>
                                                <ATd><ATextarea value={row.remark} onChange={v=>setSBR(idx,"remark",v)} placeholder="Remark…" disabled={aDisabled} /></ATd>
                                                <td className="px-2 py-2 border border-slate-200 bg-white text-center">
                                                    {andrewSBRows.length>1 && !isLocked && (
                                                        <button onClick={()=>setAndrewSBRows(p=>p.filter((_,i)=>i!==idx))} className="text-red-400 hover:text-red-600 transition-colors">
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </DragScrollDiv>
                            {!isLocked && (
                                <button onClick={()=>setAndrewSBRows(p=>[...p,mkSBRow(`sb-${Date.now()}`)])} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-amber-600 hover:text-amber-700">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>Add row
                                </button>
                            )}
                        </div>
                        )}

                        {/* ── Section C — Monthly Views Comparison ── */}
                        {andrewTab === "C" && (
                        <div>
                            <div className="mb-3 rounded-t-lg px-4 py-2" style={{background:"linear-gradient(90deg,#e87722,#f59e0b)"}}>
                                <h2 className="text-base font-bold text-white">Section C: Monthly Views Comparison</h2>
                                <p className="text-[11px] text-amber-100 mt-0.5">Compare current month ({monthName} {year}) vs previous month views</p>
                            </div>
                            <DragScrollDiv className="overflow-x-auto rounded-b-lg border border-t-0 border-slate-300 shadow-sm">
                                <table ref={scTableRef as any} className="border-collapse w-full" style={{minWidth:800}}>
                                    <thead>
                                        <tr>
                                            <ATh colIndex={0} widths={scColWidths} setWidths={setScColWidths} tableRef={scTableRef as any} colCount={5}>Capsule / Channel <span style={{color:"#fca5a5"}}>*</span></ATh>
                                            <ATh colIndex={1} widths={scColWidths} setWidths={setScColWidths}>{monthName} {year} Views <span style={{color:"#fca5a5"}}>*</span></ATh>
                                            <ATh colIndex={2} widths={scColWidths} setWidths={setScColWidths}>Previous Month Views <span style={{color:"#fca5a5"}}>*</span></ATh>
                                            <ATh colIndex={3} widths={scColWidths} setWidths={setScColWidths}>Difference (↑ / ↓)</ATh>
                                            <ATh colIndex={4} widths={scColWidths} setWidths={setScColWidths}><span style={{color:"#fde68a",fontStyle:"italic",fontSize:"10px",fontWeight:400}}>Remark (optional)</span></ATh>
                                            <th className="px-2 py-2 bg-[#1e3a5f] border border-[#2a4a6f] w-8"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {andrewSCRows.map((row,idx) => {
                                            const cur = parseFloat(row.currentMonthViews.replace(/,/g,""));
                                            const prev = parseFloat(row.lastMonthViews.replace(/,/g,""));
                                            const diff = !isNaN(cur) && !isNaN(prev) ? cur - prev : null;
                                            return (
                                                <tr key={row.id} className="hover:bg-amber-50/40">
                                                    <ATd>
                                                        <AInput value={row.capsule} onChange={v=>setSCR(idx,"capsule",v)} placeholder="e.g. M7" disabled={aDisabled} />
                                                    </ATd>
                                                    <ATd>
                                                        <AInput value={row.currentMonthViews} onChange={v=>setSCR(idx,"currentMonthViews",v)} placeholder="e.g. 50000" disabled={aDisabled} />
                                                    </ATd>
                                                    <ATd>
                                                        <AInput value={row.lastMonthViews} onChange={v=>setSCR(idx,"lastMonthViews",v)} placeholder="e.g. 45000" disabled={aDisabled} />
                                                    </ATd>
                                                    <ATd>
                                                        {diff !== null
                                                            ? <span className={`text-[13px] font-semibold ${diff >= 0 ? "text-emerald-600" : "text-red-500"}`}>{diff >= 0 ? "↑" : "↓"} {Math.abs(diff).toLocaleString()}</span>
                                                            : <span className="text-slate-300 text-[12px] italic">auto</span>}
                                                    </ATd>
                                                    <ATd><ATextarea value={row.remark} onChange={v=>setSCR(idx,"remark",v)} placeholder="Remark…" disabled={aDisabled} /></ATd>
                                                    <td className="px-2 py-2 border border-slate-200 bg-white text-center">
                                                        {andrewSCRows.length>1 && !isLocked && (
                                                            <button onClick={()=>setAndrewSCRows(p=>p.filter((_,i)=>i!==idx))} className="text-red-400 hover:text-red-600 transition-colors">
                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </DragScrollDiv>
                            {!isLocked && (
                                <button onClick={()=>setAndrewSCRows(p=>[...p,mkSCRow(`sc-${Date.now()}`)])} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-amber-600 hover:text-amber-700">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>Add row
                                </button>
                            )}
                        </div>
                        )}
                    </div>
                    {/* Footer — tabs left, actions right */}
                    <div className="shrink-0 flex items-stretch border-t border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-[#22223a]">

                    {/* + button */}
                    <div className="flex items-center px-3 border-r border-slate-200 dark:border-white/10 text-slate-400">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                    </div>

                    {/* Tabs */}
                    <div className="flex items-end overflow-x-auto">
                        {([
                            { key: "A", label: "Section A",  sub: "QA Review" },
                            { key: "B", label: "Section B",  sub: "Rohini & Shikha" },
                            { key: "C", label: "Section C",  sub: "Monthly Views" },
                        ] as const).map(s => {
                            const active = andrewTab === s.key;
                            const accent = s.key === "A" ? "bg-amber-500" : s.key === "B" ? "bg-sky-500" : "bg-teal-500";
                            return (
                                <button key={s.key} onClick={() => setAndrewTab(s.key)}
                                    className={[
                                        "relative flex items-center gap-2 px-5 py-2.5 text-[13px] font-semibold whitespace-nowrap border-x border-t select-none transition-colors duration-150",
                                        active
                                            ? "bg-white dark:bg-[#32324a] text-slate-900 dark:text-white border-slate-300 dark:border-white/10 border-b-white dark:border-b-[#32324a] -mb-px z-10 shadow-sm"
                                            : "bg-slate-200/70 dark:bg-white/5 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-700 dark:hover:text-white",
                                    ].join(" ")}
                                >
                                    {active && <span className={`absolute top-0 inset-x-0 h-[3px] rounded-t ${accent}`} />}
                                    {s.label}
                                    <span className={["text-[11px] font-medium px-1.5 py-0.5 rounded", active ? "bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-200" : "bg-slate-300/60 dark:bg-white/5 text-slate-400 dark:text-slate-500"].join(" ")}>
                                        {s.sub}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Actions */}
                    <div className="ml-auto flex items-center gap-2.5 px-5">
                        {viewOnly && isSubmitted && (
                            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 text-[12px] font-medium">View Only</span>
                        )}
                        {submitError && <p className="text-[11px] text-red-500 font-medium">{submitError}</p>}
                        {isDraftSaved && !isSubmitted && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 font-medium bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                                Draft saved
                            </span>
                        )}
                        {isLocked ? (
                            <div className="flex items-center gap-2 px-4 py-[7px] rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-[13px] font-semibold">Submitted</div>
                        ) : !viewOnly ? (
                            <>
                                {isDraftSaved && (showDeleteConfirm ? (
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[11px] text-red-600 font-medium">Delete draft?</span>
                                        <button onClick={handleDeleteDraft} disabled={deletingDraft} className="px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold disabled:opacity-50">Yes, delete</button>
                                        <button onClick={()=>setShowDeleteConfirm(false)} className="px-2.5 py-1 rounded-md border border-slate-300 text-slate-500 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
                                    </div>
                                ) : (
                                    <button onClick={()=>setShowDeleteConfirm(true)} disabled={deletingDraft||submitting} title="Delete Draft"
                                        className="p-[7px] rounded-lg border border-red-200 bg-white hover:bg-red-50 text-red-500 shadow-sm transition-colors disabled:opacity-50">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    </button>
                                ))}
                                <button onClick={handleSaveDraft} disabled={submitting||!statusLoaded}
                                    className="flex items-center gap-1.5 px-3.5 py-[7px] rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-600 text-[13px] font-medium shadow-sm transition-colors">
                                    <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                                    Save as Draft
                                </button>
                                <button onClick={()=>setShowConfirm(true)} disabled={submitting||!statusLoaded}
                                    className="flex items-center gap-1.5 px-4 py-[7px] rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[13px] font-semibold shadow-sm transition-colors">
                                    {submitting ? <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>Submitting…</>
                                    : <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>Send to CEO</>}
                                </button>
                            </>
                        ) : null}
                    </div>
                </div>
                </div>
                {showConfirm && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4">
                            <h3 className="text-lg font-bold text-slate-900 mb-2">Submit Report?</h3>
                            <p className="text-sm text-slate-600 mb-6">Once submitted, the report will be locked and cannot be edited.</p>
                            <div className="flex gap-3 justify-end">
                                <button onClick={()=>setShowConfirm(false)} className="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors">Cancel</button>
                                <button onClick={handleSubmit} disabled={submitting} className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#1e3a5f] text-white hover:bg-[#162d4a] transition-colors disabled:opacity-50">{submitting ? "Submitting…" : "Yes, Submit"}</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    /* ──────────────── Nishant Bhatia Monthly Report ──────────────── */
    if (isResearcherReport) {
        const NTh = ({ children, colIndex, overview, tableRef, colCount }: { children: React.ReactNode; colIndex: number; overview?: boolean; tableRef?: React.RefObject<HTMLTableElement | null>; colCount?: number }) => (
            <ResizableTh
                colIndex={colIndex}
                widths={overview ? nOvColWidths : nColWidths}
                setWidths={overview ? setNOvColWidths : setNColWidths}
                minWidth={80}
                className="px-3 py-2.5 text-left text-[12px] font-bold text-white bg-[#1a4a3a] border border-[#2a5a4a] whitespace-normal leading-tight"
                tableRef={tableRef}
                colCount={colCount}
            >
                {children}
            </ResizableTh>
        );

        return (
            <>
            <div className="max-w-5xl mx-auto pb-16 space-y-6 px-2">
                {/* Back */}
                <button onClick={() => router.back()} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 transition-colors group mt-2">
                    <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Back to Reports
                </button>

                {/* View-only banner */}
                {viewOnly && isSubmitted && (
                    <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 text-[13px] font-medium">
                        {isCeo ? "You are viewing this report as CEO — read-only mode." : hasExplicitAccess ? "You have been granted view access to this report." : "You are viewing this report in read-only mode."}
                    </div>
                )}

                {/* Title banner */}
                <div className="rounded-t-xl overflow-hidden shadow-md">
                    <div className="bg-[#0d2137] px-6 pt-1 pb-2 text-left">
                        <h1 className="text-lg font-bold text-white">Nishant's Monthly Report for the month of {monthName}</h1>
                        <p className="text-xl font-semibold text-white/80 mt-0.5">Monthly Report of Researchers <span className="text-base font-normal text-white/60">— {monthName} {year}</span></p>
                    </div>
                    <div className="bg-[#e87722] px-6 py-3 text-center">
                        <p className="text-[12px] text-white font-medium leading-snug">
                            To be submitted after you have discussed it with Bhoomika and have distributed the cases across the capsules.
                            We expect it that you submit the report every last Friday of the month.
                        </p>
                    </div>
                </div>

                {/* Error / draft saved */}
                {!viewOnly && submitError && <p className="text-[12px] text-red-500 font-medium">{submitError}</p>}
                {!viewOnly && isDraftSaved && <p className="text-[12px] text-green-600 font-medium">✓ Draft saved</p>}

                {/* Main researcher table */}
                <DragScrollDiv className="overflow-x-auto rounded-xl border border-slate-300 dark:border-white/10 shadow-sm">
                    <table ref={nResTableRef} className="border-collapse w-full" style={{ minWidth: 1100, tableLayout: "fixed" }}>
                        <thead>
                            <tr>
                                <NTh colIndex={0} tableRef={nResTableRef} colCount={9}>Researcher</NTh>
                                <NTh colIndex={1}>No. of Approved cases(RTC)</NTh>
                                <NTh colIndex={2}>Average rating of the cases</NTh>
                                <NTh colIndex={3}>No. of Approved cases(FOIA)</NTh>
                                <NTh colIndex={4}>Expected Target of RTC</NTh>
                                <NTh colIndex={5}>Expected Number of FOIA to be pitched?</NTh>
                                <NTh colIndex={6}>Actual Number of FOIA pitched?</NTh>
                                <NTh colIndex={7}>FOIA received?</NTh>
                                <NTh colIndex={8}>Overall Remarks</NTh>
                                {(!isLocked || isAdmin) && <th className="px-2 bg-[#1a4a3a] border border-[#2a5a4a]" />}
                            </tr>
                        </thead>
                        <tbody>
                            {nRows.map((row, idx) => (
                                <tr key={row.id} className="group hover:bg-emerald-50/40 dark:hover:bg-emerald-900/20 transition-colors">
                                    <NCell colored="bg-slate-50 dark:bg-[#2a2a42] text-slate-700 dark:text-slate-300 font-medium"><NInput value={row.researcher} onChange={v => setNR(idx, "researcher", v)} placeholder="Name" /></NCell>
                                    <NCell center colored="bg-emerald-50 dark:bg-emerald-900/20 text-slate-800 dark:text-slate-200">
                                        <span className="text-[13px] font-medium">
                                            {row.approvedCasesRTC || <span className="text-slate-400 dark:text-slate-500 italic text-[12px]">auto</span>}
                                        </span>
                                    </NCell>
                                    <NCell center colored="bg-emerald-50 dark:bg-emerald-900/20 text-slate-800 dark:text-slate-200">
                                        <span className="text-[13px] font-medium">
                                            {row.avgRating || <span className="text-slate-400 dark:text-slate-500 italic text-[12px]">auto</span>}
                                        </span>
                                    </NCell>
                                    <NCell center colored={`bg-white dark:bg-[#32324a] ${row.approvedCasesFOIA && !isNaN(Number(row.approvedCasesFOIA)) && Number(row.approvedCasesFOIA) > 20 ? "text-red-600 font-semibold" : "text-slate-800 dark:text-slate-200"}`}><NInput value={row.approvedCasesFOIA} onChange={v => setNR(idx, "approvedCasesFOIA", v)} placeholder="N/A" /></NCell>
                                    <NCell center><NInput value={row.expectedTargetRTC} onChange={v => setNR(idx, "expectedTargetRTC", v)} placeholder="" /></NCell>
                                    <NCell center><NInput value={row.expectedFOIAPitched} onChange={v => setNR(idx, "expectedFOIAPitched", v)} placeholder="" /></NCell>
                                    <NCell center><NInput value={row.actualFOIAPitched} onChange={v => setNR(idx, "actualFOIAPitched", v)} placeholder="" /></NCell>
                                    <NCell center><NInput value={row.foiaReceived} onChange={v => setNR(idx, "foiaReceived", v)} placeholder="" /></NCell>
                                    <NCell colored="bg-white dark:bg-[#32324a] text-amber-700 dark:text-amber-400"><NInput value={row.overallRemarks} onChange={v => setNR(idx, "overallRemarks", v)} placeholder="Remarks…" /></NCell>
                                    {(!isLocked || isAdmin) && (
                                        <td className="px-2 py-2 border border-slate-200 dark:border-white/10 bg-white dark:bg-[#32324a] text-center">
                                            {nRows.length > 1 && (
                                                <button onClick={() => removeNR(idx)} className="text-red-400 hover:text-red-600 transition-colors">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            )}
                                        </td>
                                    )}
                                </tr>
                            ))}
                            {/* Totals row */}
                            <tr className="bg-slate-100 dark:bg-[#2a2a42] font-semibold">
                                <td className="px-3 py-2.5 border border-slate-300 dark:border-white/10 text-[13px] text-slate-600 dark:text-slate-400 italic">Totals</td>
                                {["approvedCasesRTC","avgRating","approvedCasesFOIA","expectedTargetRTC","expectedFOIAPitched","actualFOIAPitched","foiaReceived"].map(f => {
                                    const nums = nRows.map(r => parseFloat((r as any)[f])).filter(n => !isNaN(n));
                                    const val = f === "avgRating"
                                        ? (nums.length ? (nums.reduce((a,b)=>a+b,0)/nums.length).toFixed(2) : "—")
                                        : (nums.length ? nums.reduce((a,b)=>a+b,0) : "—");
                                    return <td key={f} className="px-3 py-2.5 border border-slate-300 dark:border-white/10 text-[13px] text-center text-slate-800 dark:text-slate-200">{val}</td>;
                                })}
                                <td className="px-3 py-2.5 border border-slate-300 dark:border-white/10" />
                                {(!isLocked || isAdmin) && <td className="border border-slate-200 dark:border-white/10 bg-white dark:bg-[#32324a]" />}
                            </tr>
                        </tbody>
                    </table>
                </DragScrollDiv>

                {(!isLocked || isAdmin) && (
                    <button onClick={addNR} className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800 transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                        </svg>
                        Add researcher row
                    </button>
                )}


                {/* Footer buttons */}
                <div className="flex items-center justify-end gap-3 pt-2">
                    {isLocked && !isAdmin ? (
                        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 border border-green-200 text-green-700 text-[12px] font-semibold">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                            Submitted & Locked
                        </span>
                    ) : !viewOnly ? (
                        <>
                            {/* Delete Draft — only visible when a draft exists */}
                            {isDraftSaved && !isLocked && (
                                showDeleteConfirm ? (
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[11px] text-red-600 font-medium">Delete draft?</span>
                                        <button onClick={handleDeleteDraft} disabled={deletingDraft}
                                            className="px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold disabled:opacity-50 transition-colors">
                                            Yes, delete
                                        </button>
                                        <button onClick={() => setShowDeleteConfirm(false)}
                                            className="px-2.5 py-1 rounded-md border border-slate-300 text-slate-500 text-[11px] font-medium hover:bg-slate-50 transition-colors">
                                            Cancel
                                        </button>
                                    </div>
                                ) : (
                                    <button onClick={() => setShowDeleteConfirm(true)} disabled={deletingDraft || submitting}
                                        title="Delete Draft"
                                        className="p-2 rounded-lg border border-red-200 bg-white hover:bg-red-50 text-red-500 shadow-sm transition-colors disabled:opacity-50">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                )
                            )}

                            <button onClick={handleSaveDraft} disabled={submitting || !statusLoaded}
                                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-[13px] font-medium shadow-sm transition-colors disabled:opacity-50">
                                <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                                </svg>
                                Save as Draft
                            </button>
                            <button onClick={() => setShowConfirm(true)} disabled={submitting || !statusLoaded}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[13px] font-semibold shadow-sm transition-colors disabled:opacity-50">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                                {submitting ? "Submitting…" : "Send to CEO"}
                            </button>
                        </>
                    ) : null}
                </div>
            </div>

            {/* Confirmation modal */}
            {showConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowConfirm(false)} />
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
                        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-50 mx-auto">
                            <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <div className="text-center">
                            <h3 className="text-[15px] font-bold text-slate-900">Submit this report?</h3>
                            <p className="text-[13px] text-slate-500 mt-1.5 leading-relaxed">Once submitted, the report will be <span className="font-medium text-slate-700">locked</span> and cannot be edited.</p>
                            <p className="text-[13px] text-slate-500 mt-2">This report will be <span className="font-semibold text-slate-800">sent to the CEO</span> for review.</p>
                        </div>
                        <div className="flex gap-2.5 mt-1">
                            <button onClick={() => setShowConfirm(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[13px] font-semibold transition-colors">Cancel</button>
                            <button onClick={handleSubmit} className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-[13px] font-semibold transition-colors shadow-sm">Yes, Submit</button>
                        </div>
                    </div>
                </div>
            )}
            </>
        );
    }

    /* ──────────────── Tanvi Dogra HR Manager Monthly Report ──────────────── */
    if (isHrReport) {
        const locked = isLocked && !isAdmin;

        // ── Reusable primitives ──
        const HrTh = ({ children }: { children: React.ReactNode }) => (
            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white bg-[#1e3a5f] border border-[#1e3a5f]/60 whitespace-normal leading-snug">{children}</th>
        );
        const HrTd = ({ children, className = "" }: { children?: React.ReactNode; className?: string }) => (
            <td className={`px-3 py-2.5 border-b border-slate-100 dark:border-white/5 text-[13px] align-top text-white ${className}`}>{children}</td>
        );
        const HrInput = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
            <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={locked ? "" : "—"} readOnly={locked}
                className={`w-full bg-transparent text-[13px] text-white placeholder:text-slate-400 focus:outline-none rounded px-1 py-0.5 ${locked ? "cursor-default" : "hover:bg-blue-50/50 dark:hover:bg-white/5 focus:bg-blue-50 dark:focus:bg-white/10 focus:ring-1 focus:ring-blue-300/60"} transition-colors`} />
        );
        const HrTextarea = ({ value, onChange, rows = 3 }: { value: string; onChange: (v: string) => void; rows?: number }) => (
            <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={locked ? "" : "Type here…"} readOnly={locked} rows={rows}
                className={`w-full rounded-lg border text-[13px] px-3 py-2.5 text-white placeholder:text-slate-400 focus:outline-none resize-y transition-all leading-relaxed ${locked ? "bg-slate-50 dark:bg-white/[0.03] border-slate-100 dark:border-white/5 cursor-default opacity-80" : "bg-white dark:bg-[#1a1a32] border-slate-200 dark:border-white/10 focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400/60 shadow-sm"}`} />
        );
        const HrSelect = ({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) => (
            <select value={value} onChange={e => onChange(e.target.value)} disabled={locked}
                className={`w-full text-[13px] text-white bg-transparent focus:outline-none rounded px-1 py-0.5 ${locked ? "cursor-default" : "hover:bg-blue-50/50 dark:hover:bg-white/5 focus:ring-1 focus:ring-blue-300/60"} transition-colors`}>
                <option value="">—</option>
                {options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
        );
        const SectionHeader = ({ num, title, objective, color = "#1e3a5f" }: { num: string; title: string; objective?: string; color?: string }) => (
            <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-100 dark:border-white/5 bg-slate-50/60 dark:bg-white/[0.02]">
                <span className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[12px] font-bold shadow-sm" style={{ background: color, color: "#ffffff" }}>{num}</span>
                <div>
                    <h2 className="text-[14px] font-bold text-white leading-tight">{title}</h2>
                    {objective && <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{objective}</p>}
                </div>
            </div>
        );
        const SubHeader = ({ label }: { label: string }) => (
            <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 rounded-full bg-[#1e3a5f]/60" />
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-white">{label}</h3>
            </div>
        );
        const AddRowBtn = ({ onClick }: { onClick: () => void }) => (
            <button onClick={onClick} className="mt-2.5 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-500/30 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                Add Row
            </button>
        );
        const DelBtn = ({ onClick }: { onClick: () => void }) => (
            <td className="px-1.5 border-b border-slate-100 dark:border-white/5 w-7">
                <button onClick={onClick} className="w-5 h-5 flex items-center justify-center rounded text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </td>
        );

        return (
            <div className="max-w-5xl mx-auto pb-16 space-y-5 px-2">
                {/* ── Back ── */}
                <button onClick={() => router.back()} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors group mt-2">
                    <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Back to Reports
                </button>

                {/* ── View-only banner ── */}
                {viewOnly && isSubmitted && (
                    <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-500/20 text-sky-700 dark:text-sky-300 text-[13px] font-medium">
                        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        {isCeo ? "You are viewing this report as CEO — read-only mode." : "You are viewing this report in read-only mode."}
                    </div>
                )}

                {/* ── Document shell ── */}
                <div className="bg-white dark:bg-[#0f0f23] border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl overflow-hidden">

                    {/* Document header */}
                    <div className="relative px-8 pt-7 pb-6 border-b border-slate-100 dark:border-white/5" style={{ background: "linear-gradient(135deg,#0f172a 0%,#1e3a5f 60%,#1e40af 100%)" }}>
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[10px] font-semibold tracking-[0.15em] uppercase mb-1" style={{ color: "#ffffff" }}>NB Media Productions</p>
                                <h1 className="text-2xl font-bold leading-tight" style={{ color: "#ffffff" }}>HR Manager Monthly Report</h1>
                                <p className="text-sm mt-1.5" style={{ color: "#ffffff" }}>Reporting Period: <span className="font-medium" style={{ color: "#ffffff" }}>{monthName} 1 – {monthName} {new Date(year, monthIndex + 1, 0).getDate()}, {year}</span></p>
                            </div>
                            <div className="text-right shrink-0">
                                {isSubmitted && (
                                    <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30">
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                        <span className="text-[11px] text-emerald-300 font-medium">Submitted</span>
                                    </div>
                                )}
                                {isDraftSaved && !isSubmitted && (
                                    <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-400/30">
                                        <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                        <span className="text-[11px] text-amber-300 font-medium">Draft Saved</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        {/* Meta row */}
                        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-1.5 text-[12px]" style={{ color: "#ffffff" }}>
                            <span>To: <span className="font-medium">CEO</span></span>
                            <span>From: <span className="font-medium">HR Manager</span></span>
                            <span>Submit by: <span className="font-medium">Last Friday of {monthName}</span></span>
                        </div>
                    </div>

                    {submitError && (
                        <div className="mx-6 mt-4 px-4 py-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-[13px]">{submitError}</div>
                    )}

                    <div className="divide-y divide-slate-100 dark:divide-white/5">

                        {/* ── Section 1: Key Highlights & Concerns ── */}
                        <div>
                            <SectionHeader num="1" title="Key Highlights & Concerns" objective="Mandatory — summarise the month's most important outcomes and risks." color="#1e3a5f" />
                            <div className="px-6 py-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {([
                                    { label: "Top 3 Achievements This Month", key: "top3Achievements" as const, rows: 4 },
                                    { label: "Top 3 Risks / Issues", key: "top3Risks" as const, rows: 4 },
                                    { label: "Any Critical Escalations", key: "criticalEscalations" as const, rows: 3 },
                                    { label: "Support Required from Leadership", key: "supportRequired" as const, rows: 3 },
                                ]).map(({ label, key, rows }) => (
                                    <div key={key} className="flex flex-col gap-1.5">
                                        <label className="text-[11px] font-semibold uppercase tracking-wide text-white">{label}</label>
                                        <HrTextarea value={hrHighlights[key]} onChange={v => setHrHighlights(p => ({ ...p, [key]: v }))} rows={rows} />
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* ── Section 2: System Compliance Index ── */}
                        <div>
                            <SectionHeader num="2" title="System Compliance Index" objective="Identify and act on non-compliance cases." color="#1e3a5f" />
                            <div className="px-6 py-5">
                                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-white/10 shadow-sm">
                                    <table className="w-full border-collapse" style={{ minWidth: 800 }}>
                                        <thead><tr className="border-b border-slate-200 dark:border-white/10">
                                            <HrTh>Employee Name</HrTh><HrTh>Issue Type</HrTh><HrTh>Description</HrTh>
                                            <HrTh>Severity</HrTh><HrTh>Action by HR</HrTh><HrTh>Status</HrTh>
                                            {!locked && <th className="bg-[#1e3a5f] w-8" />}
                                        </tr></thead>
                                        <tbody>
                                            {hrComplianceRows.map((row, idx) => (
                                                <tr key={row.id} className={idx % 2 === 0 ? "bg-white dark:bg-transparent" : "bg-slate-50/60 dark:bg-white/[0.015]"}>
                                                    <HrTd><HrInput value={row.employeeName} onChange={v => setHrComplianceRows(p => p.map((r, i) => i === idx ? { ...r, employeeName: v } : r))} /></HrTd>
                                                    <HrTd><HrSelect value={row.issueType} onChange={v => setHrComplianceRows(p => p.map((r, i) => i === idx ? { ...r, issueType: v } : r))} options={["SOP Discipline", "Attendance", "Leave", "Policy", "Escalation"]} /></HrTd>
                                                    <HrTd><HrInput value={row.descriptionOfIssue} onChange={v => setHrComplianceRows(p => p.map((r, i) => i === idx ? { ...r, descriptionOfIssue: v } : r))} /></HrTd>
                                                    <HrTd>
                                                        <HrSelect value={row.severity} onChange={v => setHrComplianceRows(p => p.map((r, i) => i === idx ? { ...r, severity: v } : r))} options={["Low", "Med", "High"]} />
                                                        {row.severity && <span className={`ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${row.severity === "High" ? "bg-red-100 text-red-600" : row.severity === "Med" ? "bg-amber-100 text-amber-600" : "bg-green-100 text-green-600"}`}>{row.severity}</span>}
                                                    </HrTd>
                                                    <HrTd><HrInput value={row.actionTakenByHR} onChange={v => setHrComplianceRows(p => p.map((r, i) => i === idx ? { ...r, actionTakenByHR: v } : r))} /></HrTd>
                                                    <HrTd>
                                                        <HrSelect value={row.currentStatus} onChange={v => setHrComplianceRows(p => p.map((r, i) => i === idx ? { ...r, currentStatus: v } : r))} options={["Open", "Closed"]} />
                                                        {row.currentStatus && <span className={`ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${row.currentStatus === "Closed" ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-600"}`}>{row.currentStatus}</span>}
                                                    </HrTd>
                                                    {!locked && <DelBtn onClick={() => setHrComplianceRows(p => p.filter((_, i) => i !== idx))} />}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                {!locked && <AddRowBtn onClick={() => setHrComplianceRows(p => [...p, { id: `c-${Date.now()}`, employeeName: "", issueType: "", descriptionOfIssue: "", severity: "", actionTakenByHR: "", currentStatus: "" }])} />}
                            </div>
                        </div>

                        {/* ── Section 3: Hiring Quality Index ── */}
                        <div>
                            <SectionHeader num="3" title="Hiring Quality Index" objective="Track hiring effectiveness and early-stage employee stability." color="#1e3a5f" />
                            <div className="px-6 py-5 space-y-6">
                                {/* 3A */}
                                <div>
                                    <SubHeader label="A. New Joinees with Concerns (Within 90 Days)" />
                                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-white/10 shadow-sm">
                                        <table className="w-full border-collapse" style={{ minWidth: 900 }}>
                                            <thead><tr className="border-b border-slate-200 dark:border-white/10">
                                                <HrTh>Employee Name</HrTh><HrTh>Position</HrTh><HrTh>Days to Close</HrTh>
                                                <HrTh>Quality of Hire</HrTh><HrTh>Issue Observed</HrTh><HrTh>HR Intervention</HrTh><HrTh>Status</HrTh>
                                                {!locked && <th className="bg-[#1e3a5f] w-8" />}
                                            </tr></thead>
                                            <tbody>
                                                {hrNewJoineeRows.map((row, idx) => (
                                                    <tr key={row.id} className={idx % 2 === 0 ? "bg-white dark:bg-transparent" : "bg-slate-50/60 dark:bg-white/[0.015]"}>
                                                        <HrTd><HrInput value={row.employeeName} onChange={v => setHrNewJoineeRows(p => p.map((r, i) => i === idx ? { ...r, employeeName: v } : r))} /></HrTd>
                                                        <HrTd><HrInput value={row.position} onChange={v => setHrNewJoineeRows(p => p.map((r, i) => i === idx ? { ...r, position: v } : r))} /></HrTd>
                                                        <HrTd><HrInput value={row.daysTakenToClose} onChange={v => setHrNewJoineeRows(p => p.map((r, i) => i === idx ? { ...r, daysTakenToClose: v } : r))} /></HrTd>
                                                        <HrTd><HrSelect value={row.qualityOfHire} onChange={v => setHrNewJoineeRows(p => p.map((r, i) => i === idx ? { ...r, qualityOfHire: v } : r))} options={["Satisfactory", "Needs Improvement", "Non-Satisfactory"]} /></HrTd>
                                                        <HrTd><HrInput value={row.issueObserved} onChange={v => setHrNewJoineeRows(p => p.map((r, i) => i === idx ? { ...r, issueObserved: v } : r))} /></HrTd>
                                                        <HrTd><HrInput value={row.hrIntervention} onChange={v => setHrNewJoineeRows(p => p.map((r, i) => i === idx ? { ...r, hrIntervention: v } : r))} /></HrTd>
                                                        <HrTd><HrInput value={row.currentStatus} onChange={v => setHrNewJoineeRows(p => p.map((r, i) => i === idx ? { ...r, currentStatus: v } : r))} /></HrTd>
                                                        {!locked && <DelBtn onClick={() => setHrNewJoineeRows(p => p.filter((_, i) => i !== idx))} />}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    {!locked && <AddRowBtn onClick={() => setHrNewJoineeRows(p => [...p, { id: `nj-${Date.now()}`, employeeName: "", position: "", daysTakenToClose: "", qualityOfHire: "", issueObserved: "", hrIntervention: "", currentStatus: "" }])} />}
                                </div>
                                {/* 3B */}
                                <div>
                                    <SubHeader label="B. Hiring Summary" />
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {([
                                            { label: "Total Positions Closed", key: "totalPositionsClosed" as const },
                                            { label: "Roles Taking Unusually Long to Close", key: "rolesLongToClose" as const },
                                            { label: "Offer Acceptance Rate", key: "offerAcceptanceRate" as const },
                                            { label: "Quality Concerns Observed (Patterns)", key: "qualityConcerns" as const },
                                        ]).map(({ label, key }) => (
                                            <div key={key} className="flex flex-col gap-1.5">
                                                <label className="text-[11px] font-semibold uppercase tracking-wide text-white">{label}</label>
                                                <HrTextarea value={hrHiringSummary[key]} onChange={v => setHrHiringSummary(p => ({ ...p, [key]: v }))} rows={2} />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* ── Section 4: HR Governance ── */}
                        <div>
                            <SectionHeader num="4" title="HR Governance" objective="Ensure accuracy and hygiene of HR systems." color="#1e3a5f" />
                            <div className="px-6 py-5 grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <div>
                                    <SubHeader label="A. Work Completed This Month" />
                                    <div className="space-y-3">
                                        {([
                                            { label: "Contracts Created / Updated", key: "contractsCreated" as const },
                                            { label: "Employee Records Audited / Cleaned", key: "recordsAudited" as const },
                                            { label: "Policy Updates / Documentation Created", key: "policyUpdates" as const },
                                        ]).map(({ label, key }) => (
                                            <div key={key} className="flex flex-col gap-1.5">
                                                <label className="text-[11px] font-semibold uppercase tracking-wide text-white">{label}</label>
                                                <HrTextarea value={hrGovernanceWork[key]} onChange={v => setHrGovernanceWork(p => ({ ...p, [key]: v }))} rows={2} />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <SubHeader label="B. Gaps / Issues Identified" />
                                    <div className="space-y-3">
                                        {([
                                            { label: "Missing or Incorrect Records", key: "missingIncorrectRecords" as const },
                                            { label: "Delays or Process Breakdowns", key: "delaysProcessBreakdowns" as const },
                                        ]).map(({ label, key }) => (
                                            <div key={key} className="flex flex-col gap-1.5">
                                                <label className="text-[11px] font-semibold uppercase tracking-wide text-white">{label}</label>
                                                <HrTextarea value={hrGovernanceGaps[key]} onChange={v => setHrGovernanceGaps(p => ({ ...p, [key]: v }))} rows={2} />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* ── Section 5: Retention & Stability ── */}
                        <div>
                            <SectionHeader num="5" title="Retention & Stability" objective="Track exits, retention efforts, and workforce stability." color="#1e3a5f" />
                            <div className="px-6 py-5">
                                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-white/10 shadow-sm">
                                    <table className="w-full border-collapse" style={{ minWidth: 980 }}>
                                        <thead><tr className="border-b border-slate-200 dark:border-white/10">
                                            <HrTh>Employee Name</HrTh><HrTh>Position</HrTh><HrTh>Reason for Leaving</HrTh>
                                            <HrTh>Avoidable</HrTh><HrTh>High-Value?</HrTh>
                                            <HrTh>Action Taken to Retain</HrTh><HrTh>Key Learning</HrTh>
                                            {!locked && <th className="bg-[#1e3a5f] w-8" />}
                                        </tr></thead>
                                        <tbody>
                                            {hrRetentionRows.map((row, idx) => (
                                                <tr key={row.id} className={idx % 2 === 0 ? "bg-white dark:bg-transparent" : "bg-slate-50/60 dark:bg-white/[0.015]"}>
                                                    <HrTd><HrInput value={row.employeeName} onChange={v => setHrRetentionRows(p => p.map((r, i) => i === idx ? { ...r, employeeName: v } : r))} /></HrTd>
                                                    <HrTd><HrInput value={row.position} onChange={v => setHrRetentionRows(p => p.map((r, i) => i === idx ? { ...r, position: v } : r))} /></HrTd>
                                                    <HrTd><HrInput value={row.reasonForLeaving} onChange={v => setHrRetentionRows(p => p.map((r, i) => i === idx ? { ...r, reasonForLeaving: v } : r))} /></HrTd>
                                                    <HrTd><HrSelect value={row.avoidable} onChange={v => setHrRetentionRows(p => p.map((r, i) => i === idx ? { ...r, avoidable: v } : r))} options={["Y", "N"]} /></HrTd>
                                                    <HrTd><HrSelect value={row.highValueEmployee} onChange={v => setHrRetentionRows(p => p.map((r, i) => i === idx ? { ...r, highValueEmployee: v } : r))} options={["Y", "N"]} /></HrTd>
                                                    <HrTd><HrInput value={row.actionTakenToRetain} onChange={v => setHrRetentionRows(p => p.map((r, i) => i === idx ? { ...r, actionTakenToRetain: v } : r))} /></HrTd>
                                                    <HrTd><HrInput value={row.keyLearning} onChange={v => setHrRetentionRows(p => p.map((r, i) => i === idx ? { ...r, keyLearning: v } : r))} /></HrTd>
                                                    {!locked && <DelBtn onClick={() => setHrRetentionRows(p => p.filter((_, i) => i !== idx))} />}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                {!locked && <AddRowBtn onClick={() => setHrRetentionRows(p => [...p, { id: `r-${Date.now()}`, employeeName: "", position: "", reasonForLeaving: "", avoidable: "", highValueEmployee: "", actionTakenToRetain: "", keyLearning: "" }])} />}
                            </div>
                        </div>

                        {/* ── Section 6: Culture & Engagement ── */}
                        <div>
                            <SectionHeader num="6" title="Culture & Engagement" objective="Track engagement efforts and their actual impact." color="#1e3a5f" />
                            <div className="px-6 py-5 space-y-7">
                                {/* 6A */}
                                <div>
                                    <SubHeader label="A. Engagement Initiatives" />
                                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-white/10 shadow-sm">
                                        <table className="w-full border-collapse" style={{ minWidth: 680 }}>
                                            <thead><tr className="border-b border-slate-200 dark:border-white/10">
                                                <HrTh>Initiative</HrTh><HrTh>Objective</HrTh><HrTh>Participation Level</HrTh><HrTh>Feedback / Response</HrTh><HrTh>Observed Impact</HrTh>
                                                {!locked && <th className="bg-[#1e3a5f] w-8" />}
                                            </tr></thead>
                                            <tbody>
                                                {hrEngagementRows.map((row, idx) => (
                                                    <tr key={row.id} className={idx % 2 === 0 ? "bg-white dark:bg-transparent" : "bg-slate-50/60 dark:bg-white/[0.015]"}>
                                                        <HrTd><HrInput value={row.initiative} onChange={v => setHrEngagementRows(p => p.map((r, i) => i === idx ? { ...r, initiative: v } : r))} /></HrTd>
                                                        <HrTd><HrInput value={row.objective} onChange={v => setHrEngagementRows(p => p.map((r, i) => i === idx ? { ...r, objective: v } : r))} /></HrTd>
                                                        <HrTd><HrInput value={row.participationLevel} onChange={v => setHrEngagementRows(p => p.map((r, i) => i === idx ? { ...r, participationLevel: v } : r))} /></HrTd>
                                                        <HrTd><HrInput value={row.feedbackResponse} onChange={v => setHrEngagementRows(p => p.map((r, i) => i === idx ? { ...r, feedbackResponse: v } : r))} /></HrTd>
                                                        <HrTd><HrInput value={row.observedImpact} onChange={v => setHrEngagementRows(p => p.map((r, i) => i === idx ? { ...r, observedImpact: v } : r))} /></HrTd>
                                                        {!locked && <DelBtn onClick={() => setHrEngagementRows(p => p.filter((_, i) => i !== idx))} />}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    {!locked && <AddRowBtn onClick={() => setHrEngagementRows(p => [...p, { id: `e-${Date.now()}`, initiative: "", objective: "", participationLevel: "", feedbackResponse: "", observedImpact: "" }])} />}
                                </div>
                                {/* 6B */}
                                <div>
                                    <SubHeader label="B. Fun Activities" />
                                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-white/10 shadow-sm">
                                        <table className="w-full border-collapse" style={{ minWidth: 680 }}>
                                            <thead><tr className="border-b border-slate-200 dark:border-white/10">
                                                <HrTh>Activity Name</HrTh><HrTh>Objective</HrTh><HrTh>Participation Level</HrTh><HrTh>Feedback / Response</HrTh><HrTh>Observed Impact</HrTh>
                                                {!locked && <th className="bg-[#1e3a5f] w-8" />}
                                            </tr></thead>
                                            <tbody>
                                                {hrFunRows.map((row, idx) => (
                                                    <tr key={row.id} className={idx % 2 === 0 ? "bg-white dark:bg-transparent" : "bg-slate-50/60 dark:bg-white/[0.015]"}>
                                                        <HrTd><HrInput value={row.activityName} onChange={v => setHrFunRows(p => p.map((r, i) => i === idx ? { ...r, activityName: v } : r))} /></HrTd>
                                                        <HrTd><HrInput value={row.objective} onChange={v => setHrFunRows(p => p.map((r, i) => i === idx ? { ...r, objective: v } : r))} /></HrTd>
                                                        <HrTd><HrInput value={row.participationLevel} onChange={v => setHrFunRows(p => p.map((r, i) => i === idx ? { ...r, participationLevel: v } : r))} /></HrTd>
                                                        <HrTd><HrInput value={row.feedbackResponse} onChange={v => setHrFunRows(p => p.map((r, i) => i === idx ? { ...r, feedbackResponse: v } : r))} /></HrTd>
                                                        <HrTd><HrInput value={row.observedImpact} onChange={v => setHrFunRows(p => p.map((r, i) => i === idx ? { ...r, observedImpact: v } : r))} /></HrTd>
                                                        {!locked && <DelBtn onClick={() => setHrFunRows(p => p.filter((_, i) => i !== idx))} />}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    {!locked && <AddRowBtn onClick={() => setHrFunRows(p => [...p, { id: `f-${Date.now()}`, activityName: "", objective: "", participationLevel: "", feedbackResponse: "", observedImpact: "" }])} />}
                                </div>
                                {/* 6C */}
                                <div>
                                    <SubHeader label="C. Feedback Loops / Surveys" />
                                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-white/10 shadow-sm">
                                        <table className="w-full border-collapse" style={{ minWidth: 580 }}>
                                            <thead><tr className="border-b border-slate-200 dark:border-white/10">
                                                <HrTh>Method of Survey</HrTh><HrTh>Topic Covered</HrTh><HrTh>Key Insights</HrTh><HrTh>Action Taken</HrTh>
                                                {!locked && <th className="bg-[#1e3a5f] w-8" />}
                                            </tr></thead>
                                            <tbody>
                                                {hrFeedbackRows.map((row, idx) => (
                                                    <tr key={row.id} className={idx % 2 === 0 ? "bg-white dark:bg-transparent" : "bg-slate-50/60 dark:bg-white/[0.015]"}>
                                                        <HrTd><HrInput value={row.methodOfSurvey} onChange={v => setHrFeedbackRows(p => p.map((r, i) => i === idx ? { ...r, methodOfSurvey: v } : r))} /></HrTd>
                                                        <HrTd><HrInput value={row.topicCovered} onChange={v => setHrFeedbackRows(p => p.map((r, i) => i === idx ? { ...r, topicCovered: v } : r))} /></HrTd>
                                                        <HrTd><HrInput value={row.keyInsights} onChange={v => setHrFeedbackRows(p => p.map((r, i) => i === idx ? { ...r, keyInsights: v } : r))} /></HrTd>
                                                        <HrTd><HrInput value={row.actionTaken} onChange={v => setHrFeedbackRows(p => p.map((r, i) => i === idx ? { ...r, actionTaken: v } : r))} /></HrTd>
                                                        {!locked && <DelBtn onClick={() => setHrFeedbackRows(p => p.filter((_, i) => i !== idx))} />}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    {!locked && <AddRowBtn onClick={() => setHrFeedbackRows(p => [...p, { id: `fs-${Date.now()}`, methodOfSurvey: "", topicCovered: "", keyInsights: "", actionTaken: "" }])} />}
                                </div>
                                {/* 6D */}
                                <div>
                                    <SubHeader label="D. Grievances Handled" />
                                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-white/10 shadow-sm">
                                        <table className="w-full border-collapse" style={{ minWidth: 660 }}>
                                            <thead><tr className="border-b border-slate-200 dark:border-white/10">
                                                <HrTh>Employee Name</HrTh><HrTh>Issue Type</HrTh><HrTh>Brief Description</HrTh><HrTh>Action Taken</HrTh><HrTh>Status</HrTh>
                                                {!locked && <th className="bg-[#1e3a5f] w-8" />}
                                            </tr></thead>
                                            <tbody>
                                                {hrGrievanceRows.map((row, idx) => (
                                                    <tr key={row.id} className={idx % 2 === 0 ? "bg-white dark:bg-transparent" : "bg-slate-50/60 dark:bg-white/[0.015]"}>
                                                        <HrTd><HrInput value={row.employeeName} onChange={v => setHrGrievanceRows(p => p.map((r, i) => i === idx ? { ...r, employeeName: v } : r))} /></HrTd>
                                                        <HrTd><HrInput value={row.issueType} onChange={v => setHrGrievanceRows(p => p.map((r, i) => i === idx ? { ...r, issueType: v } : r))} /></HrTd>
                                                        <HrTd><HrInput value={row.briefDescription} onChange={v => setHrGrievanceRows(p => p.map((r, i) => i === idx ? { ...r, briefDescription: v } : r))} /></HrTd>
                                                        <HrTd><HrInput value={row.actionTaken} onChange={v => setHrGrievanceRows(p => p.map((r, i) => i === idx ? { ...r, actionTaken: v } : r))} /></HrTd>
                                                        <HrTd>
                                                            <HrSelect value={row.status} onChange={v => setHrGrievanceRows(p => p.map((r, i) => i === idx ? { ...r, status: v } : r))} options={["Open", "Closed", "In Progress"]} />
                                                            {row.status && <span className={`ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${row.status === "Closed" ? "bg-emerald-100 text-emerald-700" : row.status === "In Progress" ? "bg-blue-100 text-blue-600" : "bg-orange-100 text-orange-600"}`}>{row.status}</span>}
                                                        </HrTd>
                                                        {!locked && <DelBtn onClick={() => setHrGrievanceRows(p => p.filter((_, i) => i !== idx))} />}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    {!locked && <AddRowBtn onClick={() => setHrGrievanceRows(p => [...p, { id: `g-${Date.now()}`, employeeName: "", issueType: "", briefDescription: "", actionTaken: "", status: "" }])} />}
                                </div>
                            </div>
                        </div>

                    </div>{/* end divide-y */}

                    {/* ── Footer action bar ── */}
                    {!viewOnly && !isSubmitted && (
                        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 dark:border-white/5 bg-slate-50/60 dark:bg-white/[0.02]">
                            <div>
                                {isDraftSaved && (
                                    <button onClick={() => setShowDeleteConfirm(true)} disabled={deletingDraft}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 text-[12px] font-medium transition-colors disabled:opacity-40">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        Delete Draft
                                    </button>
                                )}
                            </div>
                            <div className="flex items-center gap-2.5">
                                <button onClick={() => postReport(true)} disabled={submitting || !statusLoaded}
                                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 text-[13px] font-medium shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                                    <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                                    Save Draft
                                </button>
                                <button onClick={() => setShowConfirm(true)} disabled={submitting || !statusLoaded}
                                    className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#1e3a5f] hover:bg-[#1a3356] text-[13px] font-semibold shadow-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed" style={{ color: "#ffffff" }}>
                                    {submitting
                                        ? <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>Submitting…</>
                                        : <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>Send to CEO</>
                                    }
                                </button>
                            </div>
                        </div>
                    )}
                    {isSubmitted && (
                        <div className="flex items-center gap-2.5 px-6 py-4 border-t border-slate-100 dark:border-white/5 bg-emerald-50/50 dark:bg-emerald-900/10">
                            <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            <span className="text-[13px] font-medium text-emerald-700 dark:text-emerald-400">Report submitted and locked successfully.</span>
                        </div>
                    )}

                </div>{/* end document shell */}

                {/* ── Confirm submit modal ── */}
                {showConfirm && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowConfirm(false)} />
                        <div className="relative bg-white dark:bg-[#1a1a32] rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4 border border-slate-200 dark:border-white/10">
                            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-[#1e3a5f]/10 mx-auto">
                                <svg className="w-6 h-6 text-[#1e3a5f] dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            </div>
                            <div className="text-center">
                                <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">Submit this report?</h3>
                                <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">Once submitted, the report will be <span className="font-semibold text-slate-700 dark:text-slate-200">locked</span> and sent to the CEO for review.</p>
                            </div>
                            <div className="flex gap-2.5">
                                <button onClick={() => setShowConfirm(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-50 text-slate-700 dark:text-slate-300 text-[13px] font-semibold transition-colors">Cancel</button>
                                <button onClick={() => postReport(false)} className="flex-1 px-4 py-2.5 rounded-xl bg-[#1e3a5f] hover:bg-[#1a3356] text-white text-[13px] font-semibold transition-colors shadow-sm">Confirm & Submit</button>
                            </div>
                        </div>
                    </div>
                )}
                {/* ── Confirm delete modal ── */}
                {showDeleteConfirm && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowDeleteConfirm(false)} />
                        <div className="relative bg-white dark:bg-[#1a1a32] rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4 border border-slate-200 dark:border-white/10">
                            <div className="text-center">
                                <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">Delete this draft?</h3>
                                <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1.5">This action cannot be undone.</p>
                            </div>
                            <div className="flex gap-2.5">
                                <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-50 text-slate-700 dark:text-slate-300 text-[13px] font-semibold">Cancel</button>
                                <button onClick={handleDeleteDraft} disabled={deletingDraft} className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[13px] font-semibold shadow-sm disabled:opacity-50">Delete</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    /* ──────────────────────────────────────────────────────────────── */

    return (
        <>
        <div className="max-w-4xl mx-auto space-y-8 pb-16">
            <style jsx global>{`
                .quill-editor .ql-toolbar {
                    border-color: rgba(0, 0, 0, 0.1) !important;
                    border-top-left-radius: 0.375rem;
                    border-top-right-radius: 0.375rem;
                    background: #f8fafc;
                    font-family: inherit;
                }
                .quill-editor .ql-container {
                    border-color: rgba(0, 0, 0, 0.1) !important;
                    border-bottom-left-radius: 0.375rem;
                    border-bottom-right-radius: 0.375rem;
                    min-height: 120px;
                    font-size: 0.875rem;
                    background: #ffffff;
                    font-family: inherit;
                }
                .quill-editor .ql-editor {
                    min-height: 120px;
                    font-family: inherit !important;
                }
                .dark .quill-editor .ql-toolbar {
                    background: #1a1a32 !important;
                    border-color: rgba(255, 255, 255, 0.2) !important;
                }
                .dark .quill-editor .ql-container {
                    background: #1a1a32 !important;
                    border-color: rgba(255, 255, 255, 0.2) !important;
                    color: white;
                }
                .dark .quill-editor .ql-stroke {
                    stroke: #cbd5e1 !important;
                }
                .dark .quill-editor .ql-fill {
                    fill: #cbd5e1 !important;
                }
                .dark .quill-editor .ql-picker-label {
                    color: #cbd5e1 !important;
                }
                .dark .quill-editor .ql-picker-options {
                    background: #1e293b !important;
                    border-color: rgba(255, 255, 255, 0.1) !important;
                    color: white;
                }
                /* Fix font picker text wrapping (e.g., Times New Roman) */
                .quill-editor .ql-snow .ql-picker.ql-font {
                    width: 170px !important;
                }
                .quill-editor .ql-snow .ql-picker.ql-font .ql-picker-label,
                .quill-editor .ql-snow .ql-picker.ql-font .ql-picker-item {
                    white-space: nowrap !important;
                }
            `}</style>
            {/* ── Back button ──────────────────────────────── */}
            <button
                onClick={() => router.back()}
                className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors group"
            >
                <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to Reports
            </button>

            {/* View-only banner */}
            {viewOnly && isSubmitted && (
                <div className="mb-4 flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 text-[13px] font-medium">
                    <svg className="w-4 h-4 text-sky-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    {isCeo
                        ? "You are viewing this report as CEO — read-only mode."
                        : hasExplicitAccess
                            ? "You have been granted view access to this report."
                            : "You are viewing this report in read-only mode. Only the report owner can edit it."}
                </div>
            )}

            {/* ════════════════════════════════════════════════
                REPORT DOCUMENT
               ════════════════════════════════════════════════ */}
            <div className="bg-white dark:bg-[#0f0f23] border border-slate-300 dark:border-white/20 rounded-xl shadow-xl overflow-hidden">
                {/* ── Header ─────────────────────────────────── */}
                <div className="px-6 py-5 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02]">
                    <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                        Production Monthly Report — {monthName} {year}
                    </h1>
                    <div className="mt-3 space-y-1 text-sm">
                        <div>
                            <span className="text-slate-500 dark:text-slate-400 font-medium">To: </span>
                            <span className="text-slate-700 dark:text-slate-300">CEO</span>
                        </div>
                        <div>
                            <span className="text-slate-500 dark:text-slate-400 font-medium">From: </span>
                            <span className="text-slate-700 dark:text-slate-300">Head of Production</span>
                        </div>
                        <div>
                            <span className="text-slate-500 dark:text-slate-400 font-medium">Date: </span>
                            <span className="text-slate-700 dark:text-slate-300"></span>
                        </div>
                        <div>
                            <span className="text-slate-500 dark:text-slate-400 font-medium">Reporting Period: </span>
                            <span className="text-yellow-500 dark:text-yellow-400 font-medium">{monthName.slice(0, 3)} 1 to {monthName.slice(0, 3)} {new Date(year, monthIndex + 1, 0).getDate()}, {year}</span>
                        </div>
                    </div>
                </div>

                {/* ── Body ───────────────────────────────────── */}
                <div className="px-6 py-6 space-y-8">

                    {/* ── 1. Executive Summary ──────────────────── */}
                    <section>
                        <h2 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                            1. Executive Summary <span className="text-red-500 ml-0.5">*</span>
                        </h2>
                        <p className="text-xs text-slate-500 italic mb-4">
                            Provide a concise, 3-5 sentence overview of {monthName}&apos;s performance, highlighting major achievements and the most significant shortfall/delay.
                        </p>

                        {/* Executive Summary Rich Text */}
                        <div className="mb-6">
                            <RichTextField value={executiveSummary} onChange={viewOnly ? () => {} : setExecutiveSummary} placeholder="Write achievements here..." />
                        </div>

                        {/* Shortfall sub-section */}
                        <div>
                            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 underline">
                                Shortfall <span className="text-red-500 ml-0.5">*</span>
                            </h3>
                            <div>
                                <RichTextField value={shortfallSummary} onChange={viewOnly ? () => {} : setShortfallSummary} placeholder="Write shortfalls here..." />
                            </div>
                        </div>
                    </section>

                    <hr className="border-slate-200 dark:border-white/5" />

                    {/* ── 2. Production Volume & Efficiency ──────── */}
                    <section>
                        <h2 className="text-base font-bold text-slate-900 dark:text-white mb-1">2. Production Volume &amp; Efficiency (Core Data)</h2>
                        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">A. Overall Output</h3>

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-200 dark:border-white/10">
                                        <th className="text-left py-2 px-3 text-slate-500 dark:text-slate-400 font-medium text-xs">Metric</th>
                                        <th className="text-left py-2 px-3 text-slate-500 dark:text-slate-400 font-medium text-xs">Target</th>
                                        <th className="text-left py-2 px-3 text-slate-500 dark:text-slate-400 font-medium text-xs">Actual</th>
                                        <th className="text-left py-2 px-3 text-slate-500 dark:text-slate-400 font-medium text-xs">Variance</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {[
                                        { metric: "Total Video Completed", target: "[X]", actual: "[X]", variance: "[X]" },
                                        { metric: "Hero Content Completed", target: "[X]", actual: "[X]", variance: "[X]" },
                                    ].map((row, i) => (
                                        <tr key={i} className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                                            <td className="py-2 px-3 text-slate-700 dark:text-slate-300 font-medium">{row.metric}</td>
                                            <td className="py-2 px-3"><ClickUpField value={row.target} /></td>
                                            <td className="py-2 px-3"><ClickUpField value={row.actual} /></td>
                                            <td className="py-2 px-3"><ClickUpField value={row.variance} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                    </section>

                    <hr className="border-slate-200 dark:border-white/5" />

                    {/* ── 3. Individual Contributor Performance ───── */}
                    <section>
                        <h2 className="text-base font-bold text-slate-900 dark:text-white mb-1">3. Individual Contributor Performance (Key Metric)</h2>

                        {/* A. Editor Output */}
                        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mt-4 mb-1">A. Editor Output</h3>
                        <p className="text-xs text-slate-500 mb-3">
                            Count of completed and published videos that each editor was the primary worker on during {monthName}.
                        </p>

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-200 dark:border-white/10">
                                        <th className="text-left py-2 px-3 text-slate-500 dark:text-slate-400 font-medium text-xs">Editor</th>
                                        <th className="text-left py-2 px-3 text-slate-500 dark:text-slate-400 font-medium text-xs">Videos Completed</th>
                                        <th className="text-left py-2 px-3 text-slate-500 dark:text-slate-400 font-medium text-xs">Consistency/Quality Note</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {isLoading ? (
                                        <tr><td colSpan={3} className="py-4 text-center text-sm text-slate-500">Loading editors...</td></tr>
                                    ) : editors.length === 0 ? (
                                        <tr><td colSpan={3} className="py-4 text-center text-sm text-slate-500">No editors found</td></tr>
                                    ) : (
                                        editors.map((editor: any) => (
                                            <tr key={editor.id} className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                                                <td className="py-2 px-3 w-1/4">
                                                    <ClickUpField value={editor.name} />
                                                </td>
                                                <td className="py-2 px-3 w-1/4">
                                                    <ClickUpField value={
                                                        contributorData
                                                            ? String(editorStats[editor.id] ?? 0)
                                                            : "…"
                                                    } />
                                                </td>
                                                <td className="py-2 px-3">
                                                    <div className="flex flex-col gap-1">
                                                        <EditableCell value={editorNotes[editor.id] || ""} onChange={(v) => handleEditorNoteChange(editor.id, v)} readOnly={viewOnly} />
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* B. Writer Output */}
                        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mt-6 mb-1">B. Writer Output</h3>
                        <p className="text-xs text-slate-500 mb-3">
                            Count of completed and published videos that each writer was the primary worker on during {monthName}.
                        </p>

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-200 dark:border-white/10">
                                        <th className="text-left py-2 px-3 text-slate-500 dark:text-slate-400 font-medium text-xs">Writer</th>
                                        <th className="text-left py-2 px-3 text-slate-500 dark:text-slate-400 font-medium text-xs">Scripts Completed</th>
                                        <th className="text-left py-2 px-3 text-slate-500 dark:text-slate-400 font-medium text-xs">Consistency/Quality Note</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {isLoading ? (
                                        <tr><td colSpan={3} className="py-4 text-center text-sm text-slate-500">Loading writers...</td></tr>
                                    ) : writers.length === 0 ? (
                                        <tr><td colSpan={3} className="py-4 text-center text-sm text-slate-500">No writers found</td></tr>
                                    ) : (
                                        writers.map((writer: any) => (
                                            <tr key={writer.id} className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                                                <td className="py-2 px-3 w-1/4">
                                                    <ClickUpField value={writer.name} />
                                                </td>
                                                <td className="py-2 px-3 w-1/4">
                                                    <ClickUpField value={
                                                        contributorData
                                                            ? String(writerStats[writer.id] ?? 0)
                                                            : "…"
                                                    } />
                                                </td>
                                                <td className="py-2 px-3">
                                                    <div className="flex flex-col gap-1">
                                                        <EditableCell value={writerNotes[writer.id] || ""} onChange={(v) => handleWriterNoteChange(writer.id, v)} readOnly={viewOnly} />
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* ── C. Team/Individual Recognition ─────────── */}
                        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mt-6 mb-1">
                            C. Team/Individual Recognition <span className="text-red-500 ml-0.5">*</span>
                        </h3>
                        <p className="text-xs text-slate-500 mb-3">
                            Highlight 1–2 top individual achievements or reliable contributors for the month, and note any individuals needing additional support/mentoring.
                        </p>
                        <RichTextField value={teamRecognition} onChange={viewOnly ? () => {} : setTeamRecognition} />
                    </section>

                    <hr className="border-slate-200 dark:border-white/5" />

                    {/* ── 4. Content Performance Review (Viewership) */}
                    <section>
                        <h2 className="text-base font-bold text-slate-900 dark:text-white mb-1">4. Content Performance Review (Viewership)</h2>

                        <div className="overflow-x-auto mt-3">
                            <table className="w-full text-sm border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-200 dark:border-white/10">
                                        <th className="text-left py-2 px-3 text-slate-500 dark:text-slate-400 font-medium text-xs">Metric</th>
                                        <th className="text-left py-2 px-3 text-slate-500 dark:text-slate-400 font-medium text-xs">Total for {monthName} {year}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                                        <td className="py-2 px-3 text-slate-700 dark:text-slate-300">Total Views (All Videos)</td>
                                        <td className="py-2 px-3"><ClickUpField value="[X]" /></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        {/* Top 3 and Bottom 3 */}
                        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mt-5 mb-3">
                            Top 3 and Bottom 3 Performing Videos (Published in {MONTH_NAMES[monthIndex === 0 ? 11 : monthIndex - 1]})
                        </h3>

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-200 dark:border-white/10">
                                        <th className="text-left py-2 px-3 text-slate-500 dark:text-slate-400 font-medium text-xs">Rank</th>
                                        <th className="text-left py-2 px-3 text-slate-500 dark:text-slate-400 font-medium text-xs">Video Title</th>
                                        <th className="text-left py-2 px-3 text-slate-500 dark:text-slate-400 font-medium text-xs">Views</th>
                                        <th className="text-left py-2 px-3 text-slate-500 dark:text-slate-400 font-medium text-xs">Capsule</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {["Top 1", "Top 2", "Top 3", "Bottom 1", "Bottom 2", "Bottom 3"].map((rank, i) => (
                                        <tr key={i} className={`border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.02] ${i === 3 ? "border-t-2 border-t-slate-300 dark:border-t-white/10" : ""}`}>
                                            <td className="py-2 px-3 text-slate-500 dark:text-slate-400 text-xs font-medium">{rank}</td>
                                            <td className="py-2 px-3"><ClickUpField value="[Video Title]" /></td>
                                            <td className="py-2 px-3"><ClickUpField value="[X]" /></td>
                                            <td className="py-2 px-3"><ClickUpField value="[X]" /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <hr className="border-slate-200 dark:border-white/5" />

                    {/* ── 5. Strategic & Operational Review ──────── */}
                    <section>
                        <h2 className="text-base font-bold text-slate-900 dark:text-white mb-1">5. Strategic &amp; Operational Review</h2>

                        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mt-3 mb-2">
                            A. Key Learnings <span className="text-red-500 ml-0.5">*</span>
                        </h3>
                        <div className="space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2">
                                <span className="text-sm text-slate-700 dark:text-slate-300 font-medium whitespace-nowrap mt-1">1. What Worked Well (Content/Format/Hook): <span className="text-red-400">*</span></span>
                                <EditableField value={keyLearnings[0]} onChange={(v) => updateArrayItem(setKeyLearnings, 0, v)} rows={1} className="sm:flex-1" readOnly={viewOnly} />
                            </div>
                            <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2">
                                <span className="text-sm text-slate-700 dark:text-slate-300 font-medium whitespace-nowrap mt-1">2. What Did Not Work (Content/Topic/Process): <span className="text-red-400">*</span></span>
                                <EditableField value={keyLearnings[1]} onChange={(v) => updateArrayItem(setKeyLearnings, 1, v)} rows={1} className="sm:flex-1" readOnly={viewOnly} />
                            </div>
                            <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2">
                                <span className="text-sm text-slate-700 dark:text-slate-300 font-medium whitespace-nowrap mt-1">3. Improvements Adapted for {monthName}: <span className="text-red-400">*</span></span>
                                <EditableField value={keyLearnings[2]} onChange={(v) => updateArrayItem(setKeyLearnings, 2, v)} rows={1} className="sm:flex-1" readOnly={viewOnly} />
                            </div>
                        </div>

                        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mt-5 mb-1">
                            B. Risks &amp; Immediate Attention Needed <span className="text-red-500 ml-0.5">*</span>
                        </h3>
                        <p className="text-xs text-slate-500 italic mb-3">
                            Identify potential risks (e.g., resource overload, content fatigue, technical issues) and any process or communication issues requiring CEO awareness/intervention.
                        </p>
                        <EditableField value={risksAttention} onChange={setRisksAttention} rows={3} readOnly={viewOnly} />
                    </section>

                    <hr className="border-slate-200 dark:border-white/5" />

                    {/* ── 6. Behavioral Concerns ─────────────────── */}
                    <section>
                        <h2 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                            6. Behavioral Concerns
                            <span className="ml-2 text-[11px] font-normal text-slate-400 dark:text-slate-500 italic">(Optional &amp; Confidential)</span>
                        </h2>
                        <p className="text-xs text-slate-500 italic mb-3">
                            If applicable, detail any observed inappropriate behavioral patterns from a capsule manager or team member that requires executive attention or HR intervention.
                        </p>
                        <EditableField value={behavioralConcerns} onChange={setBehavioralConcerns} rows={3} readOnly={viewOnly} />
                    </section>

                    <hr className="border-slate-200 dark:border-white/5" />

                    {/* ── 7. Remark ──────────────────────────────── */}
                    <section>
                        <h2 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                            7. Remark
                            <span className="ml-2 text-[11px] font-normal text-slate-400 dark:text-slate-500 italic">(Optional)</span>
                        </h2>
                        <p className="text-xs text-slate-500 italic mb-3">
                            Any additional notes, observations, or comments you would like to include with this report.
                        </p>
                        <EditableField value={remark} onChange={setRemark} rows={3} readOnly={viewOnly} />
                    </section>
                </div>

                {/* ── Footer / Submit ────────────────────────── */}
                <div className="px-6 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] flex items-center justify-between gap-4">
                    <div className="space-y-0.5">
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 italic">
                            Fields marked with [X] are auto-filled from ClickUp and cannot be edited.
                        </p>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 italic">
                            Fields marked <span className="text-red-400 font-semibold not-italic">*</span> are required before submitting.
                        </p>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                        {viewOnly && isSubmitted && (
                            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 text-[12px] font-medium">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                                View Only
                            </span>
                        )}
                        {!viewOnly && submitError && (
                            <p className="text-[11px] text-red-500 font-medium">{submitError}</p>
                        )}
                        {!viewOnly && isDraftSaved && !isSubmitted && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 font-medium bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                                Draft saved
                            </span>
                        )}
                        {!viewOnly && isLocked ? (
                            <div className="flex items-center gap-2 px-4 py-[7px] rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-[13px] font-semibold">
                                <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                                Submitted
                            </div>
                        ) : !viewOnly ? (
                            <>
                                {/* Delete Draft — only visible when a draft exists */}
                                {isDraftSaved && !isLocked && (
                                    showDeleteConfirm ? (
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[11px] text-red-600 font-medium">Delete draft?</span>
                                            <button
                                                onClick={handleDeleteDraft}
                                                disabled={deletingDraft}
                                                className="px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold disabled:opacity-50 transition-colors"
                                            >
                                                Yes, delete
                                            </button>
                                            <button
                                                onClick={() => setShowDeleteConfirm(false)}
                                                className="px-2.5 py-1 rounded-md border border-slate-300 text-slate-500 text-[11px] font-medium hover:bg-slate-50 transition-colors"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => setShowDeleteConfirm(true)}
                                            disabled={deletingDraft || submitting}
                                            title="Delete Draft"
                                            className="p-[7px] rounded-lg border border-red-200 bg-white hover:bg-red-50 text-red-500 shadow-sm transition-colors disabled:opacity-50"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    )
                                )}

                                {/* Save as Draft */}
                                <button
                                    onClick={handleSaveDraft}
                                    disabled={submitting || !statusLoaded}
                                    className="flex items-center gap-1.5 px-3.5 py-[7px] rounded-lg border border-slate-300 bg-white hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed text-slate-600 text-[13px] font-medium shadow-sm transition-colors"
                                >
                                    <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                                    </svg>
                                    Save as Draft
                                </button>

                                {/* Send to CEO */}
                                <button
                                    onClick={() => setShowConfirm(true)}
                                    disabled={submitting || !statusLoaded}
                                    className="flex items-center gap-1.5 px-4 py-[7px] rounded-lg bg-violet-600 hover:bg-violet-700 active:bg-violet-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[13px] font-semibold shadow-sm transition-colors"
                                >
                                    {submitting ? (
                                        <>
                                            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                            </svg>
                                            Submitting…
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                            </svg>
                                            Send to CEO
                                        </>
                                    )}
                                </button>
                            </>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>

        {/* ── Confirmation Modal ── */}
        {showConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                {/* Backdrop */}
                <div
                    className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                    onClick={() => setShowConfirm(false)}
                />
                {/* Dialog */}
                <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
                    {/* Icon */}
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-violet-50 mx-auto">
                        <svg className="w-6 h-6 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    {/* Text */}
                    <div className="text-center">
                        <h3 className="text-[15px] font-bold text-slate-900">Submit this report?</h3>
                        <p className="text-[13px] text-slate-500 mt-1.5 leading-relaxed">
                            Once submitted, the report will be <span className="font-medium text-slate-700">locked</span> and cannot be edited. Make sure all data is correct before confirming.
                        </p>
                        <p className="text-[13px] text-slate-500 mt-2 leading-relaxed">
                            This report will be <span className="font-semibold text-slate-800">sent to the CEO</span> for review.
                        </p>
                    </div>
                    {/* Actions */}
                    <div className="flex gap-2.5 mt-1">
                        <button
                            onClick={() => setShowConfirm(false)}
                            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[13px] font-semibold transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-semibold transition-colors shadow-sm"
                        >
                            Yes, Submit
                        </button>
                    </div>
                </div>
            </div>
        )}
        </>
    );
}
