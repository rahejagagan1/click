"use client";

// "Life at NB Media" / "Life at YT Labs" section on the careers page.
// Big bold headline (brand accent colour), team blurb, Instagram CTA,
// horizontal carousel of vertical reel cards with chevron navigation —
// modelled after the Praper reference the user shared.
//
// Each reel is a tap-out card that opens the Instagram reel in a new
// tab. Poster image goes inside /public/reels/ — fallback is a
// brand-coloured gradient with the reel number.

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play, X as XIcon } from "lucide-react";
import Reveal     from "./[slug]/Reveal";
import WordReveal from "./[slug]/WordReveal";
import CharReveal from "./CharReveal";

export type Reel = {
  /** Instagram reel URL — e.g. https://www.instagram.com/reel/XXXXX/ */
  url: string;
  /** Self-hosted MP4 path — drop the file into /public/reels/ and
   *  reference it here (e.g. "/reels/DOvs34SEgOF.mp4"). When set, the
   *  card plays the video INLINE (Praper-style, no IG chrome). When
   *  absent, the card falls back to opening Instagram's embed iframe
   *  on click (which carries IG's player + "View on Instagram" footer). */
  video?: string;
  /** Poster image — used as the still preview before the user clicks
   *  play. Drop into /public/reels/<name>.jpg. Optional but recommended
   *  when using `video` so the card isn't a gradient placeholder. */
  poster?: string;
  /** Optional caption to display at bottom of card. */
  caption?: string;
};

type Props = {
  brandLabel:    string;            // "NB Media" / "YT Labs"
  accent:        string;            // hex colour — used for the IG CTA + handle line
  /** When provided, the brand name in the heading renders with this
   *  gradient (the NB Media warm logo gradient is the canonical use).
   *  Falls back to solid `accent` colour when undefined. */
  brandGradient?: string;
  blurb:         string;            // 2-3 sentence description
  igHandle:      string;            // "@nbmediaproductions"
  igUrl:         string;            // https://www.instagram.com/...
  reels:         Reel[];
};

export default function LifeAtBrand({ brandLabel, accent, brandGradient, blurb, igHandle, igUrl, reels }: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const scroll = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    // Scroll by ~one card width (account for gap). Selector matches
    // both <a> and <button> reel cards via the data attribute.
    const cardWidth = el.querySelector<HTMLElement>("[data-reel]")?.offsetWidth ?? 220;
    el.scrollBy({ left: dir * (cardWidth + 16), behavior: "smooth" });
  };

  if (!reels || reels.length === 0) return null;

  return (
    <section className="relative border-b border-slate-100 overflow-hidden">
      {/* Two-layer gradient backdrop + corner blur blobs — matches the
          careers hero so the page reads as one continuous visual
          system. The user-shared reference template had this exact
          treatment. */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-blue-50/60 via-white to-[#e2e8f0]" />
      <div aria-hidden="true" className="absolute -top-32 -left-32 -z-10 h-[460px] w-[460px] rounded-full blur-[110px]" style={{ background: `${accent}26` }} />
      <div aria-hidden="true" className="absolute -top-20 -right-24 -z-10 h-[360px] w-[360px] rounded-full bg-[#a855f7]/[0.07] blur-[100px] sm:hidden" />

      {/* (Floating brand badges moved back to the hero section now
          that the hero is first — keep this surface clean for the
          team-vibe content.) */}

      <div className="relative w-full max-w-6xl mx-auto px-4 sm:px-8 py-14 sm:py-20">
        {/* Headline + blurb + Instagram CTA — centred */}
        <div className="text-center max-w-3xl mx-auto">
          {/* Heading — "Life at" animates word-by-word, then the
              brand name fades + slides up after the words land.
              Both parts sit on the SAME line — `whitespace-nowrap`
              + inline-block Reveal stop the brand span from
              breaking onto a second row. */}
          <h2 className="text-[40px] sm:text-[56px] font-black tracking-tight leading-[1.05] text-slate-900 whitespace-nowrap">
            <CharReveal text="Life at" staggerMs={55} baseDelayMs={100} />
            {" "}
            <Reveal direction="up" delay={400} className="inline-block align-baseline">
              {brandGradient ? (
                <span
                  style={{
                    background: brandGradient,
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    color: "transparent",
                    display: "inline-block",
                  }}
                >
                  {brandLabel}
                </span>
              ) : (
                <span style={{ color: accent }}>{brandLabel}</span>
              )}
            </Reveal>
          </h2>
          <p className="mt-5 text-[15px] sm:text-[16.5px] text-slate-600 leading-relaxed">
            <WordReveal text={blurb} staggerMs={13} baseDelayMs={650} />
          </p>

          {/* IG CTA — white pill with gradient-clipped text + icon
              so the button itself wears the brand's logo colours.
              Subtle warm-tinted ring + shadow give it weight without
              competing with the heading. */}
          <Reveal direction="up" delay={800}>
          <a
            href={igUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-7 inline-flex items-center gap-2.5 h-12 px-5 sm:px-6 rounded-full font-semibold text-[14.5px] bg-white shadow-[0_4px_18px_-4px_rgba(249,115,22,0.35)] hover:shadow-[0_6px_24px_-4px_rgba(249,115,22,0.5)] ring-1 ring-orange-200/70 hover:ring-orange-300 transition-all hover:-translate-y-0.5"
          >
            <InstagramGlyph gradient={brandGradient} accent={accent} />
            {brandGradient ? (
              <span
                style={{
                  backgroundImage: brandGradient,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  color: "transparent",
                  display: "inline-block",
                }}
              >
                Team {brandLabel} on Instagram
              </span>
            ) : (
              <span style={{ color: accent }}>Team {brandLabel} on Instagram</span>
            )}
          </a>
          </Reveal>
        </div>

        {/* Carousel — no outer Reveal wrapper: each ReelCard self-
            animates via ReelEntrance (staggered rise+scale), so an
            outer fade would just hide the stagger underneath. */}
        <div className="relative mt-12">
          {/* Prev */}
          <button
            type="button"
            onClick={() => scroll(-1)}
            aria-label="Previous reels"
            className="hidden sm:inline-flex absolute left-0 top-1/2 -translate-y-1/2 z-10 h-11 w-11 items-center justify-center rounded-full bg-white shadow-md ring-1 ring-slate-200 text-slate-500 hover:text-slate-900 hover:shadow-lg transition-all -translate-x-1/2"
          >
            <ChevronLeft size={20} />
          </button>

          {/* Track */}
          <div
            ref={scrollerRef}
            className="flex gap-4 overflow-x-auto scroll-smooth snap-x snap-mandatory pb-4 px-1 -mx-1
                       [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {reels.map((r, i) => (
              <ReelEntrance key={r.url + i} index={i}>
                <ReelCard reel={r} index={i} accent={accent} />
              </ReelEntrance>
            ))}
          </div>

          {/* Next */}
          <button
            type="button"
            onClick={() => scroll(1)}
            aria-label="Next reels"
            className="hidden sm:inline-flex absolute right-0 top-1/2 -translate-y-1/2 z-10 h-11 w-11 items-center justify-center rounded-full bg-white shadow-md ring-1 ring-slate-200 text-slate-500 hover:text-slate-900 hover:shadow-lg transition-all translate-x-1/2"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        {/* Closing tagline — section's emotional payoff line, sits
            below the handle with a hairline divider above for
            editorial polish. */}
        <Reveal direction="up" delay={1400}>
          <div className="mt-12 sm:mt-16 text-center">
            <div className="mx-auto mb-6 h-px w-16 bg-slate-200" />
            <p className="text-[26px] sm:text-[40px] font-bold text-slate-900 tracking-tight leading-[1.2] max-w-4xl mx-auto">
              More Than a Workplace.{" "}
              <span
                style={brandGradient ? {
                  background: brandGradient,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  color: "transparent",
                  display: "inline",
                } : { color: accent }}
              >
                A Team That Creates Together.
              </span>
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/** Inline Instagram glyph — lucide-react dropped brand icons in
 *  v0.475+, and we already use the inline-SVG pattern elsewhere.
 *  When `gradient` is passed, the strokes are painted with an
 *  SVG linear-gradient that matches the button's text gradient. */
function InstagramGlyph({ gradient, accent }: { gradient?: string; accent?: string }) {
  // Two warm stops sampled from the NB Media logo gradient. Used
  // when a brandGradient is supplied; otherwise fall back to a
  // single solid accent stroke.
  const id = "ig-grad-warm";
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {gradient && (
        <defs>
          <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#ef4444" />
            <stop offset="50%"  stopColor="#f97316" />
            <stop offset="100%" stopColor="#fbbf24" />
          </linearGradient>
        </defs>
      )}
      <g stroke={gradient ? `url(#${id})` : (accent ?? "currentColor")}>
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
      </g>
    </svg>
  );
}

/** Pull the reel ID out of an Instagram URL.
 *  https://www.instagram.com/reel/DOvs34SEgOF/?utm_source=…  →  "DOvs34SEgOF"
 *  Returns null if the URL isn't a /reel/ link (e.g. it points to a
 *  profile page) — caller falls back to opening in a new tab. */
function getReelId(url: string): string | null {
  const m = url.match(/\/reel\/([^/?#]+)/);
  return m ? m[1] : null;
}

// Staggered scroll-entrance wrapper for each reel card. The card
// rises + scales in as the carousel comes into view, one after
// another (index-based delay). Kept SEPARATE from ReelCard so its
// entrance transform doesn't fight the card's hover-lift transform.
// This wrapper is the flex item (shrink-0 snap-start + width); the
// card inside fills it (w-full).
function ReelEntrance({ index, children }: { index: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => { for (const e of entries) if (e.isIntersecting) setInView(true); },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="shrink-0 snap-start w-[200px] sm:w-[220px]"
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0) scale(1)" : "translateY(34px) scale(0.94)",
        transition: "opacity 600ms cubic-bezier(0.2,0.7,0.2,1), transform 720ms cubic-bezier(0.2,0.7,0.2,1)",
        transitionDelay: `${index * 110}ms`,
        willChange: inView ? "auto" : "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}

function ReelCard({ reel, index, accent }: { reel: Reel; index: number; accent: string }) {
  // playing=true swaps the gradient/play-button for the actual player.
  // Lazy-mount means we don't hammer the page with media on load.
  const [playing, setPlaying] = useState(false);
  // videoError=true if the self-hosted MP4 fails to load — flips back
  // to the IG iframe path automatically (graceful degradation while
  // posters are being uploaded).
  const [videoError, setVideoError] = useState(false);
  const reelId = getReelId(reel.url);
  const canEmbed = !!reelId;
  const useSelfHosted = !!reel.video && !videoError;

  // Fallback gradient — gives each card a slightly different angle so
  // a series of "no poster" reels doesn't look like 5 identical cards.
  const fallbackAngle = (index * 47) % 360;
  const fallbackStyle = {
    background: `linear-gradient(${fallbackAngle}deg, ${accent}DD, ${accent}66 60%, ${accent}33)`,
  };

  // PLAYING STATE — clean inline player. Tries the self-hosted MP4
  // FIRST (Praper-style), and only falls back to Instagram's branded
  // /embed/ iframe when no MP4 is configured (or it failed to load).
  if (playing && useSelfHosted) {
    return (
      <div
        data-reel
        className="relative w-full aspect-[9/16] rounded-2xl overflow-hidden ring-1 ring-slate-200 shadow-xl bg-black"
      >
        <video
          // key forces React to remount the <video> element if the
          // src changes — guarantees a fresh load attempt and stops
          // stale Webkit caches from blocking a retry.
          key={reel.video}
          src={reel.video}
          poster={reel.poster}
          className="absolute inset-0 w-full h-full object-cover"
          // muted+autoPlay is the only combo Chrome/Safari permit on
          // page load. Sound stays opt-in via the controls toolbar.
          muted
          autoPlay
          controls
          playsInline
          loop
          preload="metadata"
          onError={() => setVideoError(true)}
        />
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setPlaying(false); }}
          aria-label="Close reel"
          className="absolute top-2 right-2 z-10 h-7 w-7 inline-flex items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-md hover:bg-white hover:scale-110 transition-all"
        >
          <XIcon size={14} strokeWidth={2.4} />
        </button>
      </div>
    );
  }

  if (playing && canEmbed) {
    return (
      <div
        data-reel
        className="relative w-full aspect-[9/16] rounded-2xl overflow-hidden ring-1 ring-slate-200 shadow-xl bg-black"
      >
        <iframe
          src={`https://www.instagram.com/reel/${reelId}/embed`}
          className="absolute inset-0 w-full h-full"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          loading="lazy"
          scrolling="no"
          title={`Instagram reel ${reelId}`}
        />
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setPlaying(false); }}
          aria-label="Close reel"
          className="absolute top-2 right-2 z-10 h-7 w-7 inline-flex items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-md hover:bg-white hover:scale-110 transition-all"
        >
          <XIcon size={14} strokeWidth={2.4} />
        </button>
      </div>
    );
  }

  // IDLE STATE — gradient placeholder + play button. Clicking
  // EITHER triggers the embed swap (if we have an ID) OR opens
  // Instagram in a new tab (defensive fallback).
  return (
    <button
      type="button"
      data-reel
      onClick={() => {
        // Reset videoError so a previously-failed retry can attempt
        // the self-hosted MP4 again (handy after a hot-reload or
        // when the user hard-refreshes after a 404 was cached).
        setVideoError(false);
        if (canEmbed || reel.video) setPlaying(true);
        else window.open(reel.url, "_blank", "noopener,noreferrer");
      }}
      className="group relative w-full aspect-[9/16] rounded-2xl overflow-hidden ring-1 ring-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all bg-slate-100 cursor-pointer text-left"
      aria-label={`Play reel ${index + 1}`}
    >
      {reel.poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={reel.poster}
          alt={`Reel ${index + 1}`}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0" style={fallbackStyle} />
      )}

      {/* Soft dark overlay for the play icon legibility */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/0 to-black/0" />

      {/* Play icon — centred, with a gently pulsing ring that
          radiates outward (draws the eye, signals "tap to play").
          The ring sits behind the button and loops via animate-ping;
          the button itself pops on hover. */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="relative inline-flex items-center justify-center h-14 w-14">
          <span className="absolute inline-flex h-full w-full rounded-full bg-white/60 opacity-75 animate-ping motion-reduce:hidden" style={{ animationDuration: "2.2s" }} />
          <span className="relative inline-flex items-center justify-center h-14 w-14 rounded-full bg-white/95 shadow-lg backdrop-blur-sm group-hover:scale-110 transition-transform">
            <Play size={22} className="text-slate-900 ml-1" fill="currentColor" />
          </span>
        </span>
      </div>

      {/* Caption pinned to bottom (optional) */}
      {reel.caption && (
        <div className="absolute bottom-0 left-0 right-0 px-3 py-2.5 text-[11.5px] font-semibold text-white leading-tight bg-gradient-to-t from-black/70 to-transparent">
          {reel.caption}
        </div>
      )}
    </button>
  );
}
