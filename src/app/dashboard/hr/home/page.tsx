"use client";
import { useState, useEffect } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { parseAttLoc, captureClockInGeo } from "@/lib/attendance-location";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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

// ── Holiday banner themes ────────────────────────────────────────────────
// Each scene paints a small SVG decoration along the bottom of the green
// card. Combined with a per-theme background gradient, this gives every
// holiday a recognizable visual identity. Picked from the holiday name via
// `pickHolidayTheme` (case-insensitive word match) — falls back to the
// rolling-hills default for anything unmatched.
const SCENE_CLS = "pointer-events-none absolute inset-x-0 bottom-0 h-[62px] w-full";

function HillsScene() {
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
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

function ChristmasScene() {
  // Snowy ground + 3 fir trees + falling snowflakes.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <g fill="rgba(255,255,255,0.7)">
        <circle cx="40"  cy="20" r="1.4" />
        <circle cx="120" cy="14" r="1.2" />
        <circle cx="220" cy="22" r="1.6" />
        <circle cx="290" cy="12" r="1.2" />
        <circle cx="160" cy="10" r="1.0" />
      </g>
      <path d="M0 78 C40 70 80 72 120 76 C170 70 220 72 260 78 C300 74 320 76 340 78 L340 88 L0 88 Z"
            fill="rgba(255,255,255,0.45)" />
      {[ {x: 60, h: 0}, {x: 170, h: 8}, {x: 280, h: 4} ].map((t) => (
        <g key={t.x} fill="rgba(255,255,255,0.55)">
          <polygon points={`${t.x},${40 - t.h} ${t.x - 11},${60 - t.h} ${t.x + 11},${60 - t.h}`} />
          <polygon points={`${t.x},${52 - t.h} ${t.x - 13},${74 - t.h} ${t.x + 13},${74 - t.h}`} />
          <rect x={t.x - 3} y={74 - t.h} width="6" height="6" fill="rgba(120,60,20,0.5)" />
        </g>
      ))}
    </svg>
  );
}

function DiwaliScene() {
  // Glowing fireworks halos + a row of diyas (oil lamps).
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <g fill="rgba(255,225,140,0.30)">
        <circle cx="60"  cy="20" r="9" />
        <circle cx="170" cy="14" r="7" />
        <circle cx="280" cy="22" r="10" />
      </g>
      <rect x="0" y="74" width="340" height="14" fill="rgba(50,15,40,0.35)" />
      {[50, 120, 190, 260].map((cx) => (
        <g key={cx}>
          <ellipse cx={cx} cy="74" rx="11" ry="4" fill="rgba(60,20,20,0.6)" />
          <ellipse cx={cx} cy="68" rx="3"  ry="6" fill="rgba(255,210,90,0.95)" />
          <ellipse cx={cx} cy="65" rx="1.4" ry="2.5" fill="rgba(255,255,255,0.7)" />
        </g>
      ))}
    </svg>
  );
}

function EidScene() {
  // Mosque silhouette with a central dome, two minarets, and a crescent moon.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <g>
        <circle cx="290" cy="22" r="10"  fill="rgba(255,255,255,0.85)" />
        <circle cx="294" cy="20" r="8.5" fill="rgba(45,108,37,1)" />
      </g>
      <g fill="rgba(20,60,30,0.45)">
        <rect x="0" y="78" width="340" height="10" />
        <rect x="60"  y="44" width="4" height="34" />
        <circle cx="62"  cy="42" r="3" />
        <rect x="276" y="44" width="4" height="34" />
        <circle cx="278" cy="42" r="3" />
        <rect x="100" y="58" width="140" height="20" />
        <path d="M120 58 Q170 28 220 58 Z" />
        <rect x="166" y="22" width="2" height="10" />
        <circle cx="167" cy="22" r="2" />
      </g>
    </svg>
  );
}

function HoliScene() {
  // Multi-colored powder splashes scattered across the card.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <circle cx="30"  cy="30" r="14" fill="rgba(255,200,80,0.55)" />
      <circle cx="80"  cy="20" r="10" fill="rgba(255,100,180,0.55)" />
      <circle cx="160" cy="34" r="16" fill="rgba(80,200,255,0.5)" />
      <circle cx="240" cy="22" r="11" fill="rgba(180,80,255,0.55)" />
      <circle cx="300" cy="32" r="13" fill="rgba(80,255,150,0.55)" />
      <circle cx="200" cy="50" r="9"  fill="rgba(255,180,80,0.55)" />
      <circle cx="50"  cy="60" r="8"  fill="rgba(255,100,180,0.55)" />
      <circle cx="320" cy="60" r="10" fill="rgba(80,200,255,0.5)" />
      <rect x="0" y="78" width="340" height="10" fill="rgba(120,40,80,0.35)" />
    </svg>
  );
}

function TricolorScene() {
  // Indian flag silhouette: pole + saffron/white/green stripes + Ashoka chakra.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <rect x="170" y="20" width="2"  height="58" fill="rgba(80,80,80,0.55)" />
      <rect x="172" y="22" width="60" height="10" fill="rgba(255,153,51,0.85)" />
      <rect x="172" y="32" width="60" height="10" fill="rgba(255,255,255,0.92)" />
      <rect x="172" y="42" width="60" height="10" fill="rgba(19,136,8,0.85)" />
      <circle cx="202" cy="37" r="3.4" fill="none" stroke="rgba(0,0,128,0.7)" strokeWidth="0.9" />
      <rect x="0" y="78" width="340" height="10" fill="rgba(60,60,60,0.35)" />
    </svg>
  );
}

function NewYearScene() {
  // City skyline at night with three firework bursts in the sky.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      {[
        { x: 60,  c: "rgba(255,200,80,0.75)" },
        { x: 170, c: "rgba(255,100,180,0.75)" },
        { x: 280, c: "rgba(80,200,255,0.75)" },
      ].map((b) => (
        <g key={b.x} stroke={b.c} strokeWidth="1" strokeLinecap="round">
          <line x1={b.x}     y1="14" x2={b.x}     y2="34" />
          <line x1={b.x - 10} y1="24" x2={b.x + 10} y2="24" />
          <line x1={b.x - 8}  y1="16" x2={b.x + 8}  y2="32" />
          <line x1={b.x + 8}  y1="16" x2={b.x - 8}  y2="32" />
        </g>
      ))}
      <g fill="rgba(0,0,30,0.4)">
        <rect x="0"   y="62" width="340" height="26" />
        <rect x="40"  y="48" width="20"  height="20" />
        <rect x="100" y="42" width="24"  height="26" />
        <rect x="150" y="50" width="20"  height="18" />
        <rect x="200" y="44" width="22"  height="24" />
        <rect x="260" y="46" width="20"  height="22" />
      </g>
    </svg>
  );
}

function KrishnaScene() {
  // Hanging matki (pot) with a flute and a peacock-feather hint.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <line x1="170" y1="0" x2="170" y2="40" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" />
      <g>
        <ellipse cx="170" cy="52" rx="20" ry="14" fill="rgba(255,200,40,0.55)" />
        <rect x="160"  y="40" width="20" height="6" fill="rgba(255,180,40,0.55)" />
        <ellipse cx="170" cy="40" rx="10" ry="2.5" fill="rgba(60,30,10,0.5)" />
      </g>
      <g stroke="rgba(255,255,255,0.55)" strokeWidth="1.2" fill="none">
        <path d="M156 60 Q160 70 156 80" />
        <path d="M180 60 Q184 70 184 80" />
        <path d="M170 64 Q172 74 172 84" />
      </g>
      <g fill="rgba(80,180,200,0.55)">
        <ellipse cx="40" cy="40" rx="3" ry="9" />
        <ellipse cx="40" cy="38" rx="1.5" ry="3" fill="rgba(255,200,40,0.85)" />
      </g>
      <rect x="0" y="78" width="340" height="10" fill="rgba(0,30,80,0.45)" />
    </svg>
  );
}

function FestiveScene() {
  // Generic Hindu-festive scene: sun rays + a row of marigold-style dots.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <g stroke="rgba(255,230,150,0.45)" strokeWidth="1" strokeLinecap="round">
        {[0, 30, 60, 90, 120, 150, 180].map((deg) => {
          const rad = (deg * Math.PI) / 180;
          const x1 = 170, y1 = 78;
          const x2 = 170 + Math.cos(Math.PI + rad) * 32;
          const y2 = 78  + Math.sin(Math.PI + rad) * 32;
          return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
      </g>
      <circle cx="170" cy="78" r="14" fill="rgba(255,200,80,0.55)" />
      <g fill="rgba(255,150,80,0.6)">
        {[20, 60, 100, 220, 260, 300, 320].map((cx) => (
          <circle key={cx} cx={cx} cy="80" r="4" />
        ))}
      </g>
      <rect x="0" y="84" width="340" height="4" fill="rgba(120,40,30,0.35)" />
    </svg>
  );
}

function GoodFridayScene() {
  // Restrained scene with a small cross silhouette + faded sky line.
  return (
    <svg viewBox="0 0 340 88" className={SCENE_CLS}>
      <rect x="167" y="32" width="6"  height="46" fill="rgba(255,255,255,0.5)" />
      <rect x="155" y="44" width="30" height="6"  fill="rgba(255,255,255,0.5)" />
      <line x1="0" y1="14" x2="340" y2="14" stroke="rgba(255,255,255,0.18)" strokeWidth="0.6" />
      <rect x="0" y="78" width="340" height="10" fill="rgba(40,30,60,0.4)" />
    </svg>
  );
}

type HolidayTheme = {
  bg: string;
  border: string;
  scene: React.ReactNode;
  badge?: string; // optional override for badge background
};

const HOLIDAY_THEMES: Record<string, HolidayTheme> = {
  christmas:   { bg: "linear-gradient(180deg, #d4453a 0%, #6f1818 100%)", border: "#9b2222", scene: <ChristmasScene />,   badge: "#0a8a3a" },
  diwali:      { bg: "linear-gradient(180deg, #f29a35 0%, #5a1a55 100%)", border: "#a04060", scene: <DiwaliScene />,      badge: "#ffb84d" },
  eid:         { bg: "linear-gradient(180deg, #6cb454 0%, #2d6c25 100%)", border: "#cce2bf", scene: <EidScene />,         badge: "#0e6a2a" },
  holi:        { bg: "linear-gradient(180deg, #ff6f9c 0%, #5a2078 100%)", border: "#a04080", scene: <HoliScene />,        badge: "#7a1f6e" },
  tricolor:    { bg: "linear-gradient(180deg, #ff9933 0%, #138808 100%)", border: "#cc6622", scene: <TricolorScene />,    badge: "#000080" },
  newyear:     { bg: "linear-gradient(180deg, #1e2a78 0%, #050828 100%)", border: "#1e2a78", scene: <NewYearScene />,     badge: "#ffb84d" },
  krishna:     { bg: "linear-gradient(180deg, #1e63b8 0%, #08234a 100%)", border: "#1e4ea0", scene: <KrishnaScene />,     badge: "#ffb84d" },
  festive:     { bg: "linear-gradient(180deg, #e87a3a 0%, #8a2a16 100%)", border: "#aa4422", scene: <FestiveScene />,     badge: "#a82c12" },
  goodfriday:  { bg: "linear-gradient(180deg, #5b4783 0%, #1c1233 100%)", border: "#3b2c5e", scene: <GoodFridayScene />,  badge: "#3b2c5e" },
  default:     { bg: "linear-gradient(180deg, #83c863 0%, #5da83e 100%)", border: "#cce2bf", scene: <HillsScene />,                            },
};

// Pick a theme based on the holiday name. Word-boundary matches keep us
// from confusing "Holi" with the literal word "holiday" or matching
// "Eid" inside something unrelated.
function pickHolidayTheme(name: string | null | undefined): HolidayTheme {
  const n = (name || "").toLowerCase();
  const has = (...words: string[]) => words.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, "i").test(n));
  if (has("christmas", "xmas")) return HOLIDAY_THEMES.christmas;
  if (has("diwali", "deepavali", "govardhan", "bhai dooj")) return HOLIDAY_THEMES.diwali;
  if (has("eid", "bakrid", "ramadan", "ramzan", "muharram")) return HOLIDAY_THEMES.eid;
  if (has("holi") && !has("holiday")) return HOLIDAY_THEMES.holi;
  if (has("independence day", "republic day", "gandhi jayanti", "ambedkar", "labour day")) return HOLIDAY_THEMES.tricolor;
  if (has("new year")) return HOLIDAY_THEMES.newyear;
  if (has("janmashtami", "krishna", "ram navami")) return HOLIDAY_THEMES.krishna;
  if (has("good friday", "easter")) return HOLIDAY_THEMES.goodfriday;
  if (has("ganesh", "dussehra", "shivratri", "raksha bandhan", "onam", "pongal", "sankranti", "mahavir", "buddha", "guru nanak")) return HOLIDAY_THEMES.festive;
  return HOLIDAY_THEMES.default;
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
  // Index into the upcoming-holidays list for the green Holidays card. The
  // arrows below cycle through this; resets if the list shrinks.
  const [holidayIdx, setHolidayIdx] = useState(0);

  // Browser geolocation permission state. Attendance needs location, so we
  // check this up-front and show a banner + disable the clock-in button when
  // permission has been permanently blocked. "prompt" is fine — clicking the
  // button will trigger the browser's native ask.
  type LocPerm = "granted" | "denied" | "prompt" | "unsupported" | "checking";
  const [locPerm, setLocPerm] = useState<LocPerm>("checking");
  // Shows a "Getting location…" label on the clock-in button so users know
  // the browser is busy asking the OS for coordinates (first-time GPS/Wi-Fi
  // lookup on Windows can take 10–15s).
  const [clockingIn, setClockingIn] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) {
      setLocPerm("unsupported");
      return;
    }
    let status: PermissionStatus | null = null;
    const check = () => {
      navigator.permissions.query({ name: "geolocation" as PermissionName })
        .then((s) => {
          if (status) status.onchange = null;
          status = s;
          setLocPerm(s.state as LocPerm);
          s.onchange = () => setLocPerm(s.state as LocPerm);
        })
        .catch(() => setLocPerm("unsupported"));
    };
    check();
    window.addEventListener("focus", check);
    return () => {
      window.removeEventListener("focus", check);
      if (status) status.onchange = null;
    };
  }, []);

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
  // Upcoming holidays (today + future), sorted ascending by date so the arrow
  // navigation walks the calendar in order. `upcoming[0]` is today's holiday
  // when one exists (filter is `>= today`).
  const upcoming = allHolidays
    .filter((h) => h.date >= istTodayStr)
    .sort((a, b) => a.date.localeCompare(b.date));
  // Keep the index inside bounds when the list size changes (data refresh,
  // year rollover, etc.).
  useEffect(() => {
    if (holidayIdx >= upcoming.length && upcoming.length > 0) setHolidayIdx(0);
  }, [upcoming.length, holidayIdx]);
  const todayRec = myData?.todayRecord;
  const todayLoc = parseAttLoc(todayRec?.location);
  const teamScope = user?.teamCapsule || "team";
  const postsUrl = orgTab === "org"
    ? "/api/hr/engage/posts"
    : `/api/hr/engage/posts?scope=${encodeURIComponent(teamScope)}`;
  const { data: posts = [] } = useSWR(postsUrl, fetcher);
  const { data: announcements = [] } = useSWR("/api/hr/announcements", fetcher);

  const clockIn = async () => {
    // Location is mandatory. Always attempt a fresh geolocation read — the
    // cached `locPerm` state can lag (Chrome doesn't always fire `onchange`
    // when permission is toggled from the address-bar popup), so the real
    // source of truth is whether coordinates come back.
    setClockingIn(true);
    try {
      const geo = await captureClockInGeo();
      if (!geo.ok) {
        alert(`Can't clock in — ${geo.message}`);
        return;
      }
      const res = await fetch("/api/hr/attendance/clock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: geo.lat, lng: geo.lng, address: geo.address }),
      });
      const d = await res.json();
      if (!res.ok) { alert(d.error); return; }
      mutate(`/api/hr/attendance?month=${monthKey}`);
    } finally {
      setClockingIn(false);
    }
  };
  const clockOut = async () => {
    const res = await fetch("/api/hr/attendance/clock-out", { method: "POST" });
    const d = await res.json();
    if (!res.ok) return alert(d.error);
    mutate(`/api/hr/attendance?month=${monthKey}`);
  };
  const onLeave  = (boardData?.board || []).filter((u: any) => u.status === "on_leave");
  // Split clocked-in employees by their actual location mode (from Attendance.location JSON).
  const clockedIn = (boardData?.board || []).filter((u: any) => u.status === "present" || u.status === "late");
  const remote    = clockedIn.filter((u: any) => parseAttLoc(u.location).mode === "remote");
  const balances = (balanceData as any[]).filter(b => b.leaveType).slice(0, 3);
  // `upcoming` already includes today (filter is `>= today`), so indexing
  // into it covers both "today's holiday" and the future ones the arrows
  // page through.
  const activeHoliday = upcoming[holidayIdx] ?? null;
  const canPrevHoliday = holidayIdx > 0;
  const canNextHoliday = holidayIdx < upcoming.length - 1;
  // Per-holiday visual theme (background gradient + bottom decoration).
  const holidayTheme = pickHolidayTheme(activeHoliday?.name);

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
        <div className="pointer-events-none absolute bottom-[-6px] right-0 top-[176px] hidden w-[318px] text-[#e4e0ee] opacity-60 xl:block">
          <DecorativeTree />
        </div>

        <div className="grid w-full gap-5 px-4 py-3 xl:grid-cols-[400px_minmax(0,1fr)] xl:max-w-[1080px] xl:justify-start xl:px-10">
          <section className="relative hidden h-[64px] w-full overflow-hidden rounded-[2px] border border-[#2b3440] shadow-[0_1px_2px_rgba(15,23,42,0.14)] xl:col-span-2 xl:block">
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
              className="relative overflow-hidden rounded-[2px] px-[14px] py-[11px] shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
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

              {/* Location permission warning — attendance requires location. */}
              {!todayRec?.clockIn && locPerm === "denied" && (
                <div className="mb-2 rounded-[3px] border border-red-300 bg-red-50 px-2 py-1.5 text-[10.5px] leading-snug text-red-700">
                  <strong>Location access blocked.</strong> Enable location in your browser settings to clock in.
                </div>
              )}
              {!todayRec?.clockIn && locPerm === "unsupported" && (
                <div className="mb-2 rounded-[3px] border border-amber-300 bg-amber-50 px-2 py-1.5 text-[10.5px] leading-snug text-amber-700">
                  <strong>Location unavailable.</strong> Your browser can't share location. Clock-in needs location.
                </div>
              )}

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
                      disabled={clockingIn}
                      className="h-[24px] whitespace-nowrap rounded-[3px] px-3.5 text-[11px] font-semibold text-white transition hover:brightness-95 disabled:opacity-70 disabled:cursor-wait"
                      style={{ background: isRemoteMode ? "#008CFF" : "#ff6a63" }}
                    >
                      {clockingIn ? "Getting location…" : isRemoteMode ? "Remote Clock-in" : "Clock-in"}
                    </button>
                  ) : !todayRec?.clockOut ? (
                    <button
                      onClick={clockOut}
                      className="h-[24px] whitespace-nowrap rounded-[3px] px-3.5 text-[11px] font-semibold text-white transition hover:brightness-95"
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

            <div
              className="relative min-h-[108px] overflow-hidden rounded-[3px] border px-4 py-3.5 text-white shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition-colors"
              style={{ background: holidayTheme.bg, borderColor: holidayTheme.border }}
            >
              {holidayTheme.scene}

              {/* Prev/next arrows — only render when there's more than one
                  holiday to page through. */}
              {upcoming.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setHolidayIdx((i) => Math.max(0, i - 1))}
                    disabled={!canPrevHoliday}
                    aria-label="Previous holiday"
                    className="absolute left-1 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-black/15 text-white transition hover:bg-black/30 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setHolidayIdx((i) => Math.min(upcoming.length - 1, i + 1))}
                    disabled={!canNextHoliday}
                    aria-label="Next holiday"
                    className="absolute right-1 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-black/15 text-white transition hover:bg-black/30 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </>
              )}

              <div className={`relative z-10 ${upcoming.length > 1 ? "px-7" : ""}`}>
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
                      className="max-w-full truncate text-[16px] font-semibold leading-snug"
                      title={activeHoliday.name}
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
                        background: holidayTheme.badge ?? HOLIDAY_TYPE_COLOR[activeHoliday.type] ?? "#008CFF",
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
            <div className="space-y-3">
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
