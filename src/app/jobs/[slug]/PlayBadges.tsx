"use client";

// Floating social-platform badges — YouTube, Instagram, Spotify,
// Facebook. On page load they "burst" outward from the center of the
// hero to their final scattered positions, then settle into a gentle
// float-bob. Used ONLY on the careers index hero.

import { Play } from "lucide-react";

type Platform = "youtube" | "facebook" | "instagram" | "spotify";

type Badge = {
  platform: Platform;
  size:     number;
  top:      string;
  left?:    string;
  right?:   string;
  rotate:   number;
  /** Approximate offset from final position toward viewport center,
   *  expressed in vw/vh. Used as the starting point of the spread
   *  animation so badges appear to fly out from the hero centre. */
  fromX:    string;
  fromY:    string;
};

const BADGES: Badge[] = [
  { platform: "youtube",   size: 60, top: "12%", left:  "5%",  rotate: -10, fromX:  "40vw", fromY:  "30vh" },
  { platform: "instagram", size: 64, top: "18%", right: "6%",  rotate:   6, fromX: "-40vw", fromY:  "28vh" },
  { platform: "spotify",   size: 52, top: "62%", left:  "8%",  rotate:   8, fromX:  "38vw", fromY: "-22vh" },
  { platform: "facebook",  size: 48, top: "70%", right: "12%", rotate: -12, fromX: "-36vw", fromY: "-28vh" },
];

const PLATFORM: Record<Platform, { bg: string; shadow: string }> = {
  youtube: {
    bg:     "linear-gradient(180deg, #ff1f1f 0%, #d90000 100%)",
    shadow: "0 14px 30px -8px rgba(217,0,0,0.45), 0 2px 4px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.35)",
  },
  facebook: {
    bg:     "linear-gradient(180deg, #1877f2 0%, #0e5fcc 100%)",
    shadow: "0 14px 30px -8px rgba(24,119,242,0.45), 0 2px 4px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.35)",
  },
  instagram: {
    bg:     "radial-gradient(115% 115% at 25% 110%, #fdc468 0%, #f5733a 25%, #d6249f 55%, #285aeb 100%)",
    shadow: "0 14px 30px -8px rgba(214,36,159,0.45), 0 2px 4px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.4)",
  },
  spotify: {
    bg:     "linear-gradient(180deg, #1ed760 0%, #0fb84e 100%)",
    shadow: "0 14px 30px -8px rgba(30,215,96,0.45), 0 2px 4px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.35)",
  },
};

// Hand-rolled brand glyphs (lucide doesn't ship Facebook/Instagram/Spotify).
function FacebookMark({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="#ffffff" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 7h-2.5c-.5 0-.5.4-.5.7V10h3l-.4 3H13v8h-3v-8H8v-3h2V7.5C10 5 11.5 4 13.6 4H16v3z" />
    </svg>
  );
}
function InstagramMark({ size }: { size: number }) {
  const sw = Math.max(1.6, size * 0.05);
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="18" height="18" rx="5.5" stroke="#ffffff" strokeWidth={sw} />
      <circle cx="12" cy="12" r="4" stroke="#ffffff" strokeWidth={sw} />
      <circle cx="17.5" cy="6.5" r="1.1" fill="#ffffff" />
    </svg>
  );
}
function SpotifyMark({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="#000000" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.9 10.9C14.7 9 9.35 8.8 6.3 9.75c-.5.15-1-.15-1.15-.6-.15-.5.15-1 .6-1.15 3.55-1.05 9.4-.85 13.1 1.35.45.25.6.85.35 1.3-.25.35-.85.5-1.3.25z" />
      <path d="M17.8 13.7c-.25.35-.7.5-1.05.25-2.7-1.65-6.8-2.15-9.95-1.15-.4.1-.85-.1-.95-.5-.1-.4.1-.85.5-.95 3.65-1.1 8.15-.55 11.25 1.35.3.15.45.6.2 1z" />
      <path d="M16.6 16.45c-.2.3-.55.4-.85.2-2.35-1.45-5.3-1.75-8.8-.95-.35.1-.65-.15-.75-.45-.1-.35.15-.65.45-.75 3.8-.85 7.1-.5 9.7 1.1.35.15.4.55.25.85z" />
    </svg>
  );
}

export default function PlayBadges() {
  return (
    <>
      <style>{`
        /* Spread-from-centre entrance: each badge starts at its
           per-badge --from-x/--from-y (toward the hero centre) and
           animates outward to translate(0,0). After this finishes
           the float animation takes over with a matching delay. */
        @keyframes badgeSpread {
          0%   { transform: translate(var(--fx), var(--fy)) rotate(var(--rot)) scale(0.4); opacity: 0; }
          60%  { opacity: 1; }
          100% { transform: translate(0, 0) rotate(var(--rot)) scale(1); opacity: 1; }
        }
        @keyframes badgeFloat {
          0%, 100% { transform: translate3d(0, 0, 0) rotate(var(--rot)); }
          50%      { transform: translate3d(8px, -12px, 0) rotate(calc(var(--rot) + 2deg)); }
        }
        .badge {
          opacity: 0;
          animation:
            badgeSpread 1300ms cubic-bezier(0.18, 1.1, 0.32, 1) 200ms forwards,
            badgeFloat  6000ms ease-in-out 1500ms infinite;
        }
      `}</style>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        {BADGES.map((b, i) => {
          const p = PLATFORM[b.platform];
          const isYouTube = b.platform === "youtube";
          const isSpotify = b.platform === "spotify";
          const width  = isYouTube ? Math.round(b.size * 1.4) : b.size;
          const height = isYouTube ? Math.round(b.size * 0.95) : b.size;
          const iconSize = Math.round(b.size * 0.5);
          const borderRadius =
            isYouTube ? 14 :
            isSpotify ? "9999px" :
            Math.round(b.size * 0.26);
          return (
            <span
              key={i}
              className="badge absolute inline-flex items-center justify-center"
              style={{
                top:    b.top,
                left:   b.left,
                right:  b.right,
                width,
                height,
                background:    p.bg,
                boxShadow:     p.shadow,
                borderRadius,
                animationDelay: `${i * 80}ms, ${1500 + i * 80}ms`,
                ["--rot" as any]: `${b.rotate}deg`,
                ["--fx"  as any]: b.fromX,
                ["--fy"  as any]: b.fromY,
              }}
            >
              {b.platform === "youtube"   && <Play         size={iconSize} strokeWidth={0} className="fill-white" style={{ marginLeft: 2 }} />}
              {b.platform === "facebook"  && <FacebookMark  size={iconSize} />}
              {b.platform === "instagram" && <InstagramMark size={iconSize} />}
              {b.platform === "spotify"   && <SpotifyMark   size={iconSize} />}
            </span>
          );
        })}
      </div>
    </>
  );
}
