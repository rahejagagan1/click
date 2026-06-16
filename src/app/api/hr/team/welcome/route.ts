// Team Welcome — sends the "Introducing X to the team" announcement
// to all active employees. Fired manually by HR from the onboard
// success screen with HR's edited body + optional attachments.
//
// Auth: HR Admin only (same gate as candidate-side hiring routes).
// Attachments: same 4 MB cap as the hiring sendEmail action.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";
import { sendEmail, emailsForAllActiveUsers } from "@/lib/email/sender";

export const dynamic = "force-dynamic";

const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

function parseAttachments(input: unknown): { filename: string; contentType?: string; contentBase64: string }[] {
  if (!Array.isArray(input)) return [];
  const out: { filename: string; contentType?: string; contentBase64: string }[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const filename = String((raw as any).filename ?? "").trim();
    const b64      = String((raw as any).contentBase64 ?? "");
    if (!filename || !b64) continue;
    const approxBytes = Math.floor(b64.length * 0.75);
    if (approxBytes > MAX_ATTACHMENT_BYTES) continue;
    out.push({
      filename,
      contentType: typeof (raw as any).contentType === "string" ? (raw as any).contentType : undefined,
      contentBase64: b64,
    });
  }
  return out;
}

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body    = await req.json().catch(() => ({}));
    const subject = String(body?.subject ?? "").trim();
    const html    = String(body?.body ?? "").trim();
    if (!subject) return NextResponse.json({ error: "Subject required" }, { status: 400 });
    if (!html)    return NextResponse.json({ error: "Body required" },    { status: 400 });
    // Safety net: never ship an email that still has unfilled
    // {{placeholders}} (e.g. {{Home City}}) — they slip through when HR
    // sends without editing the template. Block + tell HR what to fix.
    const leftover = (subject + " " + html).match(/\{\{[^}]{0,60}\}\}/);
    if (leftover) {
      return NextResponse.json(
        { error: `The email still has an unfilled placeholder: ${leftover[0]}. Please fill it in before sending.` },
        { status: 400 },
      );
    }

    // Pull every active employee. BCC so we don't leak the team list
    // to each recipient. To = the sender (a single visible address).
    const recipients = await emailsForAllActiveUsers();
    if (recipients.length === 0) {
      return NextResponse.json({ error: "No active employees to email" }, { status: 400 });
    }
    const senderAddr = session!.user.email!;
    const attachments = parseAttachments(body?.attachments);

    await sendEmail({
      to:  senderAddr,                       // visible "To"
      bcc: recipients.filter((e) => e !== senderAddr),
      content: { subject, html, text: html.replace(/<[^>]+>/g, "") } as any,
      attachments,
    });

    return NextResponse.json({ ok: true, recipientCount: recipients.length });
  } catch (e) {
    return serverError(e, "POST /api/hr/team/welcome");
  }
}
