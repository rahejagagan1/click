// Records attendance from a physical biometric terminal (Hikvision face /
// fingerprint). Mirrors the clock-in / clock-out routes' multi-session logic
// and per-shift late detection, but skips the app-only gates (GPS, mobile
// block, Weekly-Pulse, exit-survey) because a device punch IS the physical
// proof of presence. The punch TIME comes from the device event, not "now".
import prisma from "@/lib/prisma";
import { istDateOnlyFrom, istMinutesOfDay } from "@/lib/ist-date";
import { stringifyAttLoc } from "@/lib/attendance-location";

// Location marker for device punches — no GPS, but flagged at-office so the
// dashboard's "At Office" badge is correct and HR can see the source.
const DEVICE_LOCATION = stringifyAttLoc({
  mode: "office",
  address: "Biometric terminal (face / fingerprint)",
  atOffice: true,
});

export type PunchDirection = "in" | "out";
export type DevicePunchResult = {
  action: "clock_in" | "clock_out" | "noop";
  userId: number;
  status?: string;
  totalMinutes?: number;
  note?: string;
};

// Per-shift late cutoff = shift.startTime + grace (Shift.breakMinutes, default
// 15); no shift → legacy 10:00 IST. Identical to clock-in/route.ts.
async function statusAtPunch(userId: number, at: Date): Promise<string> {
  const userShift = await prisma.userShift.findUnique({ where: { userId }, include: { shift: true } });
  const nowMin = istMinutesOfDay(at);
  if (userShift?.shift) {
    const [sh, sm] = userShift.shift.startTime.split(":").map(Number);
    const grace = Number.isFinite(userShift.shift.breakMinutes) ? userShift.shift.breakMinutes : 15;
    return nowMin > sh * 60 + sm + grace ? "late" : "present";
  }
  return nowMin >= 10 * 60 ? "late" : "present";
}

async function deviceClockIn(userId: number, at: Date): Promise<DevicePunchResult> {
  const date = istDateOnlyFrom(at);
  const status = await statusAtPunch(userId, at);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.attendance.findUnique({ where: { userId_date: { userId, date } } });
    if (!existing) {
      const created = await tx.attendance.create({ data: { userId, date, clockIn: at, status, location: DEVICE_LOCATION } });
      await tx.$executeRawUnsafe(`INSERT INTO "AttendanceSession" ("attendanceId","clockIn","clockInLocation") VALUES ($1,$2,$3)`, created.id, at, DEVICE_LOCATION);
      return { action: "clock_in", userId, status };
    }
    // Already clocked in (open session) — ignore the duplicate punch.
    if (existing.clockIn && !existing.clockOut) return { action: "noop", userId, note: "already clocked in" };
    // Resume: re-open the day, append a new session, keep the first clock-in
    // and don't downgrade a present/late status.
    const updated = await tx.attendance.update({
      where: { id: existing.id },
      data: {
        clockOut: null,
        clockIn: existing.clockIn ?? at,
        status: existing.status === "missed_clock_out" || existing.status === "absent" ? status : existing.status,
        location: DEVICE_LOCATION,
      },
    });
    await tx.$executeRawUnsafe(`INSERT INTO "AttendanceSession" ("attendanceId","clockIn","clockInLocation") VALUES ($1,$2,$3)`, updated.id, at, DEVICE_LOCATION);
    return { action: "clock_in", userId, status: updated.status };
  });
}

async function deviceClockOut(userId: number, at: Date): Promise<DevicePunchResult> {
  const date = istDateOnlyFrom(at);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.attendance.findUnique({ where: { userId_date: { userId, date } } });
    if (!existing?.clockIn) return { action: "noop", userId, note: "not clocked in" };
    if (existing.clockOut) return { action: "noop", userId, note: "already clocked out" };
    const open = await tx.$queryRawUnsafe<Array<{ id: number }>>(
      `SELECT id FROM "AttendanceSession" WHERE "attendanceId"=$1 AND "clockOut" IS NULL ORDER BY "clockIn" DESC LIMIT 1`,
      existing.id,
    );
    if (open.length === 0) return { action: "noop", userId, note: "no open session" };
    // Never let an out-punch land before the session's in-punch.
    const punchAt = at.getTime() < existing.clockIn.getTime() ? existing.clockIn : at;
    await tx.$executeRawUnsafe(`UPDATE "AttendanceSession" SET "clockOut"=$1, "clockOutLocation"=$2 WHERE id=$3`, punchAt, DEVICE_LOCATION, open[0].id);
    const sumRows = await tx.$queryRawUnsafe<Array<{ totalSeconds: number }>>(
      `SELECT COALESCE(EXTRACT(EPOCH FROM SUM("clockOut" - "clockIn")),0)::int AS "totalSeconds" FROM "AttendanceSession" WHERE "attendanceId"=$1 AND "clockOut" IS NOT NULL`,
      existing.id,
    );
    const totalMinutes = Math.floor((sumRows[0]?.totalSeconds ?? 0) / 60);
    let status = existing.status;
    if (totalMinutes >= 540) status = existing.status === "late" ? "late" : "present";
    else if (totalMinutes >= 270) status = "half_day";
    const overtimeMinutes = Math.max(0, totalMinutes - 540);
    const updated = await tx.attendance.update({ where: { id: existing.id }, data: { clockOut: punchAt, totalMinutes, status, overtimeMinutes } });
    return { action: "clock_out", userId, status: updated.status, totalMinutes };
  });
}

// Resolve the device's person id (employeeNoString, e.g. "HRM159") to a User.
// Primary match is EmployeeProfile.employeeId (HRM number); biometricId is a
// fallback for anyone whose device id was set manually to something else.
export async function resolveUserByDeviceId(employeeNo: string): Promise<number | null> {
  const id = String(employeeNo || "").trim();
  if (!id) return null;
  const rows = await prisma.$queryRawUnsafe<Array<{ userId: number }>>(
    `SELECT "userId" FROM "EmployeeProfile" WHERE "employeeId" = $1 OR "biometricId" = $1 LIMIT 1`,
    id,
  );
  return rows[0]?.userId ?? null;
}

// Main entry point used by the webhook. Maps the device id → user, then
// clocks in or out. If direction is unknown, infers from today's state
// (open session → out, otherwise → in).
export async function recordDevicePunch(opts: {
  employeeNo: string;
  at: Date;
  direction?: PunchDirection | null;
}): Promise<DevicePunchResult | { action: "unmapped"; employeeNo: string }> {
  const userId = await resolveUserByDeviceId(opts.employeeNo);
  if (!userId) return { action: "unmapped", employeeNo: opts.employeeNo };

  const date = istDateOnlyFrom(opts.at);
  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId, date } },
    select: { id: true, clockIn: true, clockOut: true },
  });

  // Debounce: the terminal re-POSTs the same punch on timeout and a single
  // tap can emit several events; without this each one toggles in/out and
  // sprays zero-length sessions. Ignore any punch within 90s of this user's
  // last session activity today — real in/out are minutes apart.
  if (existing) {
    const r = await prisma.$queryRawUnsafe<Array<{ t: Date | null }>>(
      `SELECT MAX(GREATEST("clockIn", COALESCE("clockOut","clockIn"))) AS t FROM "AttendanceSession" WHERE "attendanceId"=$1`,
      existing.id,
    );
    const lastT = r[0]?.t ? new Date(r[0].t as any).getTime() : 0;
    if (lastT && Math.abs(opts.at.getTime() - lastT) < 90_000) {
      return { action: "noop", userId, note: "debounced (<90s since last punch)" };
    }
  }

  let dir = opts.direction ?? null;
  if (!dir) dir = existing?.clockIn && !existing.clockOut ? "out" : "in";
  return dir === "out" ? deviceClockOut(userId, opts.at) : deviceClockIn(userId, opts.at);
}
