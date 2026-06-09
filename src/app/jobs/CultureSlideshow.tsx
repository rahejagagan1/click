"use client";

// Culture Highlights — continuous rolling marquee. Photos slide from
// right to left at a constant pace, never stop, never reset visibly.
// The track is the photos array rendered TWICE in a row: animating
// translateX from 0% to -50% scrolls through exactly one full set,
// and because the second copy is identical and sits right after the
// first, the loop point is invisible.
//
// No chrome — no chevrons, no dots. Hover pauses the animation so
// visitors can read a caption without it sliding past.

import { useEffect, useState } from "react";

type CulturePhoto = { poster?: string; caption?: string };

// Seconds per FULL revolution through all photos. Lower = faster.
// 20s feels brisk — photos visibly moving but still readable when
// they pass through the centre. Scales naturally with photo count.
const DURATION_SECONDS = 20;

export default function CultureSlideshow({
  photos, accent,
}: { photos: CulturePhoto[]; accent: string }) {
  // Match viewport so each tile occupies a sensible width. SSR
  // default is desktop (3-up); useEffect refines after hydration.
  const [visibleCount, setVisibleCount] = useState(3);

  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth;
      setVisibleCount(w >= 1024 ? 3 : w >= 640 ? 2 : 1);
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  // Each tile is (100 / visibleCount)% of the visible track. Doubling
  // the photo array keeps the animation seamless.
  const tilePercent = 100 / visibleCount;
  const doubled = [...photos, ...photos];

  return (
    <div className="relative group/marquee overflow-hidden rounded-2xl">
      <style>{`
        @keyframes culture-roll {
          0%   { transform: translate3d(0, 0, 0); }
          100% { transform: translate3d(-50%, 0, 0); }
        }
        .culture-track {
          animation: culture-roll ${DURATION_SECONDS}s linear infinite;
          will-change: transform;
        }
        /* Pause on hover so visitors can read a caption */
        .group\\/marquee:hover .culture-track {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .culture-track { animation: none; }
        }
      `}</style>

      {/* Fade edges so photos don't pop in/out abruptly at the
          left/right boundaries — they ease in and out of view. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-16 sm:w-24 z-10"
        style={{ background: "linear-gradient(to right, rgba(255,255,255,0.85), transparent)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-16 sm:w-24 z-10"
        style={{ background: "linear-gradient(to left, rgba(255,255,255,0.85), transparent)" }}
      />

      <div className="culture-track flex">
        {doubled.map((p, i) => (
          <div
            key={i}
            className="shrink-0 px-2"
            style={{ width: `${tilePercent}%` }}
          >
            <CultureSlide
              poster={p.poster}
              caption={p.caption}
              accent={accent}
              index={i % photos.length}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function CultureSlide({
  poster, caption, accent, index,
}: { poster?: string; caption?: string; accent: string; index: number }) {
  const angle = (index * 37) % 360;
  return (
    <div className="group/tile relative aspect-[4/3] rounded-2xl overflow-hidden ring-1 ring-slate-200 bg-slate-100 shadow-sm">
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt={caption || `Culture photo ${index + 1}`}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <>
          <div
            aria-hidden
            className="absolute inset-0"
            style={{ background: `linear-gradient(${angle}deg, ${accent}33, ${accent}11 60%, #ffffff)` }}
          />
          <div className="absolute inset-0 flex items-center justify-center text-[11.5px] font-semibold text-slate-400 uppercase tracking-[0.12em]">
            Add photo
          </div>
        </>
      )}
      {caption && (
        <div className="absolute bottom-0 left-0 right-0 px-4 py-3 text-[12px] font-semibold text-white bg-gradient-to-t from-black/65 via-black/15 to-transparent">
          {caption}
        </div>
      )}
    </div>
  );
}
