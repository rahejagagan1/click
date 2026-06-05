// Deploy-check endpoint. Returns markers that prove which build of
// the application is actually running in this Node process — used
// to diagnose stale-build issues after a VPS redeploy.
//
// No auth: only returns non-sensitive metadata + the result of
// calling internal helpers (rolesForUser) on synthetic inputs.
//
// Hit it like:
//   curl https://<vps>/api/__deploy-check
//
// The key marker is `ceoExclusive`. If TRUE, commit 1811053 is in
// the running binary; if FALSE, the build is stale and the fix
// needs a redeploy / clean rebuild.

import { NextResponse } from "next/server";
import { rolesForUser } from "@/lib/email/toggles";

export const dynamic = "force-dynamic";

export async function GET() {
  // Marker for the rolesForUser CEO-exclusive fix (commit 1811053).
  // Before fix: returns ["ceo", "admin"] (or similar) for a user
  // with orgLevel=ceo, role=admin. After fix: returns ["ceo"] only.
  const rolesForCeoAdmin = rolesForUser({ orgLevel: "ceo", role: "admin" });
  const ceoExclusive =
    rolesForCeoAdmin.length === 1 && rolesForCeoAdmin[0] === "ceo";

  // Best-effort git info. In a typical Next.js build the .git
  // directory isn't on the server, so these may be empty — but if
  // you wire NEXT_PUBLIC_GIT_SHA / GIT_SHA during build, they'll
  // appear here.
  const sha =
    process.env.GIT_SHA ||
    process.env.NEXT_PUBLIC_GIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    null;

  return NextResponse.json({
    ok: true,
    nodeVersion: process.version,
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    serverStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    nowAt: new Date().toISOString(),
    sha,
    markers: {
      // TRUE = commit 1811053 (CEO-exclusive role gate) is live.
      // FALSE = stale build, redeploy needed.
      ceoExclusive,
      rolesForUserOutput: rolesForCeoAdmin,
    },
  });
}
