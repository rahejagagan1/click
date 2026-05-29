"use client";

// JobShareDialog — opens from the Jobs tab on a published job. Three
// things HR needs to do once a job goes live:
//   1. Copy the public link to share manually (WhatsApp, Slack, etc.)
//   2. Get share-target URLs for LinkedIn / Twitter / WhatsApp / Email
//      — these are just `intent` URLs, no API integration needed.
//   3. Get the iframe / JSON embed snippet for the company website's
//      careers page.
//
// Portaled to document.body so it escapes any parent clipping (see
// the overlays memory) — sibling dropdowns in the Jobs table won't
// crop the modal.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
// `Linkedin` / `Twitter` aren't exported by our installed lucide-react
// build (verified by tsc) — use Share2 + MessageCircle / Send as
// stand-in icons for those share targets.
import { Copy, Check, X, ExternalLink, Mail, MessageCircle, Code2, Share2, Send } from "lucide-react";

export default function JobShareDialog({
  job,
  baseUrl,
  onClose,
}: {
  job: { id: number; title: string; slug: string | null; brand: string | null };
  baseUrl: string;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  useEffect(() => { setMounted(true); }, []);

  // Esc closes the dialog — small ergonomic touch HR will hit
  // instinctively after copying.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  const publicUrl  = job.slug ? `${baseUrl}/jobs/${job.slug}` : "";
  const careersUrl = `${baseUrl}/jobs${job.brand ? `?brand=${job.brand}` : ""}`;
  const jsonUrl    = `${baseUrl}/api/public/jobs${job.brand ? `?brand=${job.brand}` : ""}`;
  const iframeSnippet = `<iframe src="${careersUrl}" width="100%" height="900" frameborder="0" style="border:0;" loading="lazy"></iframe>`;

  const shareText = `We're hiring — ${job.title}. Apply here:`;
  const shareTargets = publicUrl ? [
    { key: "linkedin", label: "LinkedIn", icon: Share2,          href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(publicUrl)}` },
    { key: "twitter",  label: "Twitter",  icon: Send,            href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(publicUrl)}` },
    { key: "whatsapp", label: "WhatsApp", icon: MessageCircle,   href: `https://wa.me/?text=${encodeURIComponent(`${shareText} ${publicUrl}`)}` },
    { key: "email",    label: "Email",    icon: Mail,            href: `mailto:?subject=${encodeURIComponent(`We're hiring — ${job.title}`)}&body=${encodeURIComponent(`Hi,\n\n${shareText}\n\n${publicUrl}`)}` },
  ] : [];

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1800);
    } catch {
      // Old browsers — fall back to the legacy textarea trick.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1800);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-800">Share &amp; embed — {job.title}</h3>
            <p className="text-[11.5px] text-slate-500 mt-0.5">Use these snippets on your company website or share the link directly.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Public link */}
          {publicUrl ? (
            <Section title="Public job page" hint="Send this URL to anyone — opens the role detail with an Apply button.">
              <CopyRow value={publicUrl} copyKey="public" copiedKey={copiedKey} onCopy={copy} />
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-2 text-[11.5px] font-semibold text-[#3b82f6] hover:underline"
              ><ExternalLink size={12} /> Preview public page</a>
            </Section>
          ) : (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-[12px] text-amber-800">
              This job doesn't have a public slug yet. Publishing it will generate one automatically.
            </div>
          )}

          {/* Share targets */}
          {shareTargets.length > 0 && (
            <Section title="Share on" hint="Opens each platform's share dialog with the job pre-filled — no API integration required.">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {shareTargets.map((t) => {
                  const Icon = t.icon;
                  return (
                    <a
                      key={t.key}
                      href={t.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 h-10 rounded-lg border border-slate-200 text-[12px] font-semibold text-slate-700 hover:border-[#3b82f6] hover:text-[#3b82f6] transition-colors"
                    >
                      <Icon size={14} /> {t.label}
                    </a>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Careers-page link */}
          <Section title="Careers index" hint="Use this URL as your “View open roles” link on the marketing site.">
            <CopyRow value={careersUrl} copyKey="careers" copiedKey={copiedKey} onCopy={copy} />
          </Section>

          {/* Embed */}
          <Section title="Embed on your website" hint="Paste this iframe wherever your career page should display the openings.">
            <div className="relative">
              <pre className="bg-slate-900 text-slate-100 rounded-lg p-3 pr-12 text-[11px] leading-relaxed overflow-x-auto font-mono"><code>{iframeSnippet}</code></pre>
              <button
                onClick={() => copy(iframeSnippet, "iframe")}
                className="absolute top-2 right-2 h-7 px-2 rounded-md bg-white/10 hover:bg-white/20 text-white text-[10.5px] font-semibold inline-flex items-center gap-1"
              >
                {copiedKey === "iframe" ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
              </button>
            </div>
          </Section>

          {/* JSON */}
          <Section title="JSON feed (developer)" hint="Fetch published jobs cross-origin. Returns brand-filtered when ?brand=… is set.">
            <CopyRow value={jsonUrl} copyKey="json" copiedKey={copiedKey} onCopy={copy} mono />
            <p className="text-[10.5px] text-slate-400 mt-2 flex items-start gap-1.5">
              <Code2 size={11} className="mt-0.5 flex-shrink-0" />
              Returns <span className="font-mono">{`{ jobs: [{ id, title, slug, … }] }`}</span> with CORS enabled.
            </p>
          </Section>
        </div>

        <div className="border-t border-slate-100 px-6 py-3 flex items-center justify-end">
          <button
            onClick={onClose}
            className="h-9 px-5 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[12.5px] font-semibold"
          >Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-[11.5px] font-bold uppercase tracking-wider text-slate-500">{title}</p>
      <p className="text-[11.5px] text-slate-500 mt-0.5 mb-2">{hint}</p>
      {children}
    </section>
  );
}

function CopyRow({
  value, copyKey, copiedKey, onCopy, mono,
}: {
  value: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (v: string, k: string) => void;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={value}
        onClick={(e) => (e.target as HTMLInputElement).select()}
        className={`flex-1 h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-[12px] text-slate-700 ${mono ? "font-mono" : ""}`}
      />
      <button
        onClick={() => onCopy(value, copyKey)}
        className="h-9 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11.5px] font-semibold inline-flex items-center gap-1.5"
      >
        {copiedKey === copyKey ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
      </button>
    </div>
  );
}
