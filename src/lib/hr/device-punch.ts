// Records attendance from a physical biometric terminal (Hikvision) that is
// ALSO the office door lock: people punch every time they enter OR exit, so
// there are many punches a day. We must NOT create a clock-in/out per punch.
//
// Model — first-in / last-out, single span:
//   • The FIRST punch of the day = clock-in (opens the day).
//   • EVERY later punch just pushes the day's clock-OUT forward to that time.
//   • Result: one record per day = arrival (first punch) → last exit (last
//     punch); total hours = last − first. All the door opens in between are
//     absorbed into the span.
//   • Rapid duplicates / timeout-retries are debounced (90s).
//
// The terminal's attendanceStatus is ignored on purpose — for a door lock it
// can't reliably say "in" vs "out", and first-in/last-out doesn't need it.
import prisma from "@/lib/prisma";
import { istDateOnlyFrom, istMinutesOfDay } from "@/lib/ist-date";
import { stringifyAttLoc } from "@/lib/attendance-location";

const DEVICE_LOCATION = stringifyAttLoc({
  mode: "office",
  address: "Biometric terminal (face / fingerprint)",
  atOffice: true,
});
const DEBOUNCE_MS = 90_000;

export type DevicePunchResult =
  | { action: "clock_in" | "extend" | "noop"; userId: number; status?: string; totalMinutes?: number; note?: string }
  | { action: "unmapped"; employeeNo: string };

// Per-shift late cutoff = shift.startTime + grace; no shift → legacy 10:00 IST.
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

export async function recordDevicePunch(opts: { employeeNo: string; at: Date }): Promise<DevicePunchResult> {
  const userId = await resolveUserByDeviceId(opts.employeeNo);
  if (!userId) return { action: "unmapped", employeeNo: opts.employeeNo };
  const at = opts.at;
  const date = istDateOnlyFrom(at);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.attendance.findUnique({
      where: { userId_date: { userId, date } },
      select: { id: true, clockIn: true, status: true },
    });

    // FIRST punch of the day → clock-in (one open session).
    if (!existing || !existing.clockIn) {
      const status = await statusAtPunch(userId, at);
      if (!existing) {
        const created = await tx.attendance.create({ data: { userId, date, clockIn: at, status, location: DEVICE_LOCATION } });
        await tx.$executeRawUnsafe(`INSERT INTO "AttendanceSession" ("attendanceId","clockIn","clockInLocation") VALUES ($1,$2,$3)`, created.id, at, DEVICE_LOCATION);
        return { action: "clock_in", userId, status };
      }
      await tx.attendance.update({ where: { id: existing.id }, data: { clockIn: at, status, location: DEVICE_LOCATION } });
      await tx.$executeRawUnsafe(`INSERT INTO "AttendanceSession" ("attendanceId","clockIn","clockInLocation") VALUES ($1,$2,$3)`, existing.id, at, DEVICE_LOCATION);
      return { action: "clock_in", userId, status };
    }

    // Debounce duplicate / retried / rapid re-tap punches.
    const r = await tx.$queryRawUnsafe<Array<{ t: Date | null }>>(
      `SELECT MAX(GREATEST("clockIn", COALESCE("clockOut","clockIn"))) AS t FROM "AttendanceSession" WHERE "attendanceId"=$1`,
      existing.id,
    );
    const lastT = r[0]?.t ? new Date(r[0].t as any).getTime() : 0;
    if (lastT && Math.abs(at.getTime() - lastT) < DEBOUNCE_MS) return { action: "noop", userId, note: "debounced (<90s)" };
    if (at.getTime() <= existing.clockIn.getTime()) return { action: "noop", userId, note: "punch before clock-in" };

    // Subsequent punch → push the day's clock-out forward (keep ONE session).
    const last = await tx.$queryRawUnsafe<Array<{ id: number }>>(
      `SELECT id FROM "AttendanceSession" WHERE "attendanceId"=$1 ORDER BY "clockIn" DESC LIMIT 1`,
      existing.id,
    );
    if (last[0]) await tx.$executeRawUnsafe(`UPDATE "AttendanceSession" SET "clockOut"=$1, "clockOutLocation"=$2 WHERE id=$3`, at, DEVICE_LOCATION, last[0].id);
    const totalMinutes = Math.max(0, Math.floor((at.getTime() - existing.clockIn.getTime()) / 60000));
    await tx.attendance.update({ where: { id: existing.id }, data: { clockOut: at, totalMinutes, overtimeMinutes: Math.max(0, totalMinutes - 540) } });
    return { action: "extend", userId, status: existing.status, totalMinutes };
  });
}
