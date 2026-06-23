// Receives access events pushed by the Hikvision DS-K1T342MFWX terminal
// (Configuration → Network → Network Service → HTTP Listening). Each
// successful face / fingerprint authentication becomes a clock-in or
// clock-out in the dashboard.
//
// Device setup (HTTP Listening):
//   Event Alarm IP/Domain : studio.nbmedia.co.in
//   URL                   : /api/devices/hikvision/event?key=<HIKVISION_WEBHOOK_KEY>
//   Port                  : 443
//   Protocol              : HTTPS
//
// Security: requests must carry ?key= matching env HIKVISION_WEBHOOK_KEY (if
// set). The device serial can additionally be pinned via HIKVISION_DEVICE_SERIAL.
// The raw payload is always logged (truncated) so the exact event shape can be
// verified from `pm2 logs` after the first real punch.
import { NextRequest, NextResponse } from "next/server";
import { recordDevicePunch, type PunchDirection } from "@/lib/hr/device-punch";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

// Pull the event JSON out of whatever the device sent: a JSON body, or a
// multipart/form-data body (event JSON in one part + optional capture image).
async function extractEventJson(req: NextRequest): Promise<any | null> {
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  try {
    if (ct.includes("application/json")) {
      return await req.json();
    }
    if (ct.includes("multipart/form-data") || ct.includes("form-data")) {
      const form = await req.formData();
      for (const [, value] of form.entries()) {
        const text = typeof value === "string" ? value : await (value as Blob).text().catch(() => "");
        const trimmed = text.trim();
        if (trimmed.startsWith("{")) {
          try { return JSON.parse(trimmed); } catch { /* try next part */ }
        }
      }
      return null;
    }
    // Fallback: read as text and try to parse.
    const body = (await req.text()).trim();
    return body.startsWith("{") ? JSON.parse(body) : null;
  } catch {
    return null;
  }
}

// "checkIn" / "breakIn" / "overTimeIn" → in; "...Out" → out; anything else
// (incl. "undefined") → null, and the recorder infers from today's state.
function directionFromStatus(status: unknown): PunchDirection | null {
  const s = String(status || "").toLowerCase();
  if (s.endsWith("out")) return "out";
  if (s.endsWith("in")) return "in";
  return null;
}

async function handle(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────
  const expectedKey = process.env.HIKVISION_WEBHOOK_KEY;
  if (expectedKey) {
    if (req.nextUrl.searchParams.get("key") !== expectedKey) {
      console.warn("[hikvision] rejected: bad/missing ?key");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    console.warn("[hikvision] HIKVISION_WEBHOOK_KEY is not set — endpoint is OPEN. Set it before going live.");
  }

  const payload = await extractEventJson(req);
  // Always log (truncated) so we can confirm the real event shape from logs.
  try { console.log("[hikvision] event:", JSON.stringify(payload).slice(0, 1500)); }
  catch { console.log("[hikvision] event: <unparseable body>"); }

  if (!payload) return NextResponse.json({ ok: true, ignored: "no-json" });

  // Optional device pinning.
  const pinnedSerial = process.env.HIKVISION_DEVICE_SERIAL;
  const serial = payload.AccessControllerEvent?.serialNo ?? payload.serialNo ?? payload.deviceID ?? null;
  if (pinnedSerial && serial && String(serial) !== pinnedSerial) {
    console.warn(`[hikvision] rejected: serial ${serial} != pinned`);
    return NextResponse.json({ error: "Unknown device" }, { status: 403 });
  }

  const ace = payload.AccessControllerEvent ?? payload.accessControllerEvent ?? null;
  const employeeNo = String(ace?.employeeNoString ?? ace?.employeeNo ?? ace?.employeeID ?? "").trim();

  // Only act on events that identify a person (a successful auth). Door
  // status, heartbeats, tamper, failed/unknown reads carry no employee no.
  if (!ace || !employeeNo) {
    return NextResponse.json({ ok: true, ignored: "no-employee" });
  }

  // Punch time from the event (ISO8601 with offset, e.g. ...+05:30). Falls
  // back to now if the device omitted it.
  const dtRaw = payload.dateTime ?? ace.time ?? ace.dateTime ?? null;
  const at = dtRaw ? new Date(dtRaw) : new Date();
  const at2 = Number.isNaN(at.getTime()) ? new Date() : at;

  const direction = directionFromStatus(ace.attendanceStatus);

  try {
    const result = await recordDevicePunch({ employeeNo, at: at2, direction });
    console.log(`[hikvision] punch emp=${employeeNo} dir=${direction ?? "auto"} at=${at2.toISOString()} →`, JSON.stringify(result));
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    console.error("[hikvision] record failed:", e?.message ?? e);
    // Still 200 so the device doesn't retry-storm; we have it in the logs.
    return NextResponse.json({ ok: false, error: "record-failed" });
  }
}

export const POST = handle;
export const GET  = handle; // some firmware probes with GET first
