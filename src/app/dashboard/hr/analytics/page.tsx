"use client";
import { useState, useEffect } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { parseAttLoc, captureClockInGeo } from "@/lib/attendance-location";
import {
  ChevronDown,
  Send,
  BarChart2,
  Award,
  Mail,
  Plus,
  MoreHorizontal,
  ThumbsUp,
  MessageSquare,
} from "lucide-react";

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  page:    "bg-[#f5f7fb]",
  card:    "bg-white border border-[#e3e9f1] rounded-[3px] shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
  t1:      "text-[#1b2b3c]",
  t2:      "text-[#415a73]",
  t3:      "text-[#6e8499]",
  div:     "border-[#e6ebf2]",
  ring:    "ring-white",
} as const;

// ── Small ring for leave balance ───────────────────────────────────────────────
function BalanceRing({ avail, total, color }: { avail: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min((avail / total) * 100, 100) : 0;
  const r = 30, circum = 2 * Math.PI * r;
  return (
    <div className="relative w-[70px] h-[70px]">
      <svg viewBox="0 0 70 70" className="w-full h-full -rotate-90">
        <circle cx="35" cy="35" r={r} fill="none" strokeWidth="6"
          className="stroke-[#e8ecf0] dark:stroke-[rgba(255,255,255,0.07)]" />
        <circle cx="35" cy="35" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circum} strokeDashoffset={circum * (1 - pct / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[14px] font-bold" style={{ color }}>{avail}</span>
        <span className="text-[9px] mt-0.5 text-[#94a3b8] dark:text-[#4e5e72]">days</span>
      </div>
    </div>
  );
}

// ── Avatar ─────────────────────────────────────────────────────────────────────
function Av({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) {
  const palette = ["#6366f1","#0891b2","#059669","#d97706","#db2777","#7c3aed","#dc2626"];
  const bg = palette[name.charCodeAt(0) % palette.length];
  const initials = name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
  if (url) return <img src={url} alt={name} style={{ width: size, height: size }} className={`rounded-full object-cover ring-2 ${C.ring} shrink-0`} />;
  return (
    <div style={{ width: size, height: size, background: bg, fontSize: Math.round(size * 0.33) }}
      className={`rounded-full flex items-center justify-center text-white font-semibold ring-2 ${C.ring} shrink-0`}>
      {initials}
    </div>
  );
}

// Visual hues per DB holiday `type`. The seeder / admin form writes one of these.
const HOLIDAY_TYPE_COLOR: Record<string, string> = {
  public:     "#008CFF",
  company:    "#7c3aed",
  optional:   "#059669",
};
const HOLIDAY_TYPE_LABEL: Record<string, string> = {
  public:     "NATIONAL HOLIDAY",
  company:    "COMPANY HOLIDAY",
  optional:   "FLOATER HOLIDAY",
};
const isoDay = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d)
    .reduce<Record<string, string>>((a, p) => { a[p.type] = p.value; return a; }, {} as any);

// ── Events widget ─────────────────────────────────────────────────────────
// Tabs: Birthdays · Work Anniversaries · New Joinees. Auto-derived from DB.
function EventsWidget({
  bTab, setBTab, C,
}: {
  bTab: "birthday" | "anniversary" | "joinees";
  setBTab: (v: "birthday" | "anniversary" | "joinees") => void;
  C: { card: string; t1: string; t2: string; t3: string; div: string; ring: string };
}) {
  const { data } = useSWR("/api/hr/events", fetcher, { refreshInterval: 60_000 });
  const birthdays     = data?.birthdays     ?? { today: [], upcoming: [], count: 0 };
  const anniversaries = data?.anniversaries ?? { thisWeek: [],             count: 0 };
  const newJoinees    = data?.newJoinees    ?? { thisMonth: [],            count: 0 };

  const tabs: { k: "birthday" | "anniversary" | "joinees"; emoji: string; count: number; label: string }[] = [
    { k: "birthday",    emoji: "🎂", count: birthdays.count,     label: birthdays.count     === 1 ? "Birthday"         : "Birthdays"          },
    { k: "anniversary", emoji: "✨", count: anniversaries.count, label: anniversaries.count === 1 ? "Work Anniversary" : "Work Anniversaries" },
    { k: "joinees",     emoji: "👤", count: newJoinees.count,    label: newJoinees.count    === 1 ? "New Joinee"       : "New Joinees"        },
  ];

  const row = (p: { userId: number; name: string; profilePictureUrl: string | null; designation: string | null; dateLabel: string }, extra?: string) => (
    <Link key={p.userId} href={`/dashboard/hr/people/${p.userId}`}
      className="flex items-center gap-2.5 py-1.5 hover:bg-slate-50 rounded-md px-1.5 -mx-1.5 transition-colors">
      <img
        src={p.profilePictureUrl || ""}
        alt={p.name}
        className="w-8 h-8 rounded-full object-cover bg-[#e8ecf0]"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
      />
      <div className="flex-1 min-w-0">
        <p className={`text-[12.5px] font-medium ${C.t1} truncate leading-tight`}>{p.name}</p>
        <p className={`text-[10.5px] ${C.t3} truncate leading-tight`}>
          {p.designation || "—"}{extra ? ` · ${extra}` : ""}
        </p>
      </div>
      <span className="text-[10.5px] font-semibold text-[#008CFF] whitespace-nowrap">{p.dateLabel}</span>
    </Link>
  );

  return (
    <div className={`${C.card} overflow-hidden`}>
      <div className={`flex items-center justify-between border-b ${C.div} px-1`}>
        <div className="flex">
          {tabs.map((t) => (
            <button
              key={t.k}
              onClick={() => setBTab(t.k)}
              className={`px-3 py-2.5 text-[12px] border-b-2 -mb-px whitespace-nowrap transition-colors ${
                bTab === t.k
                  ? "border-[#008CFF] text-[#008CFF] font-semibold"
                  : `border-transparent ${C.t3} font-medium hover:${C.t1}`
              }`}
            >
              {t.emoji} {t.count} {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="px-4 py-4 space-y-3">
        {bTab === "birthday" && (
          <>
            <div>
              <p className={`text-[11.5px] font-semibold ${C.t2} mb-1.5`}>Birthdays today</p>
              {birthdays.today.length === 0
                ? <p className={`text-[12px] ${C.t3}`}>No birthdays today</p>
                : <div className="space-y-1">{birthdays.today.map((p: any) => row(p, "🎉 Today"))}</div>}
            </div>
            <div>
              <p className={`text-[11.5px] font-semibold ${C.t2} mb-1.5`}>Upcoming birthdays</p>
              {birthdays.upcoming.length === 0
                ? <p className={`text-[12px] ${C.t3}`}>No upcoming birthdays in the next 14 days</p>
                : <div className="space-y-1">{birthdays.upcoming.map((p: any) => row(p, `in ${p.daysAway} day${p.daysAway === 1 ? "" : "s"}`))}</div>}
            </div>
          </>
        )}
        {bTab === "anniversary" && (
          anniversaries.thisWeek.length === 0
            ? <p className={`text-[12px] ${C.t3}`}>No work anniversaries this week</p>
            : <div className="space-y-1">{anniversaries.thisWeek.map((p: any) => row(p, `${p.years} year${p.years === 1 ? "" : "s"}`))}</div>
        )}
        {bTab === "joinees" && (
          newJoinees.thisMonth.length === 0
            ? <p className={`text-[12px] ${C.t3}`}>No new joinees this month</p>
            : <div className="space-y-1">{newJoinees.thisMonth.map((p: any) => row(p, "Joined"))}</div>
        )}
      </div>
    </div>
  );
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} mins ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function DecorativeTree() {
  return (
    <svg viewBox="0 0 360 620" className="h-full w-full">
      <g fill="none" stroke="currentColor" strokeLinecap="round" opacity="0.9">
        <path d="M286 602 C286 516 275 449 251 381 C229 321 220 272 225 210" strokeWidth="24" />
        <path d="M248 396 C291 381 323 353 342 305" strokeWidth="11" />
        <path d="M252 438 C301 430 334 405 358 360" strokeWidth="10" />
        <path d="M237 345 C195 314 169 283 151 241" strokeWidth="11" />
        <path d="M228 302 C183 278 148 248 121 204" strokeWidth="9" />
        <path d="M221 253 C255 228 277 198 292 156" strokeWidth="9" />
        <path d="M219 215 C180 186 154 158 135 117" strokeWidth="8" />
        <path d="M288 485 C321 480 343 463 358 432" strokeWidth="8" />
      </g>
      {[
        [316, 282, 20], [276, 329, 20], [250, 367, 21], [303, 392, 18], [331, 343, 17],
        [176, 252, 19], [145, 218, 17], [119, 245, 18], [161, 295, 20], [138, 156, 17],
        [283, 164, 18], [309, 130, 16], [170, 190, 16], [211, 151, 18], [332, 487, 18],
        [297, 523, 20], [264, 482, 18], [237, 536, 17], [346, 546, 16], [205, 326, 16],
        [191, 415, 17], [334, 420, 16], [287, 248, 16],
      ].map(([x, y, r], idx) => (
        <g key={idx} transform={`translate(${x} ${y}) rotate(${idx % 2 === 0 ? -18 : 18})`}>
          <path
            d={`M0 ${r} C${r * 0.9} ${r * 0.45} ${r * 0.95} ${r * -0.25} 0 ${-r} C${-r * 0.95} ${r * -0.25} ${-r * 0.9} ${r * 0.45} 0 ${r}Z`}
            fill="currentColor"
            opacity="0.45"
          />
          <path d={`M0 ${r - 3} L0 ${-r + 3}`} stroke="white" strokeOpacity="0.34" strokeWidth="1.1" />
        </g>
      ))}
    </svg>
  );
}

// Welcome banner — backed by /public/image_8b71d84b.png. The image is set
// as a CSS background so it `cover`s the banner cleanly at any aspect
// ratio without stretching. A faint left-side dark gradient keeps the
// white "Welcome ___" text readable against bright wave details.
function BannerArt() {
  return (
    <div
      className="absolute inset-0"
      style={{
        backgroundImage:
          "linear-gradient(90deg, rgba(8,18,38,0.55) 0%, rgba(8,18,38,0.20) 35%, rgba(8,18,38,0) 100%), url('/image_8b71d84b.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}

function HolidayScene() {
  return (
    <svg viewBox="0 0 340 88" className="pointer-events-none absolute inset-x-0 bottom-0 h-[62px] w-full">
      <g fill="rgba(43,94,34,0.35)">
        <rect x="0" y="76" width="340" height="12" />
        <path d="M0 76 C32 61 59 59 88 71 C112 49 143 47 173 69 C196 56 213 54 232 65 C257 43 287 42 340 76Z" />
        <rect x="44" y="48" width="8" height="28" />
        <path d="M48 48 C38 53 37 69 48 72 C58 69 58 54 48 48Z" />
        <rect x="114" y="44" width="8" height="32" />
        <path d="M118 44 C104 48 102 69 118 72 C133 69 132 48 118 44Z" />
        <rect x="210" y="42" width="8" height="34" />
        <path d="M214 42 C201 47 199 70 214 72 C229 69 227 46 214 42Z" />
        <rect x="274" y="46" width="8" height="30" />
        <path d="M278 46 C266 51 264 68 278 72 C291 68 290 50 278 46Z" />
      </g>
    </svg>
  );
}

function QuickLinksCard() {
  const links = [
    { label: "Attendance", href: "/dashboard/hr/attendance" },
    { label: "Leave", href: "/dashboard/hr/leaves" },
    { label: "People", href: "/dashboard/hr/people" },
    { label: "Inbox", href: "/dashboard/hr/inbox" },
    { label: "Engage", href: "/dashboard/hr/engage" },
    { label: "Announcements", href: "/dashboard/hr/announcements" },
  ];

  return (
    <div className={`${C.card} p-3.5`}>
      <p className={`mb-3 text-[13px] font-semibold ${C.t1}`}>Quick Links</p>
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        {links.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="text-[12px] font-medium text-[#008CFF] transition-colors hover:text-[#0070d4] hover:underline"
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function FeedPostCard({ post }: { post: any }) {
  return (
    <article className={`${C.card} overflow-hidden`}>
      <div className="px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Av name={post.author?.name || "User"} url={post.author?.profilePictureUrl} size={34} />
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-semibold text-[#2e4051]">
                {post.author?.name || "Team member"}
                <span className="ml-1 font-normal text-[#8a98a8]">created a post</span>
              </p>
              <p className="mt-0.5 text-[11px] text-[#97a4b3]">{timeAgo(post.createdAt)}</p>
            </div>
          </div>
          <button className="rounded-md p-1 text-[#95a3b1] transition hover:bg-[#f5f7fb] hover:text-[#607284]">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 text-[13px] leading-6 text-[#526476]">
          {post.content}
        </div>

        {post.mediaUrl ? (
          <img
            src={post.mediaUrl}
            alt="Post media"
            className="mt-3 max-h-[360px] w-full rounded-[3px] border border-[#ecf1f5] object-cover"
          />
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-[#eef2f6] px-4 py-2.5 text-[11.5px] text-[#8393a3]">
        <div className="flex items-center gap-3">
          <span>{post.reactions?.length || 0} reactions</span>
          <span>{post.comments?.length || 0} comments</span>
        </div>
      </div>

      <div className="flex items-center border-t border-[#eef2f6]">
        <Link
          href="/dashboard/hr/engage"
          className="flex flex-1 items-center justify-center gap-2 py-2.5 text-[12px] font-medium text-[#5f7183] transition hover:bg-[#f8fafc]"
        >
          <ThumbsUp className="h-4 w-4" />
          Like
        </Link>
        <Link
          href="/dashboard/hr/engage"
          className="flex flex-1 items-center justify-center gap-2 border-l border-[#eef2f6] py-2.5 text-[12px] font-medium text-[#5f7183] transition hover:bg-[#f8fafc]"
        >
          <MessageSquare className="h-4 w-4" />
          Comment
        </Link>
      </div>
    </article>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function HRHomePage() {
  const { data: session } = useSession();
  const user    = session?.user as any;
  const isAdmin = user?.orgLevel === "ceo" || user?.isDeveloper || user?.orgLevel === "hr_manager";

  const monthKey = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; })();

  const { data: analyticsData }    = useSWR("/api/hr/analytics", fetcher);
  const { data: boardData }        = useSWR("/api/hr/attendance/board", fetcher);
  const { data: balanceData = [] } = useSWR("/api/hr/leaves/balance", fetcher);
  const { data: myData }           = useSWR(`/api/hr/attendance?month=${monthKey}`, fetcher);
  const { data: profile }          = useSWR("/api/hr/profile", fetcher);
  const { data: myWfh = [] }       = useSWR("/api/hr/attendance/wfh?view=my", fetcher);

  // displayName/email/photo used by the merged global header (src/components/layout/header.tsx).

  const workLoc  = (profile?.employeeProfile?.workLocation || "office").toLowerCase();
  const todayKey = new Date().toISOString().slice(0, 10);
  const hasWfhToday = Array.isArray(myWfh) && myWfh.some((r: any) =>
    r.status === "approved" && typeof r.date === "string" && r.date.slice(0, 10) === todayKey
  );
  const isRemoteMode = workLoc === "remote" || workLoc === "hybrid" || hasWfhToday;

  const [hh, setHh] = useState("--");
  const [mm, setMm] = useState("--");
  const [ss, setSs] = useState("--");
  const [ap, setAp] = useState("AM");
  const [dl, setDl] = useState("");
  const [feedTab, setFT]  = useState<"post"|"poll"|"praise">("post");
  const [bTab, setBTab]   = useState<"birthday"|"anniversary"|"joinees">("birthday");
  const [postText, setPost] = useState("");
  const [orgTab, setOrgTab] = useState<"org"|"team">("org");
  const [submittingPost, setSubmittingPost] = useState(false);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata", hour12: false,
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      }).formatToParts(d).reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});
      const h24 = parseInt(parts.hour || "0", 10);
      setHh(String(h24 % 12 || 12).padStart(2, "0"));
      setMm(parts.minute || "00");
      setSs(parts.second || "00");
      setAp(h24 >= 12 ? "PM" : "AM");
      const dateParts = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).formatToParts(d).reduce<Record<string, string>>((acc, p) => {
        acc[p.type] = p.value;
        return acc;
      }, {});
      setDl(`${dateParts.weekday || "Thu"}, ${dateParts.day || "23"} ${dateParts.month || "Apr"} ${dateParts.year || "2026"}`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // Pull holidays from the DB (seeded Indian calendar + anything HR adds via admin).
  const thisYear = new Date().getFullYear();
  const { data: holidaysData = [] } = useSWR(`/api/hr/admin/holidays?year=${thisYear}`, fetcher);
  const istTodayStr = (() => { const p = isoDay(new Date()); return `${p.year}-${p.month}-${p.day}`; })();
  const allHolidays: { id: number; name: string; date: string; type: string }[] = Array.isArray(holidaysData)
    ? holidaysData.map((h: any) => ({ id: h.id, name: h.name, date: String(h.date).slice(0, 10), type: h.type || "public" }))
    : [];
  const todaysHoliday = allHolidays.find((h) => h.date === istTodayStr) || null;
  const upcoming      = allHolidays.filter((h) => h.date >= istTodayStr);
  const holiday       = upcoming[0] ?? null;
  const todayRec = myData?.todayRecord;
  const todayLoc = parseAttLoc(todayRec?.location);
  const teamScope = user?.teamCapsule || "team";
  const postsUrl = orgTab === "org"
    ? "/api/hr/engage/posts"
    : `/api/hr/engage/posts?scope=${encodeURIComponent(teamScope)}`;
  const { data: posts = [] } = useSWR(postsUrl, fetcher);
  const { data: announcements = [] } = useSWR("/api/hr/announcements", fetcher);

  const clockIn = async () => {
    const geo = await captureClockInGeo();
    await fetch("/api/hr/attendance/clock-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geo),
    });
    mutate(`/api/hr/attendance?month=${monthKey}`);
  };
  const clockOut = async () => { await fetch("/api/hr/attendance/clock-out", { method: "POST" }); mutate(`/api/hr/attendance?month=${monthKey}`); };
  const onLeave  = (boardData?.board || []).filter((u: any) => u.status === "on_leave");
  // Split clocked-in employees by their actual location mode (from Attendance.location JSON).
  const clockedIn = (boardData?.board || []).filter((u: any) => u.status === "present" || u.status === "late");
  const remote    = clockedIn.filter((u: any) => parseAttLoc(u.location).mode === "remote");
  const balances = (balanceData as any[]).filter(b => b.leaveType).slice(0, 3);
  const activeHoliday = todaysHoliday || holiday;

  const submitPost = async () => {
    if (!postText.trim()) return;
    setSubmittingPost(true);
    await fetch("/api/hr/engage/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: postText.trim(),
        type: feedTab,
        scope: orgTab === "org" ? "org" : teamScope,
      }),
    });
    setPost("");
    setSubmittingPost(false);
    mutate(postsUrl);
  };

  return (
    <div className={`min-h-screen ${C.page}`}>
      <div className="relative flex-1">
        <div className="pointer-events-none absolute bottom-[-6px] right-0 top-[176px] hidden w-[318px] text-[#e9eef6] xl:block">
          <DecorativeTree />
        </div>

        <div className="grid w-full gap-5 px-4 py-3 xl:grid-cols-[300px,470px] xl:justify-start xl:px-10">
          <section className="relative hidden h-[64px] w-[860px] overflow-hidden rounded-[2px] border border-[#2b3440] shadow-[0_1px_2px_rgba(15,23,42,0.14)] xl:col-span-2 xl:block">
            <div className="absolute inset-0">
              <BannerArt />
            </div>
            <div className="relative px-8 py-5">
              {/* Welcome text — pure white with a dark drop shadow so it
                  stays readable against the busy painterly banner regardless
                  of light/dark theme. */}
              <p
                className="text-[16px] font-semibold tracking-[-0.01em]"
                style={{
                  color: "#ffffff",
                  WebkitTextFillColor: "#ffffff",
                  textShadow: "0 1px 2px rgba(0,0,0,0.7), 0 0 12px rgba(0,0,0,0.5)",
                }}
              >
                Welcome {user?.name || "back"}!
              </p>
            </div>
          </section>

          <div className="space-y-3">
            <p className={`pb-0.5 pt-1 text-[13px] font-semibold leading-none ${C.t1}`}>
              Quick Access
            </p>

            <div
              className="relative overflow-hidden rounded-[2px] px-[12px] py-[11px] shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
              style={{ background: "#9b8aca", color: "#ffffff" }}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className="text-[11px] leading-none"
                  style={{ color: "rgba(255,255,255,0.86)", WebkitTextFillColor: "rgba(255,255,255,0.86)" }}
                  suppressHydrationWarning
                >
                  Time Today - {dl}
                </span>
                <Link
                  href="/dashboard/hr/attendance"
                  className="text-[11px] font-medium transition-colors hover:opacity-100"
                  style={{ color: "rgba(255,255,255,0.78)", WebkitTextFillColor: "rgba(255,255,255,0.78)" }}
                >
                  View All
                </Link>
              </div>

              <div className="mb-2 flex items-center justify-between">
                <p
                  className="text-[9px] font-bold uppercase tracking-[0.14em]"
                  style={{ color: "rgba(255,255,255,0.68)", WebkitTextFillColor: "rgba(255,255,255,0.68)" }}
                >Current Time</p>
                <span
                  className="rounded-[2px] bg-black/12 px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-[0.12em]"
                  style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff" }}
                >
                  {(todayLoc.mode ? todayLoc.mode : isRemoteMode ? "remote" : "office").toUpperCase()}
                </span>
              </div>

              {/* Clock display + action buttons on the same row, vertically
                  centered. The clock keeps its inner purple box; buttons sit
                  parallel to it on the right. */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-start gap-[1px] rounded-[2px] bg-[#6d5f99]/68 px-[10px] py-[9px]">
                  <span
                    suppressHydrationWarning
                    style={{
                      fontFamily: "'Segoe UI', Arial, sans-serif",
                      fontSize: 30,
                      letterSpacing: "-0.03em",
                      fontWeight: 400,
                      lineHeight: 1,
                      color: "#ffffff",
                    }}
                  >
                    {hh}:{mm}
                  </span>
                  <div className="flex flex-col gap-[1px] pt-[2px]">
                    <span
                      suppressHydrationWarning
                      style={{
                        fontFamily: "'Segoe UI', Arial, sans-serif",
                        fontSize: 13,
                        lineHeight: 1,
                        color: "rgba(255,255,255,0.9)",
                      }}
                    >
                      :{ss}
                    </span>
                    <span
                      suppressHydrationWarning
                      style={{
                        fontFamily: "'Segoe UI', Arial, sans-serif",
                        fontSize: 11,
                        lineHeight: 1,
                        color: "rgba(255,255,255,0.88)",
                      }}
                    >
                      {ap}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {!todayRec?.clockIn ? (
                    <button
                      onClick={clockIn}
                      className="h-[24px] rounded-[3px] px-3.5 text-[11px] font-semibold text-white transition hover:brightness-95"
                      style={{ background: isRemoteMode ? "#008CFF" : "#ff6a63" }}
                    >
                      {isRemoteMode ? "Remote Clock-in" : "Clock-in"}
                    </button>
                  ) : !todayRec?.clockOut ? (
                    <button
                      onClick={clockOut}
                      className="h-[24px] rounded-[3px] px-3.5 text-[11px] font-semibold text-white transition hover:brightness-95"
                      style={{ background: todayLoc.mode === "remote" ? "#008CFF" : "#ff6a63" }}
                    >
                      {todayLoc.mode === "remote" ? "Remote Clock-out" : "Clock-out"}
                    </button>
                  ) : (
                    <span className="flex h-[24px] items-center rounded-[3px] bg-white/15 px-3.5 text-[11px] font-semibold text-white/90">
                      Done
                    </span>
                  )}
                  <button className="flex h-[24px] items-center gap-1 rounded-[3px] bg-white px-2.5 text-[11px] font-medium text-[#4d5864] transition hover:bg-[#f4f6f8]">
                    Other <ChevronDown className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>

            <div className={`${C.card} p-3.5`}>
              <p className={`mb-3 text-[13px] font-semibold ${C.t1}`}>Inbox</p>
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#f2ecff]">
                  <Mail className="h-[18px] w-[18px] text-[#8a79da]" />
                </div>
                <div>
                  <p className={`text-[13px] font-semibold ${C.t1}`}>Good job!</p>
                  <p className={`mt-0.5 text-[11.5px] ${C.t3}`}>You have no pending actions</p>
                </div>
              </div>
            </div>

            <div className="relative min-h-[108px] overflow-hidden rounded-[3px] border border-[#cce2bf] px-4 py-3.5 text-white shadow-[0_1px_2px_rgba(15,23,42,0.08)]" style={{ background: "linear-gradient(180deg, #83c863 0%, #5da83e 100%)" }}>
              <HolidayScene />
              <div className="relative z-10">
                <div className="mb-2 flex items-start justify-between">
                  <span
                    className="text-[9.5px] font-bold uppercase tracking-[0.14em]"
                    style={{ color: "rgba(255,255,255,0.92)", WebkitTextFillColor: "rgba(255,255,255,0.92)" }}
                  >
                    Holidays
                  </span>
                  <Link
                    href={isAdmin ? "/dashboard/hr/admin/holidays" : "/dashboard/hr/leaves"}
                    className="text-[11px] transition"
                    style={{ color: "rgba(255,255,255,0.85)", WebkitTextFillColor: "rgba(255,255,255,0.85)" }}
                  >
                    View All
                  </Link>
                </div>

                {activeHoliday ? (
                  <>
                    <p
                      className="max-w-[220px] text-[16px] font-semibold leading-snug"
                      style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff" }}
                    >
                      {activeHoliday.name}
                    </p>
                    <p
                      className="mt-1 text-[11px]"
                      style={{ color: "rgba(255,255,255,0.88)", WebkitTextFillColor: "rgba(255,255,255,0.88)" }}
                    >
                      {new Date(activeHoliday.date).toLocaleDateString("en-IN", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                    <span
                      className="mt-2 inline-block rounded-[3px] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em]"
                      style={{
                        background: HOLIDAY_TYPE_COLOR[activeHoliday.type] ?? "#008CFF",
                        color: "#ffffff",
                        WebkitTextFillColor: "#ffffff",
                      }}
                    >
                      {HOLIDAY_TYPE_LABEL[activeHoliday.type] ?? "PUBLIC HOLIDAY"}
                    </span>
                  </>
                ) : (
                  <>
                    <p
                      className="text-[15px] font-semibold"
                      style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff" }}
                    >
                      No event today
                    </p>
                    <p
                      className="mt-1 text-[11px]"
                      style={{ color: "rgba(255,255,255,0.88)", WebkitTextFillColor: "rgba(255,255,255,0.88)" }}
                    >
                      No upcoming holidays on file.
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className={`${C.card} p-3.5`}>
              <p className={`mb-3 text-[13px] font-semibold ${C.t1}`}>On Leave Today</p>
              {onLeave.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {onLeave.slice(0, 4).map((u: any) => (
                    <div key={u.id} className="flex flex-col items-center gap-1">
                      <Av name={u.name} url={u.profilePictureUrl} size={36} />
                      <span className={`w-11 truncate text-center text-[9.5px] ${C.t3}`}>{u.name.split(" ")[0]}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={`text-[11.5px] ${C.t3}`}>No one on leave today</p>
              )}
            </div>

            <div className={`${C.card} p-3.5`}>
              <p className={`mb-3 text-[13px] font-semibold ${C.t1}`}>Working Remotely</p>
              {remote.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {remote.slice(0, 4).map((u: any) => (
                    <div key={u.id} className="flex flex-col items-center gap-1">
                      <Av name={u.name} url={u.profilePictureUrl} size={36} />
                      <span className={`w-11 truncate text-center text-[9.5px] ${C.t3}`}>{u.name.split(" ")[0]}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={`text-[11.5px] ${C.t3}`}>No one working remotely</p>
              )}
            </div>

            <div className={`${C.card} p-3.5`}>
              <p className={`mb-3 text-[13px] font-semibold ${C.t1}`}>Leave Balances</p>
              {balances.length > 0 ? (
                <div className="flex items-center justify-between gap-4">
                  <div className="flex gap-4">
                    {balances.slice(0, 2).map((b: any, i: number) => {
                      const avail = Math.max(0, (b.totalDays || 0) - (b.usedDays || 0));
                      return (
                        <div key={b.id} className="flex flex-col items-center gap-1">
                          <BalanceRing avail={avail} total={b.totalDays || 1} color={["#64c8ec", "#90d6f1"][i % 2]} />
                          <p className={`max-w-[88px] text-center text-[9px] font-medium uppercase leading-tight ${C.t3}`}>
                            {b.leaveType?.name}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <Link href="/dashboard/hr/leaves" className="text-[12px] font-medium text-[#008CFF] hover:underline">
                      Request Leave
                    </Link>
                    <Link href="/dashboard/hr/leaves" className="text-[12px] font-medium text-[#008CFF] hover:underline">
                      View All Balances
                    </Link>
                  </div>
                </div>
              ) : (
                <div>
                  <p className={`text-[11.5px] ${C.t3}`}>No leave balances configured</p>
                  <div className="mt-3 flex flex-col gap-2">
                    <Link href="/dashboard/hr/leaves" className="text-[12px] font-medium text-[#008CFF] hover:underline">
                      Request Leave
                    </Link>
                    <Link href="/dashboard/hr/leaves" className="text-[12px] font-medium text-[#008CFF] hover:underline">
                      View All Balances
                    </Link>
                  </div>
                </div>
              )}
            </div>

            <QuickLinksCard />
          </div>

          <div className="min-w-0">
            <div className="max-w-[470px] space-y-3">
              <div className={`${C.card} overflow-hidden`}>
                <div className={`flex items-center border-b ${C.div} px-1`}>
                  {[["org", "Organization"], ["team", user?.teamCapsule || "NB Media"]].map(([k, l]) => (
                    <button
                      key={k}
                      onClick={() => setOrgTab(k as "org" | "team")}
                      className={`px-4 py-2.5 text-[12.5px] font-medium border-b-2 -mb-px transition-colors ${
                        orgTab === k ? "border-[#008CFF] text-[#008CFF]" : `border-transparent ${C.t2}`
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>

                <div className="px-4 pt-3 pb-4">
                  <div className="mb-3 flex items-center gap-0.5">
                    {[
                      { k: "post", l: "Post", I: <Send style={{ width: 14, height: 14 }} /> },
                      { k: "poll", l: "Poll", I: <BarChart2 style={{ width: 14, height: 14 }} /> },
                      { k: "praise", l: "Praise", I: <Award style={{ width: 14, height: 14 }} /> },
                    ].map(({ k, l, I }) => (
                      <button
                        key={k}
                        onClick={() => setFT(k as "post" | "poll" | "praise")}
                        className={`flex items-center gap-1.5 rounded-[4px] px-3 py-1.5 text-[12px] font-medium transition-colors ${
                          feedTab === k ? "bg-[#f5f9ff] text-[#008CFF]" : `${C.t2} hover:bg-[#f7f9fc]`
                        }`}
                      >
                        {I}
                        {l}
                      </button>
                    ))}
                  </div>

                  <textarea
                    value={postText}
                    onChange={(e) => setPost(e.target.value)}
                    placeholder="Write your post here and mention your peers"
                    rows={2}
                    className={`w-full resize-none bg-transparent text-[13px] ${C.t2} placeholder-[#8a96a8] focus:outline-none`}
                    style={{ caretColor: "#008CFF" }}
                  />

                  {postText.trim() ? (
                    <div className={`mt-3 flex justify-end border-t ${C.div} pt-3`}>
                      <button
                        onClick={submitPost}
                        disabled={submittingPost}
                        className="h-8 rounded-[4px] bg-[#008CFF] px-5 text-[12px] font-semibold text-white transition hover:bg-[#0070d4] disabled:opacity-60"
                      >
                        {submittingPost ? "Posting..." : feedTab === "praise" ? "Send Praise" : "Post"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className={`${C.card} flex items-center justify-between px-4 py-3`}>
                <div className="min-w-0">
                  <p className={`truncate text-[12.5px] ${C.t3}`}>
                    {announcements.length > 0 ? announcements[0].title : "No announcements"}
                  </p>
                </div>
                {isAdmin ? (
                  <Link
                    href="/dashboard/hr/announcements"
                    className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-[#008CFF] text-white transition hover:bg-[#0070d4]"
                  >
                    <Plus className="h-4 w-4" />
                  </Link>
                ) : null}
              </div>

              <EventsWidget bTab={bTab} setBTab={setBTab} C={C} />

              <div className="space-y-3">
                {posts.length > 0 ? (
                  posts.slice(0, 4).map((post: any) => <FeedPostCard key={post.id} post={post} />)
                ) : analyticsData ? (
                  <div className={`${C.card} px-5 py-8 text-center`}>
                    <p className="text-[13px] font-semibold text-[#334455]">No posts yet</p>
                    <p className={`mt-1 text-[12px] ${C.t3}`}>Your home feed is ready and will fill as soon as the team starts posting.</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
