// HTML → PDF via headless Chromium (puppeteer-core + system Chrome).
//
// Switched from LibreOffice → Chromium because LibreOffice's HTML
// importer mangles modern CSS (position:absolute, flex, mm widths,
// background-image positioning, display:block on inline elements).
// We hit at least four user-visible bugs with it: full-page logo
// blow-ups, duplicate letterheads, signature stuck inline with
// "Regards,", and giant native-size cursive in the PDF.
//
// Chromium IS the same engine that renders the in-app iframe
// preview, so PDF output is guaranteed to match what HR sees on
// screen byte-for-byte. We use puppeteer-core (no bundled
// chromium download — looks up system Chrome / Chromium /
// chromium-browser at runtime).

import puppeteer, { type Browser, type LaunchOptions } from "puppeteer-core";
import { existsSync } from "node:fs";
import { platform } from "node:os";

// Cache the launched browser across requests so we don't pay
// startup latency on every PDF generation. The browser is closed
// when the Node process exits.
let browserPromise: Promise<Browser> | null = null;

function findChromePath(): string | null {
  // Common system Chrome / Chromium locations across the
  // platforms the dashboard runs on (Ubuntu VPS, dev macOS,
  // dev Windows). The first existing path wins.
  const candidates = platform() === "win32"
    ? [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files\\Chromium\\Application\\chrome.exe",
      ]
    : platform() === "darwin"
    ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
      ]
    : [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
      ];
  for (const p of candidates) {
    try { if (existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
}

async function getBrowser(): Promise<Browser> {
  if (browserPromise) return browserPromise;
  const executablePath = findChromePath();
  if (!executablePath) {
    throw new Error(
      "No system Chrome / Chromium found. Install with:\n" +
      "  Ubuntu : sudo apt-get install -y chromium-browser\n" +
      "  macOS  : brew install --cask google-chrome\n" +
      "  Windows: install Chrome via https://www.google.com/chrome/"
    );
  }
  const opts: LaunchOptions = {
    executablePath,
    headless: true,
    args: [
      // Sandbox needs setuid bits or kernel namespaces; the VPS
      // typically runs as root so disable it to avoid the launcher
      // bailing out with EACCES.
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  };
  browserPromise = puppeteer.launch(opts);
  return browserPromise;
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // setContent waits for network idle so data: URIs / inline
    // styles all finish before we snapshot to PDF.
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      // Page whitespace applied here (deterministically, on EVERY page)
      // instead of via CSS @page margins — Chromium's @page-margin
      // handling under preferCSSPageSize was inconsistent and left
      // content flush to the edges. The wrapper's @media print drops the
      // .page card padding so these margins are the single source of
      // truth and page 1 isn't double-spaced.
      margin: { top: "16mm", right: "16mm", bottom: "18mm", left: "16mm" },
      printBackground: true,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}
