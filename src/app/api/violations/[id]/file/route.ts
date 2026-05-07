import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireHRAdmin, serverError } from "@/lib/api-auth";

// Streams the action-taken document for a violation back to the
// caller, gated by the same HR-admin tier (CEO / dev / special_access /
// role=admin / orgLevel=hr_manager) that can view the violations log
// in the first place. The bytes live in the `actionTakenFileBlob`
// (BYTEA) column on Violation — Postgres is the storage layer for
// these documents now, since /public/uploads/ got wiped on every
// prod redeploy.
//
// Force-download by default (`Content-Disposition: attachment`) so
// browsers save the file straight to disk instead of trying to render
// PDFs / Word docs inline. HR has explicitly asked for this UX —
// "click → file in Downloads folder" matches their workflow.

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { session, errorResponse } = await requireHRAdmin();
        if (errorResponse) return errorResponse;
        void session;

        const { id: idRaw } = await params;
        const id = Number(idRaw);
        if (!Number.isFinite(id)) {
            return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        }

        // Cast to `any` because the typed Prisma client may lag the
        // BYTEA columns until `prisma generate` reruns. Same workaround
        // used elsewhere in this route file.
        const row = await (prisma.violation as any).findUnique({
            where: { id },
            select: {
                actionTakenFileBlob: true,
                actionTakenFileName: true,
                actionTakenFileMime: true,
            },
        }) as {
            actionTakenFileBlob: Buffer | Uint8Array | null;
            actionTakenFileName: string | null;
            actionTakenFileMime: string | null;
        } | null;

        if (!row || !row.actionTakenFileBlob) {
            // Either the violation was deleted or its file pre-dates
            // the BYTEA migration (URL-only legacy row, file is gone).
            return NextResponse.json(
                { error: "Attachment not found — file may have been lost in an earlier redeploy" },
                { status: 404 },
            );
        }

        const filename = row.actionTakenFileName || `violation-${id}`;
        const mime     = row.actionTakenFileMime || "application/octet-stream";

        // Convert Buffer / Uint8Array into a fresh Uint8Array so the
        // Response BodyInit type-checks across Node + Edge runtimes.
        const bytes = row.actionTakenFileBlob instanceof Buffer
            ? new Uint8Array(row.actionTakenFileBlob)
            : new Uint8Array(row.actionTakenFileBlob);

        // Sanitize the filename for the header — strip CR/LF (header
        // injection) and quotes that would break the value. RFC 6266
        // also lets us pass UTF-8 names via filename*=UTF-8''…; but
        // the simple ASCII-only `filename="…"` form covers the cases
        // HR realistically uploads (English names, dashes, dots).
        const safeName = filename
            .replace(/[\r\n"\\]/g, "_")
            .replace(/[^\x20-\x7E]/g, "_")
            .slice(0, 200);

        return new NextResponse(bytes, {
            status: 200,
            headers: {
                "Content-Type":        mime,
                "Content-Length":      String(bytes.byteLength),
                "Content-Disposition": `attachment; filename="${safeName}"`,
                // No-cache: a violation file should never be served to
                // someone whose access we revoke afterwards. Belt-and-
                // suspenders alongside the auth gate above.
                "Cache-Control":       "private, no-store",
            },
        });
    } catch (error) {
        return serverError(error, "violations/[id]/file GET");
    }
}
