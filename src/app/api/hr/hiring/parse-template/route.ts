// Convert an uploaded .docx file into clean HTML so HR can drop in
// the existing email templates from the canonical Word docs without
// re-typing them. Falls back to plain-text wrapping for unknown
// formats.
//
// POST /api/hr/hiring/parse-template
//   multipart/form-data → field `file` is a single .docx / .html /
//   .htm / .txt file.
//
// Returns: { html: "<p>…</p>…", subjectGuess?: string }
//   - html: rendered HTML ready to drop into the template body
//   - subjectGuess: if the doc has an obvious title (first <h1>),
//     surfaced so HR can one-click it into the Subject field

import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import { requireAuth, serverError } from "@/lib/api-auth";
import { isHRAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB — plenty for an email template

export async function POST(req: NextRequest) {
  const { session, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  if (!isHRAdmin(session!.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (max 4 MB)" }, { status: 413 });
    }
    const name = (file as any).name?.toLowerCase?.() || "";
    const buf = Buffer.from(await file.arrayBuffer());

    let html = "";
    if (name.endsWith(".docx")) {
      const result = await mammoth.convertToHtml({ buffer: buf });
      html = result.value || "";
    } else if (name.endsWith(".html") || name.endsWith(".htm")) {
      html = buf.toString("utf8");
    } else if (name.endsWith(".txt") || file.type.startsWith("text/")) {
      // Wrap each line in <p>; preserves spacing for HR who pastes
      // plain-text templates.
      html = buf
        .toString("utf8")
        .split(/\r?\n\r?\n/)
        .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br/>")}</p>`)
        .join("");
    } else {
      return NextResponse.json(
        { error: "Unsupported format — upload .docx, .html, or .txt" },
        { status: 400 },
      );
    }

    // Surface the first H1 as a subject suggestion (Word docs from the
    // canonical NB Media templates lead with the email subject as the
    // doc title).
    const subjectMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const subjectGuess = subjectMatch
      ? subjectMatch[1].replace(/<[^>]+>/g, "").trim()
      : undefined;

    return NextResponse.json({ html, subjectGuess });
  } catch (e) {
    return serverError(e, "POST /api/hr/hiring/parse-template");
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
