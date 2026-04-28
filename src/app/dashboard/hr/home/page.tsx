"use client";
import { useState, useEffect, useRef } from "react";
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
  AtSign,
  Image as ImageIcon,
  Smile,
  X,
  Trash2,
  Paperclip,
  Info,
  Star,
  ShieldCheck,
  Lightbulb,
  Search as SearchIcon,
  BookOpen,
  Scissors,
  Users as UsersIcon,
  Sparkles,
  Flame,
  Swords,
  Zap,
  Camera,
  PenTool,
  BarChart3 as BarChart3Icon,
  Rocket,
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

  // Avatar tile in the horizontal "upcoming" strip — circle photo on top,
  // name + small date underneath. Matches the Keka birthdays layout.
  const avatarTile = (p: { userId: number; name: string; profilePictureUrl: string | null; dateLabel: string }) => (
    <Link
      key={p.userId}
      href={`/dashboard/hr/people/${p.userId}`}
      className="flex w-[88px] flex-shrink-0 flex-col items-center gap-1 rounded-md py-1 hover:bg-slate-50"
    >
      {p.profilePictureUrl ? (
        <img
          src={p.profilePictureUrl}
          alt={p.name}
          className="h-12 w-12 rounded-full object-cover ring-2 ring-white shadow-[0_2px_8px_rgba(15,23,42,0.08)]"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
        />
      ) : (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#e8f1fc] text-[14px] font-semibold text-[#0f4e93] ring-2 ring-white shadow-[0_2px_8px_rgba(15,23,42,0.08)]">
          {(p.name || "?").trim().slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className={`mt-0.5 max-w-full truncate text-center text-[11.5px] font-medium ${C.t1}`}>
        {p.name.split(" ")[0]}{p.name.split(" ").length > 1 ? "." : ""}
      </span>
      <span className={`text-center text-[10.5px] ${C.t3}`}>{p.dateLabel}</span>
    </Link>
  );

  // Empty-state illustration: cake + bunting drawn entirely in inline SVG so it
  // matches the muted theme without shipping extra image assets.
  const emptyIllustration = (label: string) => (
    <div className="flex flex-col items-center gap-2 py-6">
      <svg viewBox="0 0 120 80" className="h-16 w-24 text-slate-300">
        {/* bunting */}
        <path d="M 8 14 Q 60 28 112 14" fill="none" stroke="currentColor" strokeWidth="1" />
        {[16, 30, 44, 58, 72, 86, 100].map((x, i) => {
          const y = 14 + Math.abs(60 - x) * -0.18 + 1;
          return <path key={i} d={`M ${x} ${y} l 3 6 l -6 0 z`} fill="currentColor" opacity="0.65" />;
        })}
        {/* cake */}
        <rect x="42" y="55" width="36" height="14" rx="1.5" fill="currentColor" opacity="0.55" />
        <rect x="38" y="60" width="44" height="3" fill="currentColor" opacity="0.4" />
        <rect x="58" y="44" width="4" height="11" fill="currentColor" opacity="0.65" />
        <path d="M 60 38 q -2 3 0 6 q 2 -3 0 -6 z" fill="#ec7e85" opacity="0.85" />
      </svg>
      <p className={`text-[12px] ${C.t3}`}>{label}</p>
    </div>
  );

  const sectionHeader = (label: string) => (
    <p className={`text-[11.5px] font-semibold ${C.t2} mb-2`}>{label}</p>
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

      <div className="px-4 py-4 space-y-4">
        {/* Birthdays */}
        {bTab === "birthday" && (
          <>
            <div>
              {sectionHeader("Birthdays today")}
              {birthdays.today.length === 0
                ? emptyIllustration("No birthdays today.")
                : <div className="flex flex-wrap gap-2">{birthdays.today.map((p: any) => avatarTile(p))}</div>}
            </div>
            <div>
              {sectionHeader("Upcoming Birthdays")}
              {birthdays.upcoming.length === 0
                ? <p className={`text-[12px] ${C.t3}`}>No upcoming birthdays in the next 10 days</p>
                : <div className="flex flex-wrap gap-2">{birthdays.upcoming.map((p: any) => avatarTile(p))}</div>}
            </div>
          </>
        )}

        {/* Work anniversaries */}
        {bTab === "anniversary" && (
          <div>
            {sectionHeader("This week")}
            {anniversaries.thisWeek.length === 0
              ? emptyIllustration("No work anniversaries this week.")
              : <div className="flex flex-wrap gap-2">
                  {anniversaries.thisWeek.map((p: any) => avatarTile({
                    ...p,
                    dateLabel: `${p.dateLabel} · ${p.years} yr${p.years === 1 ? "" : "s"}`,
                  }))}
                </div>}
          </div>
        )}

        {/* New joinees */}
        {bTab === "joinees" && (
          <div>
            {sectionHeader("This month")}
            {newJoinees.thisMonth.length === 0
              ? emptyIllustration("No new joinees this month.")
              : <div className="flex flex-wrap gap-2">{newJoinees.thisMonth.map((p: any) => avatarTile(p))}</div>}
          </div>
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
    <img
      src="/image_1b069270.png"
      alt=""
      aria-hidden="true"
      className="h-full w-full object-cover object-right select-none"
      draggable={false}
    />
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
    { label: "Tools", href: "/dashboard/tools" },
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
  // Expanded composer state — controls the Post / Poll / Praise editor card
  // that opens when the user clicks the collapsed prompt.
  const [composerOpen, setComposerOpen] = useState(false);
  const [postMedia, setPostMedia]       = useState<string | null>(null); // base64 data URL
  const [emojiOpen, setEmojiOpen]       = useState(false);
  const [postScope, setPostScope]       = useState<"org"|"team">("org");
  // Mention picker — null = closed, "" or "abc" = open with that filter prefix.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const composerTextareaRef             = useRef<HTMLTextAreaElement>(null);

  // Poll-tab state — question + variable-length option list + meta flags.
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions]   = useState<string[]>(["", "", ""]);
  const [pollExpires, setPollExpires]   = useState("");
  const [pollNotify, setPollNotify]     = useState(false);
  const [pollAnon, setPollAnon]         = useState(false);

  // Praise-tab state — recipient picker + description (reuses postText) +
  // badge + project + multiple attachments.
  const [praiseToId, setPraiseToId]     = useState<number | null>(null);
  const [praiseToName, setPraiseToName] = useState("");
  const [praiseSearch, setPraiseSearch] = useState("");
  const [praiseSearchOpen, setPraiseSearchOpen] = useState(false);
  const [praiseBadge, setPraiseBadge]   = useState<string | null>(null);
  const [praiseBadgeOpen, setPraiseBadgeOpen] = useState(false);
  const [praiseProject, setPraiseProject] = useState("");
  const [praiseFiles, setPraiseFiles]   = useState<{ name: string; data: string }[]>([]);

  // Badge palette — id, label, ring color (background of the circle), and the
  // lucide icon that sits inside. The praise renderer can map id → visual
  // later; here we just pass the label as the stored badge string.
  type Badge = { id: string; label: string; bg: string; Icon: any };
  const PRAISE_BADGES: Badge[] = [
    { id: "top-performer",       label: "Top Performer",        bg: "#f5b800", Icon: Star          },
    { id: "leadership-impact",   label: "Leadership Impact",    bg: "#3b82f6", Icon: ShieldCheck   },
    { id: "values-champion",     label: "Values Champion",      bg: "#ef4444", Icon: Lightbulb     },
    { id: "insightful-investigator", label: "Insightful Investigator", bg: "#22c1c3", Icon: SearchIcon },
    { id: "master-storyteller",  label: "Master Storyteller",   bg: "#9b8aca", Icon: BookOpen      },
    { id: "editing-maestro",     label: "Editing Maestro",      bg: "#ec7e85", Icon: Scissors      },
    { id: "team-champion",       label: "Team Champion",        bg: "#73c043", Icon: UsersIcon     },
    { id: "rising-star",         label: "Rising star",          bg: "#f5b800", Icon: Sparkles      },
    { id: "channel-champion",    label: "Channel Champion",     bg: "#a78bfa", Icon: Flame         },
    { id: "narrative-ninja",     label: "Narrative Ninja",      bg: "#22c1c3", Icon: Swords        },
    { id: "innovation-catalyst", label: "Innovation Catalyst",  bg: "#9b6bd1", Icon: Zap           },
    { id: "production-powerhouse", label: "Production Powerhouse", bg: "#5b8def", Icon: Camera     },
    { id: "creative-genius",     label: "Creative Genius",      bg: "#5b8def", Icon: PenTool       },
    { id: "analytics-ace",       label: "Analytics Ace",        bg: "#a8a29e", Icon: BarChart3Icon },
    { id: "extra-mile-champion", label: "Extra Mile Champion",  bg: "#ec4899", Icon: Rocket        },
  ];

  const activeBadge = praiseBadge ? PRAISE_BADGES.find(b => b.id === praiseBadge || b.label === praiseBadge) : null;

  // Award medal silhouette: a coloured disc with a faint ring + two angled
  // cloth ribbons trailing below it. The icon is overlaid in white. Pure CSS
  // — no SVG / images — so it scales cleanly at any size.
  const BadgeMedal = ({ b, size = 56 }: { b: Badge; size?: number }) => {
    const ribbonW = Math.round(size * 0.32);
    const ribbonH = Math.round(size * 0.55);
    const iconSize = Math.round(size * 0.42);
    return (
      <span
        className="relative inline-flex flex-shrink-0 items-start justify-center"
        style={{ width: size, height: Math.round(size * 1.32) }}
      >
        {/* Left ribbon */}
        <span
          className="absolute"
          style={{
            background: b.bg,
            width: ribbonW,
            height: ribbonH,
            left: Math.round(size * 0.18),
            top: Math.round(size * 0.55),
            clipPath: "polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 70%)",
            opacity: 0.85,
            transform: "rotate(-8deg)",
            transformOrigin: "top center",
          }}
        />
        {/* Right ribbon */}
        <span
          className="absolute"
          style={{
            background: b.bg,
            width: ribbonW,
            height: ribbonH,
            right: Math.round(size * 0.18),
            top: Math.round(size * 0.55),
            clipPath: "polygon(0 0, 100% 0, 100% 70%, 50% 100%, 0 60%)",
            opacity: 0.85,
            transform: "rotate(8deg)",
            transformOrigin: "top center",
          }}
        />
        {/* Disc with ring */}
        <span
          className="absolute flex items-center justify-center rounded-full text-white shadow-[0_4px_10px_rgba(15,23,42,0.12)]"
          style={{
            background: b.bg,
            width: size,
            height: size,
            top: 0,
            boxShadow: `inset 0 0 0 3px rgba(255,255,255,0.18), 0 4px 10px rgba(15,23,42,0.10)`,
          }}
        >
          <b.Icon size={iconSize} strokeWidth={2.2} />
        </span>
      </span>
    );
  };

  // Lazy-loaded employee directory for the @ mention picker. Pulled once when
  // the composer opens — cached by SWR for the rest of the session.
  const { data: directory = [] } = useSWR<any[]>(
    composerOpen ? "/api/hr/employees?isActive=true" : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );

  const insertAtCursor = (snippet: string) => {
    const el = composerTextareaRef.current;
    if (!el) { setPost(t => t + snippet); return; }
    const start = el.selectionStart ?? el.value.length;
    const end   = el.selectionEnd   ?? el.value.length;
    const next  = el.value.slice(0, start) + snippet + el.value.slice(end);
    setPost(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  };

  // Detect whether the cursor is inside an active @-token and update the
  // mention-picker filter to match. Called from textarea onChange.
  const handleComposerChange = (value: string) => {
    setPost(value);
    const el = composerTextareaRef.current;
    if (!el) { setMentionQuery(null); return; }
    const cursor = el.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const m = before.match(/@([\w.\-]*)$/); // @ followed by word chars / dot / hyphen
    setMentionQuery(m ? m[1] : null);
  };

  // Replace the current @-token with `@Name` (no spaces in handle).
  const insertMention = (name: string) => {
    const el = composerTextareaRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? postText.length;
    const before = postText.slice(0, cursor);
    const after  = postText.slice(cursor);
    const m = before.match(/@([\w.\-]*)$/);
    const handle = `@${name.replace(/\s+/g, "")} `;
    const newBefore = m ? before.slice(0, before.length - m[0].length) + handle : before + handle;
    const next = newBefore + after;
    setPost(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = newBefore.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const mentionMatches = mentionQuery !== null
    ? (directory as any[])
        .filter((u) => (u.name || "").toLowerCase().includes(mentionQuery.toLowerCase()))
        .slice(0, 6)
    : [];

  const handlePickImage = (file: File | null) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert("Image too large (max 5 MB)"); return; }
    const reader = new FileReader();
    reader.onload = () => setPostMedia(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const resetComposer = () => {
    setPost("");
    setPostMedia(null);
    setEmojiOpen(false);
    setComposerOpen(false);
    setMentionQuery(null);
    setPollQuestion("");
    setPollOptions(["", "", ""]);
    setPollExpires("");
    setPollNotify(false);
    setPollAnon(false);
    setPraiseToId(null);
    setPraiseToName("");
    setPraiseSearch("");
    setPraiseSearchOpen(false);
    setPraiseBadge(null);
    setPraiseBadgeOpen(false);
    setPraiseProject("");
    setPraiseFiles([]);
  };

  const addPraiseFile = (file: File | null) => {
    if (!file) return;
    if (praiseFiles.length >= 5) { alert("Max 5 attachments."); return; }
    if (file.size > 5 * 1024 * 1024) { alert(`"${file.name}" is over 5 MB.`); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPraiseFiles(prev => [...prev, { name: file.name, data: reader.result as string }]);
      }
    };
    reader.readAsDataURL(file);
  };

  const praiseMatches = praiseSearchOpen
    ? (directory as any[])
        .filter((u) => (u.name || "").toLowerCase().includes(praiseSearch.toLowerCase()))
        .slice(0, 8)
    : [];
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
  // Pull the caller's profile so we can read the department — used to label
  // the "team" tab + "Posting to" option with the actual team name (e.g.
  // "NB_Artificial Intelligence") instead of a hardcoded fallback.
  const { data: meProfile } = useSWR<any>("/api/hr/profile", fetcher);
  const myDepartment: string = (meProfile?.employeeProfile?.department || "").trim();
  const teamScope: string = user?.teamCapsule || myDepartment || "team";
  const teamLabel: string = myDepartment || user?.teamCapsule || "My team";
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
    let content: string;
    let praiseTo: number | null = null;
    let media: string | null = null;
    if (feedTab === "poll") {
      const cleanOptions = pollOptions.map(o => o.trim()).filter(Boolean);
      if (!pollQuestion.trim()) { alert("Add a poll question first."); return; }
      if (cleanOptions.length < 2) { alert("Polls need at least two options."); return; }
      content = `__POLL__${JSON.stringify({
        question: pollQuestion.trim(),
        options: cleanOptions,
        expiresAt: pollExpires || null,
        notify: pollNotify,
        anonymous: pollAnon,
      })}`;
    } else if (feedTab === "praise") {
      if (!praiseToId) { alert("Pick the employee you're praising."); return; }
      if (!postText.trim()) { alert("Add a short reason for the praise."); return; }
      // EngagePost has no badge/project/multi-attachment columns. Encode the
      // extras inline with a sentinel so the feed can render them later.
      content = `__PRAISE__${JSON.stringify({
        text: postText.trim(),
        badge: praiseBadge,
        project: praiseProject || null,
        attachments: praiseFiles.map(f => ({ name: f.name, data: f.data })),
      })}`;
      praiseTo = praiseToId;
      media = praiseFiles[0]?.data ?? null;
    } else {
      if (!postText.trim() && !postMedia) return;
      content = postText.trim();
      media = postMedia;
    }
    setSubmittingPost(true);
    await fetch("/api/hr/engage/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        type: feedTab,
        scope: postScope === "org" ? "org" : teamScope,
        mediaUrl: media,
        praiseToId: praiseTo,
      }),
    });
    resetComposer();
    setSubmittingPost(false);
    mutate(postsUrl);
  };

  return (
    <div className={`h-[calc(100vh-54px)] overflow-hidden flex flex-col ${C.page}`}>
      <div className="relative flex-1 min-h-0 flex flex-col">
        <div
          className="pointer-events-none absolute inset-y-0 -right-[120px] hidden w-[600px] lg:block"
          style={{
            backgroundImage: "url('/image_1b069270.png')",
            backgroundRepeat: "no-repeat",
            backgroundSize: "contain",
            backgroundPosition: "right bottom",
            mixBlendMode: "darken",
          }}
          aria-hidden="true"
        />
        {/* DecorativeTree kept for legacy references but no longer rendered. */}

        <div className="grid w-full flex-1 min-h-0 gap-5 px-4 py-3 xl:grid-cols-[400px,700px] xl:grid-rows-[auto_minmax(0,1fr)] xl:justify-start xl:px-10">
          <section className="relative hidden h-[72px] w-[1180px] overflow-hidden rounded-[2px] border border-[#2b3440] shadow-[0_1px_2px_rgba(15,23,42,0.14)] xl:col-span-2 xl:block">
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

          <div className="space-y-3 min-h-0 overflow-y-auto pr-1">
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
                      fontFamily: "var(--font-mulish)",
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
                        fontFamily: "var(--font-mulish)",
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
                        fontFamily: "var(--font-mulish)",
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

          <div className="min-w-0 min-h-0 overflow-y-auto pr-1">
            <div className="max-w-[700px] space-y-3">
              <div className={`${C.card} overflow-hidden`}>
                <div className={`flex items-center border-b ${C.div} px-1`}>
                  {[["org", "Organization"], ["team", teamLabel]].map(([k, l]) => (
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
                  {!composerOpen ? (
                    /* Collapsed prompt — clicking opens the full composer */
                    <button
                      type="button"
                      onClick={() => { setComposerOpen(true); setPostScope(orgTab); requestAnimationFrame(() => composerTextareaRef.current?.focus()); }}
                      className={`w-full rounded-[6px] border ${C.div} bg-transparent px-4 py-3 text-left text-[13px] ${C.t3} transition hover:bg-[#f7f9fc]`}
                    >
                      Write your post here and mention your peers
                    </button>
                  ) : (
                    <div className={`rounded-[6px] border ${C.div} p-3`}>
                      {/* Type tabs */}
                      <div className={`mb-3 flex items-center gap-0.5 border-b ${C.div} pb-2`}>
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

                      {feedTab === "praise" ? (
                        /* ── Praise form ────────────────────────────────── */
                        <div className="space-y-5">
                          {/* Search Employee */}
                          <div className="relative">
                            <input
                              type="text"
                              value={praiseToName ? praiseToName : praiseSearch}
                              onChange={(e) => {
                                setPraiseSearch(e.target.value);
                                setPraiseSearchOpen(true);
                                if (praiseToName) { setPraiseToName(""); setPraiseToId(null); }
                              }}
                              onFocus={() => setPraiseSearchOpen(true)}
                              placeholder="Search Employee"
                              className={`w-full border-b ${C.div} bg-transparent px-1 pb-2 text-[14px] ${C.t1} placeholder-[#8a96a8] focus:border-[#008CFF] focus:outline-none`}
                            />
                            {praiseToName ? (
                              <button
                                type="button"
                                onClick={() => { setPraiseToName(""); setPraiseToId(null); setPraiseSearch(""); setPraiseSearchOpen(true); }}
                                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full text-[#5c6b80] hover:bg-[#f5f9ff]"
                                aria-label="Clear"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                            {praiseSearchOpen && praiseMatches.length > 0 ? (
                              <div className="absolute left-0 top-full z-30 mt-1 w-full rounded-[6px] border border-[#dbe4ed] bg-white shadow-lg overflow-hidden">
                                <ul className="max-h-[220px] overflow-y-auto">
                                  {praiseMatches.map((u: any) => (
                                    <li key={u.id}>
                                      <button
                                        type="button"
                                        onClick={() => { setPraiseToId(u.id); setPraiseToName(u.name); setPraiseSearchOpen(false); setPraiseSearch(""); }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-[#f5f9ff]"
                                      >
                                        {u.profilePictureUrl ? (
                                          <img src={u.profilePictureUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                                        ) : (
                                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e8f1fc] text-[10px] font-semibold text-[#0f4e93]">
                                            {(u.name || "?").trim().slice(0, 1).toUpperCase()}
                                          </span>
                                        )}
                                        <span className="truncate font-medium">{u.name}</span>
                                        {u.employeeProfile?.designation ? (
                                          <span className="ml-auto truncate text-[11px] text-slate-400">
                                            {u.employeeProfile.designation}
                                          </span>
                                        ) : null}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </div>

                          {/* Reason */}
                          <textarea
                            value={postText}
                            onChange={(e) => setPost(e.target.value)}
                            placeholder="What did the employee do to deserve the praise"
                            rows={3}
                            className={`w-full resize-none bg-transparent text-[13px] ${C.t2} placeholder-[#8a96a8] focus:outline-none`}
                          />

                          {/* Select badge */}
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => setPraiseBadgeOpen(v => !v)}
                              className="flex h-14 w-14 items-center justify-center rounded-md border border-[#dbe4ed] bg-[#f7f9fc] hover:bg-[#eef4fb]"
                              title={activeBadge?.label || "Pick a badge"}
                            >
                              {activeBadge ? (
                                <BadgeMedal b={activeBadge} size={36} />
                              ) : (
                                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#cbd5e1]">
                                  <Award className="h-4 w-4 text-white" />
                                </span>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => setPraiseBadgeOpen(v => !v)}
                              className="text-[13px] font-semibold text-[#008CFF] hover:text-[#0070d4]"
                            >
                              {activeBadge ? `Change badge — ${activeBadge.label}` : "Select badge"}
                            </button>
                          </div>
                          {praiseBadgeOpen ? (
                            <div className="rounded-[6px] border border-[#dbe4ed] bg-white p-4">
                              <div className="grid grid-cols-4 gap-y-5 gap-x-3">
                                {PRAISE_BADGES.map((b) => {
                                  const selected = praiseBadge === b.id;
                                  return (
                                    <button
                                      key={b.id}
                                      type="button"
                                      onClick={() => { setPraiseBadge(b.id); setPraiseBadgeOpen(false); }}
                                      title={b.label}
                                      className={`flex flex-col items-center gap-1.5 rounded-md p-2 transition ${
                                        selected ? "bg-[#e8f1fc] ring-1 ring-[#0f4e93]" : "hover:bg-[#f5f9ff]"
                                      }`}
                                    >
                                      <BadgeMedal b={b} size={50} />
                                      <span className="mt-1 max-w-[88px] text-center text-[10.5px] font-medium leading-tight text-slate-700">
                                        {b.label}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}

                          {/* Project (optional) */}
                          <div className="space-y-1.5">
                            <p className={`text-[12.5px] font-semibold ${C.t2}`}>Projects (optional)</p>
                            <input
                              type="text"
                              value={praiseProject}
                              onChange={(e) => setPraiseProject(e.target.value)}
                              placeholder="Select project"
                              className={`w-full rounded-[4px] border ${C.div} bg-transparent px-3 py-2 text-[13px] ${C.t2} placeholder-[#8a96a8] focus:border-[#008CFF] focus:outline-none focus:ring-1 focus:ring-[#008CFF]/20`}
                            />
                          </div>

                          {/* Add Attachment */}
                          <div className="space-y-2">
                            <label className="flex w-fit cursor-pointer items-center gap-2 text-[13px] font-semibold text-[#008CFF] hover:text-[#0070d4]">
                              <Paperclip className="h-4 w-4" />
                              Add Attachment
                              <span title="Max 5 files, 5 MB each" className="text-[#8a96a8]">
                                <Info className="h-3.5 w-3.5" />
                              </span>
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                className="hidden"
                                onChange={(e) => {
                                  const files = Array.from(e.target.files ?? []);
                                  files.forEach(addPraiseFile);
                                  e.currentTarget.value = "";
                                }}
                              />
                            </label>
                            <p className="text-[11.5px] text-[#8a96a8]">Max number of files allowed is 5</p>
                            {praiseFiles.length > 0 ? (
                              <div className="flex flex-wrap gap-2 pt-1">
                                {praiseFiles.map((f, i) => (
                                  <div key={i} className="relative">
                                    <img src={f.data} alt={f.name} className="h-16 w-16 rounded-[4px] border border-[#dbe4ed] object-cover" />
                                    <button
                                      type="button"
                                      onClick={() => setPraiseFiles(prev => prev.filter((_, idx) => idx !== i))}
                                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#1f2937] text-white shadow-md hover:bg-[#0f172a]"
                                      aria-label="Remove"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : feedTab === "poll" ? (
                        /* ── Poll form ─────────────────────────────────── */
                        <div className="space-y-4">
                          <input
                            type="text"
                            value={pollQuestion}
                            onChange={(e) => setPollQuestion(e.target.value)}
                            placeholder="What this poll is about"
                            className={`w-full border-b ${C.div} bg-transparent px-1 pb-2 text-[14px] ${C.t1} placeholder-[#8a96a8] focus:border-[#008CFF] focus:outline-none`}
                          />

                          <div className="space-y-2">
                            {pollOptions.map((opt, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={opt}
                                  onChange={(e) => {
                                    setPollOptions(prev => prev.map((o, idx) => idx === i ? e.target.value : o));
                                  }}
                                  placeholder="Add option here"
                                  className={`flex-1 rounded-[4px] border ${C.div} bg-transparent px-3 py-2 text-[13px] ${C.t2} placeholder-[#8a96a8] focus:border-[#008CFF] focus:outline-none focus:ring-1 focus:ring-[#008CFF]/20`}
                                />
                                <button
                                  type="button"
                                  onClick={() => setPollOptions(prev => prev.filter((_, idx) => idx !== i))}
                                  disabled={pollOptions.length <= 2}
                                  title={pollOptions.length <= 2 ? "Need at least 2 options" : "Remove this option"}
                                  className="flex h-8 w-8 items-center justify-center rounded text-[#5c6b80] transition hover:bg-[#fef2f2] hover:text-[#dc2626] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#5c6b80]"
                                  aria-label="Remove option"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            ))}
                          </div>

                          <button
                            type="button"
                            onClick={() => setPollOptions(prev => [...prev, ""])}
                            className="text-[12.5px] font-semibold text-[#008CFF] hover:text-[#0070d4]"
                          >
                            + Add Option
                          </button>

                          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-1">
                            <div className="flex items-center gap-2">
                              <span className={`text-[12.5px] ${C.t3}`}>Poll Expires on</span>
                              <input
                                type="date"
                                value={pollExpires}
                                onChange={(e) => setPollExpires(e.target.value)}
                                className={`h-8 rounded-[4px] border ${C.div} bg-transparent px-2 text-[12.5px] ${C.t2} focus:outline-none focus:ring-1 focus:ring-[#008CFF]/30`}
                              />
                            </div>
                            <label className={`flex items-center gap-2 text-[12.5px] ${C.t2} cursor-pointer`}>
                              <input
                                type="checkbox"
                                checked={pollNotify}
                                onChange={(e) => setPollNotify(e.target.checked)}
                                className="h-4 w-4 accent-[#008CFF]"
                              />
                              Notify employees
                            </label>
                            <label className={`flex items-center gap-2 text-[12.5px] ${C.t2} cursor-pointer`}>
                              <input
                                type="checkbox"
                                checked={pollAnon}
                                onChange={(e) => setPollAnon(e.target.checked)}
                                className="h-4 w-4 accent-[#008CFF]"
                              />
                              Anonymous poll
                            </label>
                          </div>
                        </div>
                      ) : (
                      <>
                      {/* Textarea */}
                      <div className="relative">
                        <textarea
                          ref={composerTextareaRef}
                          value={postText}
                          onChange={(e) => handleComposerChange(e.target.value)}
                          onKeyUp={(e) => {
                            // Re-evaluate mention state on cursor moves so arrow-keys / mouse-clicks
                            // correctly close the picker when the cursor leaves an @-token.
                            if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
                              handleComposerChange(postText);
                            }
                            if (e.key === "Escape") setMentionQuery(null);
                          }}
                          placeholder="Write your post here and mention your peers"
                          rows={5}
                          className={`w-full resize-none bg-transparent text-[13.5px] ${C.t2} placeholder-[#8a96a8] focus:outline-none`}
                          style={{ caretColor: "#008CFF" }}
                        />

                        {mentionQuery !== null && mentionMatches.length > 0 ? (
                          <div className="absolute left-0 top-full z-30 mt-1 w-[260px] rounded-[6px] border border-[#dbe4ed] bg-white shadow-lg overflow-hidden">
                            <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 border-b border-[#eef2f6]">
                              Tag a teammate
                            </p>
                            <ul className="max-h-[220px] overflow-y-auto">
                              {mentionMatches.map((u: any) => (
                                <li key={u.id}>
                                  <button
                                    type="button"
                                    onClick={() => insertMention(u.name)}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-[#f5f9ff]"
                                  >
                                    {u.profilePictureUrl ? (
                                      <img src={u.profilePictureUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                                    ) : (
                                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e8f1fc] text-[10px] font-semibold text-[#0f4e93]">
                                        {(u.name || "?").trim().slice(0, 1).toUpperCase()}
                                      </span>
                                    )}
                                    <span className="truncate font-medium">{u.name}</span>
                                    {u.employeeProfile?.designation ? (
                                      <span className="ml-auto truncate text-[11px] text-slate-400">
                                        {u.employeeProfile.designation}
                                      </span>
                                    ) : null}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>

                      {/* Image preview */}
                      {postMedia ? (
                        <div className="relative mt-2 inline-block">
                          <img src={postMedia} alt="attachment" className="max-h-40 rounded-[6px] border border-[#dbe4ed]" />
                          <button
                            type="button"
                            onClick={() => setPostMedia(null)}
                            className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#1f2937] text-white shadow-md hover:bg-[#0f172a]"
                            aria-label="Remove image"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : null}

                      {/* Action row — @ mention, photo, emoji */}
                      <div className="mt-3 flex items-center gap-2 relative">
                        <button
                          type="button"
                          onClick={() => {
                            insertAtCursor("@");
                            // Open the picker with an empty filter so the
                            // user sees the full directory immediately.
                            setMentionQuery("");
                          }}
                          title="Mention someone"
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-[#dbe4ed] text-[#5c6b80] transition hover:bg-[#f5f9ff] hover:text-[#008CFF]"
                        >
                          <AtSign className="h-4 w-4" />
                        </button>
                        <label
                          title="Attach photo"
                          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-[#dbe4ed] text-[#5c6b80] transition hover:bg-[#f5f9ff] hover:text-[#008CFF]"
                        >
                          <ImageIcon className="h-4 w-4" />
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => { handlePickImage(e.target.files?.[0] ?? null); e.currentTarget.value = ""; }}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => setEmojiOpen(v => !v)}
                          title="Insert emoji"
                          className={`flex h-8 w-8 items-center justify-center rounded-full border border-[#dbe4ed] transition ${
                            emojiOpen ? "bg-[#f5f9ff] text-[#008CFF]" : "text-[#5c6b80] hover:bg-[#f5f9ff] hover:text-[#008CFF]"
                          }`}
                        >
                          <Smile className="h-4 w-4" />
                        </button>

                        {emojiOpen ? (
                          <div className="absolute left-0 top-10 z-20 flex flex-wrap gap-1 rounded-[6px] border border-[#dbe4ed] bg-white p-2 shadow-lg w-[260px]">
                            {["😀","😂","😍","🥳","🙏","👏","👍","🔥","💯","🎉","🚀","💡","✅","❤️","☕","☀️","🌟","🤝","💪","🙌","😊","😎","✨","📌","📷","🎯","💼","📝","🎂","🏆"].map((e) => (
                              <button
                                key={e}
                                type="button"
                                onClick={() => { insertAtCursor(e); setEmojiOpen(false); }}
                                className="flex h-7 w-7 items-center justify-center rounded hover:bg-[#f5f9ff] text-[16px]"
                              >
                                {e}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      </>
                      )}

                      {/* Bottom row — Posting to + Cancel + Post */}
                      <div className={`mt-4 flex items-center justify-between border-t ${C.div} pt-3`}>
                        <div className="flex items-center gap-2 text-[12px]">
                          <span className={C.t3}>Posting to</span>
                          <select
                            value={postScope}
                            onChange={(e) => setPostScope(e.target.value as "org"|"team")}
                            className={`h-7 rounded-[4px] border ${C.div} bg-white px-2 text-[12px] ${C.t2} focus:outline-none focus:ring-1 focus:ring-[#008CFF]`}
                          >
                            <option value="org">Organization</option>
                            <option value="team">{teamLabel}</option>
                          </select>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={resetComposer}
                            className={`h-8 rounded-[4px] border ${C.div} px-4 text-[12px] font-medium ${C.t2} hover:bg-[#f7f9fc]`}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={submitPost}
                            disabled={
                              submittingPost ||
                              (feedTab === "poll"
                                ? !pollQuestion.trim() || pollOptions.filter(o => o.trim()).length < 2
                                : feedTab === "praise"
                                ? !praiseToId || !postText.trim()
                                : !postText.trim() && !postMedia)
                            }
                            className="h-8 rounded-[4px] bg-[#008CFF] px-5 text-[12px] font-semibold text-white transition hover:bg-[#0070d4] disabled:opacity-60"
                          >
                            {submittingPost ? "Posting..." : feedTab === "praise" ? "Send Praise" : "Post"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
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
