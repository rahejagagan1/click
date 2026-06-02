// OCR fallback for PDFs whose bold text is rendered as vector
// outlines rather than selectable characters (Canva / Figma /
// InDesign templates often do this). When pdfjs text extraction
// returns suspiciously little, we render each page to a PNG buffer
// and run OCR over the pixels.
//
// Pipeline (pure JS, no native binaries beyond @napi-rs/canvas
// which ships prebuilts for Windows + Linux + macOS):
//   1. pdfjs renders the page into a @napi-rs/canvas Canvas.
//   2. canvas.toBuffer("image/png") produces a PNG byte array.
//   3. tesseract.js (WASM) OCRs the PNG.
//   4. Concatenate per-page OCR text and return.
//
// Both deps ship as npm packages with prebuilt binaries / WASM —
// no apt installs required, no platform-specific build steps.
//
// First call is slow (~5-10s) because tesseract.js downloads its
// English language model on cold start. Subsequent calls reuse the
// same worker via the module-level cache.

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

type CanvasLike = {
  width: number;
  height: number;
  getContext(type: "2d"): unknown;
  toBuffer(mime: "image/png"): Buffer;
};
type CanvasFactory = {
  create(w: number, h: number): { canvas: CanvasLike; context: unknown };
  reset(c: { canvas: CanvasLike; context: unknown }, w: number, h: number): void;
  destroy(c: { canvas: CanvasLike; context: unknown }): void;
};

// Per-process cached Tesseract worker. createWorker() loads the
// English model into memory; reusing it cuts ~5s off every OCR call.
let cachedWorker: any = null;
let cachedCanvasFactory: CanvasFactory | null = null;
let depsAvailable: boolean | null = null;

/** Returns true when @napi-rs/canvas + tesseract.js are loadable.
 *  Cached after the first probe so we don't repeat dynamic imports
 *  on every candidate-GET call. */
export async function isOcrAvailable(): Promise<boolean> {
  if (depsAvailable != null) return depsAvailable;
  try {
    await import("@napi-rs/canvas");
    await import("tesseract.js");
    depsAvailable = true;
  } catch {
    depsAvailable = false;
  }
  return depsAvailable;
}

async function buildCanvasFactory(): Promise<CanvasFactory> {
  if (cachedCanvasFactory) return cachedCanvasFactory;
  const canvasMod = await import("@napi-rs/canvas") as any;
  const createCanvas: (w: number, h: number) => CanvasLike = canvasMod.createCanvas;
  // pdfjs wants a CanvasFactory with create/reset/destroy methods.
  cachedCanvasFactory = {
    create(w: number, h: number) {
      const canvas = createCanvas(Math.max(1, w), Math.max(1, h));
      const context = canvas.getContext("2d");
      return { canvas, context };
    },
    reset(c: { canvas: CanvasLike }, w: number, h: number) {
      c.canvas.width  = Math.max(1, w);
      c.canvas.height = Math.max(1, h);
    },
    destroy(c: { canvas: CanvasLike }) {
      c.canvas.width = 0;
      c.canvas.height = 0;
    },
  };
  return cachedCanvasFactory;
}

async function getOcrWorker(): Promise<any> {
  if (cachedWorker) return cachedWorker;
  const Tesseract = await import("tesseract.js") as any;
  const createWorker = Tesseract.createWorker ?? Tesseract.default?.createWorker;
  // v5+ createWorker signature: (lang, oem, options) — lang param
  // sets the language model. "eng" loads English. The worker pulls
  // its language data from the tessdata mirror on first use.
  cachedWorker = await createWorker("eng");
  return cachedWorker;
}

/** Render the PDF to PNGs (in-memory) and OCR each page; returns
 *  the concatenated text. Empty string when anything fails. */
export async function ocrPdf(pdfBytes: Buffer): Promise<string> {
  try {
    if (!(await isOcrAvailable())) return "";

    // pdfjs setup — same worker resolution as the rest of the parser
    // helpers in this codebase.
    const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      try {
        const req = createRequire(import.meta.url);
        pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
          req.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"),
        ).href;
      } catch { /* swallow */ }
    }

    const canvasFactory = await buildCanvasFactory();
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(pdfBytes),
      isEvalSupported: false,
      useSystemFonts: false,
      canvasFactory,
    }).promise;

    const worker = await getOcrWorker();
    const pages: string[] = [];

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      // 2.0 scale ≈ 200 DPI — high enough for Tesseract to read
      // typical resume body text, low enough to keep memory in check.
      const viewport = page.getViewport({ scale: 2.0 });
      const ctx = canvasFactory.create(viewport.width, viewport.height);
      try {
        await page.render({ canvasContext: ctx.context, viewport, canvasFactory }).promise;
        const png = (ctx.canvas as CanvasLike).toBuffer("image/png");
        const { data } = await worker.recognize(png);
        const t = String(data?.text ?? "").trim();
        if (t) pages.push(t);
      } catch (e: any) {
        console.error(`[ocr-pdf] page ${i} failed:`, e?.message ?? e);
      } finally {
        canvasFactory.destroy(ctx);
        page.cleanup();
      }
    }
    await doc.destroy();
    return pages.join("\n").trim();
  } catch (e: any) {
    console.error("[ocr-pdf] failed:", e?.message ?? e);
    return "";
  }
}
