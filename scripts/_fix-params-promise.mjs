// Next.js 15 params-as-Promise codemod. Simpler 2-pass approach:
//
//   (a) `type Foo = { bar: string }` where it's used as route-handler params
//       is widened to `type Foo = Promise<{ bar: string }>`  (if not already).
//   (b) Inside each route handler body, every `parseInt(params.X)` usage gets
//       rewritten so we destructure from `await params` once at the top and
//       reuse the string locally.
//
// Idempotent — re-running on already-patched files is a no-op.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

// Auto-discover every route.ts file under /api that still accesses `params`
// synchronously (`params.KEY` — not `(await params).KEY` or destructured).
// We deliberately match a generic `.\w+` so it covers id, userId, capsuleId,
// managerId, month, week, noteId, etc. in one pass.
const grepOut = execSync(
  `grep -rln "params\\.\\w" src/app/api`,
  { encoding: "utf8" }
).trim();
const TARGETS = grepOut.split("\n").filter(Boolean);

let fixedCount = 0;
for (const rel of TARGETS) {
  const p = path.resolve(rel);
  let src = fs.readFileSync(p, "utf8");
  const before = src;

  // (1) Widen inline type:  { params: { foo: string; bar: string } }
  src = src.replace(
    /\{\s*params\s*\}\s*:\s*\{\s*params\s*:\s*\{([^}]*)\}\s*\}/g,
    "{ params }: { params: Promise<{$1}> }"
  );

  // (2) Widen aliased Params type decls.
  src = src.replace(
    /^(type\s+\w+\s*=\s*)\{([^}]+)\}(;?)\s*$/gm,
    (m, prefix, body, semi) => {
      if (!/:\s*string/.test(body)) return m;
      if (/Promise<\{/.test(m))     return m;
      return `${prefix}Promise<{${body}}>${semi}`;
    }
  );

  // (3) Rewrite each handler body. Split on `export async function` and work
  //     one block at a time to avoid cross-handler interference.
  const parts = src.split(/(?=export\s+async\s+function\s+(?:GET|POST|PUT|DELETE|PATCH)\b)/);
  for (let i = 0; i < parts.length; i++) {
    const block = parts[i];
    if (!/parseInt\(\s*params\./.test(block)) continue;

    // Find all `params.KEY` references used inside this handler.
    const keys = new Set();
    for (const m of block.matchAll(/params\.(\w+)/g)) keys.add(m[1]);
    if (keys.size === 0) continue;

    // Destructure with `Raw` suffix so we never collide with a local
    // `const month = parseInt(...)` that reuses the same name.
    //   `const { managerId: managerIdRaw, month: monthRaw } = await params;`
    const destructure = `        const { ${[...keys].map(k => `${k}: ${k}Raw`).join(", ")} } = await params;\n`;

    // Inject destructure after the `if (errorResponse) return errorResponse;`
    // guard if present, else right after the opening `try {`.
    let injected = block;
    const guardRe = /(if\s*\(\s*errorResponse\s*\)\s*return\s+errorResponse\s*;?\s*\n)/;
    if (guardRe.test(injected)) {
      injected = injected.replace(guardRe, (g) => g + "\n" + destructure);
    } else {
      injected = injected.replace(/(try\s*\{\s*\n)/, (g) => g + destructure);
    }

    // Replace every `params.KEY` with `KEYRaw`.
    for (const k of keys) {
      const paramRe = new RegExp(`\\bparams\\.${k}\\b`, "g");
      injected = injected.replace(paramRe, `${k}Raw`);
    }

    parts[i] = injected;
  }
  src = parts.join("");

  if (src !== before) {
    fs.writeFileSync(p, src);
    console.log(`  ✓ patched: ${rel}`);
    fixedCount++;
  } else {
    console.log(`  - no change: ${rel}`);
  }
}

console.log(`\nTotal patched: ${fixedCount} / ${TARGETS.length}`);
