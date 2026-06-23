// Records attendance from a biometric terminal mounted OUTSIDE the door.
//
// Physical reality: people scan to ENTER, but leave freely from inside (no
// exit scan). So a scan reliably marks an ARRIVAL, never a departure.
//
// Model — scan = clock-IN only:
//   • First scan of the day → clock-in (opens the day).
//   • Any scan after you're already clocked in → IGNORED (a re-entry must NOT
//     clock you out / make you re-punch).
//   • A scan after you've clocked out for the day → IGNORED (don't reopen).
//   • CLOCK-OUT is never triggered by a scan — it's done on the web portal
//     (Web Clock-Out) at end of day. (If the device's "Check Out" is enabled
//     and the employee presses it, that explicit checkout IS honored — see
//     `checkOut`.)
import prisma from "@/lib/prisma";
import { istDateOnlyFrom, istMinutesOfDay } from "@/lib/ist-date";
import { stringifyAttLoc } from "@/lib/attendance-location";

const DEVICE_LOCATION = stringifyAttLoc({
  mode: "office",
  address: "Biometric terminal (face / fingerprint)",
  atOffice: true,
});

export type DevicePunchResult =
  | { action: "clock_in" | "clock_out" | "noop"; userId: number; status?: string; totalMinutes?: number; note?: string }
  | { action: "unmapped"; employeeNo: string };

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

export async function resolveUserByDeviceId(employeeNo: string): Promise<number | null> {
  const id = String(employeeNo || "").trim();
  if (!id) return null;
  const rows = await prisma.$queryRawUnsafe<Array<{ userId: number }>>(
    `SELECT "userId" FROM "EmployeeProfile" WHERE "employeeId" = $1 OR "biometricId" = $1 LIMIT 1`,
    id,
  );
  return rows[0]?.userId ?? null;
}

export async function recordDevicePunch(opts: { employeeNo: string; at: Date; checkOut?: boolean }): Promise<DevicePunchResult> {
  const userId = await resolveUserByDeviceId(opts.employeeNo);
  if (!userId) return { action: "unmapped", employeeNo: opts.employeeNo };
  const at = opts.at;
  const date = istDateOnlyFrom(at);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.attendance.findUnique({
      where: { userId_date: { userId, date } },
      select: { id: true, clockIn: true, clockOut: true, status: true },
    });

    // ── Explicit machine "Check Out" (only when attendance mode is enabled
    //    and the employee chose Check Out). Closes the open session. ──
    if (opts.checkOut) {
      if (!existing?.clockIn) return { action: "noop", userId, note: "checkout with no clock-in" };
      if (existing.clockOut) return { action: "noop", userId, note: "already clocked out" };
      const open = await tx.$queryRawUnsafe<Array<{ id: number }>>(
        `SELECT id FROM "AttendanceSession" WHERE "attendanceId"=$1 AND "clockOut" IS NULL ORDER BY "clockIn" DESC LIMIT 1`,
        existing.id,
      );
      if (open.length === 0) return { action: "noop", userId, note: "no open session" };
      const punchAt = at.getTime() < existing.clockIn.getTime() ? existing.clockIn : at;
      await tx.$executeRawUnsafe(`UPDATE "AttendanceSession" SET "clockOut"=$1, "clockOutLocation"=$2 WHERE id=$3`, punchAt, DEVICE_LOCATION, open[0].id);
      const sum = await tx.$queryRawUnsafe<Array<{ totalSeconds: number }>>(
        `SELECT COALESCE(EXTRACT(EPOCH FROM SUM("clockOut" - "clockIn")),0)::int AS "totalSeconds" FROM "AttendanceSession" WHERE "attendanceId"=$1 AND "clockOut" IS NOT NULL`,
        existing.id,
      );
      const totalMinutes = Math.floor((sum[0]?.totalSeconds ?? 0) / 60);
      let status = existing.status;
      if (totalMinutes >= 540) status = existing.status === "late" ? "late" : "present";
      else if (totalMinutes >= 270) status = "half_day";
      await tx.attendance.update({ where: { id: existing.id }, data: { clockOut: punchAt, totalMinutes, status, overtimeMinutes: Math.max(0, totalMinutes - 540) } });
      return { action: "clock_out", userId, status, totalMinutes };
    }

    // ── Plain scan / Check-In = clock-IN only ──
    // Already has a clock-in today → ignore (re-entry, or already done).
    if (existing?.clockIn) {
      return { action: "noop", userId, note: existing.clockOut ? "already clocked out (scan ignored)" : "already clocked in (re-entry ignored)" };
    }
    // First scan of the day → clock-in (open session).
    const status = await statusAtPunch(userId, at);
    if (!existing) {
      const created = await tx.attendance.create({ data: { userId, date, clockIn: at, status, location: DEVICE_LOCATION } });
      await tx.$executeRawUnsafe(`INSERT INTO "AttendanceSession" ("attendanceId","clockIn","clockInLocation") VALUES ($1,$2,$3)`, created.id, at, DEVICE_LOCATION);
    } else {
      await tx.attendance.update({ where: { id: existing.id }, data: { clockIn: at, status, location: DEVICE_LOCATION } });
      await tx.$executeRawUnsafe(`INSERT INTO "AttendanceSession" ("attendanceId","clockIn","clockInLocation") VALUES ($1,$2,$3)`, existing.id, at, DEVICE_LOCATION);
    }
    return { action: "clock_in", userId, status };
  });
}
