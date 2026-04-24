// Forces every `<h2 className="text-base font-bold text-white">` in the
// report pages to also carry an inline `color:#ffffff` style so global
// CSS rules can't override it back to dark on the colored section bars.
import fs from "node:fs";
import path from "node:path";

const TARGETS = [
  "src/app/dashboard/reports/[managerId]/monthly/[month]/page.tsx",
  "src/app/dashboard/reports/[managerId]/weekly/[week]/page.tsx",
];

for (const rel of TARGETS) {
  const p = path.resolve(rel);
  let src = fs.readFileSync(p, "utf8");
  const before = src;

  // Match h2 tags that have text-white but NO inline style yet, and inject one.
  // Idempotent: skips any tag that already has style={{...color...}}.
  src = src.replace(
    /<h2(\s+)className="text-base font-bold text-white"(?!\s+style=)/g,
    `<h2$1className="text-base font-bold text-white" style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff" }}`
  );

  if (src !== before) {
    fs.writeFileSync(p, src);
    const count = (before.match(/<h2\s+className="text-base font-bold text-white"(?!\s+style=)/g) || []).length;
    console.log(`  ✓ patched ${count} header(s): ${rel}`);
  } else {
    console.log(`  - no change: ${rel}`);
  }
}
