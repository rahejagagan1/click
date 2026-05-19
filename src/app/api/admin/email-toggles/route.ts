// Admin → Emails Automation: get / patch the per-type email toggles.
//
// GET   → returns the catalog + current toggle map (defaults to all ON).
// PATCH → upserts the toggle map. Body: { [emailKey]: boolean }.
//
// CEO + special_access + role=admin + developer can read / write.

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { serverError } from "@/lib/api-auth";
import {
  EMAIL_TOGGLE_CATALOG,
  getEmailToggles,
  saveEmailToggles,
  type EmailKey,
} from "@/lib/email/toggles";

export const dynamic = "force-dynamic";

function canManage(session: any): boolean {
  const u = session?.user;
  if (!u) return false;
  return (
    u.orgLevel === "ceo" ||
    u.orgLevel === "special_access" ||
    u.role === "admin" ||
    u.isDeveloper === true
  );
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!canManage(session)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const toggles = await getEmailToggles();
    return NextResponse.json({
      catalog: EMAIL_TOGGLE_CATALOG,
      toggles,
    });
  } catch (error) {
    return serverError(error, "admin/email-toggles GET");
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!canManage(session)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({} as any));

    // Whitelist incoming keys to the catalog so a stale UI can't poke
    // arbitrary SyncConfig keys.
    const known = new Set<string>(EMAIL_TOGGLE_CATALOG.map((t) => t.key));
    const patch: Record<EmailKey, boolean> = {} as any;
    for (const [k, v] of Object.entries(body ?? {})) {
      if (known.has(k) && typeof v === "boolean") {
        patch[k as EmailKey] = v;
      }
    }
    const toggles = await saveEmailToggles(patch);
    return NextResponse.json({ ok: true, toggles });
  } catch (error) {
    return serverError(error, "admin/email-toggles PATCH");
  }
}
