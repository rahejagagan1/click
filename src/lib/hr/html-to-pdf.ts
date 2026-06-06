// HTML → PDF via LibreOffice headless. Reuses the same `soffice`
// binary the docx-to-pdf pipeline already depends on, so the VPS
// doesn't need a new runtime.
//
// Writes the HTML to a temp file, runs
//   soffice --headless --convert-to pdf --outdir <tmp> <input.html>
// reads the resulting PDF back, and cleans up.
//
// On dev Windows machines without LibreOffice the function throws
// — the calling route catches and falls back to streaming the
// styled HTML so HR can browser-print.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";

export async function htmlToPdf(html: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "nb-letter-"));
  const htmlPath = join(dir, "letter.html");
  const pdfPath  = join(dir, "letter.pdf");
  await writeFile(htmlPath, html, "utf8");
  try {
    await runSoffice(["--headless", "--convert-to", "pdf", "--outdir", dir, htmlPath]);
    return await readFile(pdfPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function runSoffice(args: string[]): Promise<void> {
  // Standard binary name on Linux + macOS. On Windows the
  // LibreOffice installer puts soffice.exe in PATH or
  // C:\Program Files\LibreOffice\program\.
  const candidates = platform() === "win32"
    ? ["soffice", "C:\\Program Files\\LibreOffice\\program\\soffice.exe"]
    : ["soffice", "libreoffice"];

  return new Promise<void>((resolve, reject) => {
    let lastErr: any = null;
    const tryNext = (idx: number) => {
      if (idx >= candidates.length) {
        return reject(lastErr ?? new Error("soffice / libreoffice not found"));
      }
      const proc = spawn(candidates[idx], args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      proc.stderr?.on("data", (d) => { stderr += d.toString(); });
      proc.on("error", (e) => {
        lastErr = e;
        tryNext(idx + 1);
      });
      proc.on("close", (code) => {
        if (code === 0) return resolve();
        reject(new Error(`soffice exited ${code}: ${stderr || "(no stderr)"}`));
      });
    };
    tryNext(0);
  });
}
