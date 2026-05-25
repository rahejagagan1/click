export {};
import prisma from "../src/lib/prisma";

(async () => {
  try {
    const before = await prisma.$queryRawUnsafe<any[]>(
      `SELECT MAX(id) AS max_id, (SELECT last_value FROM "HolidayCalendar_id_seq") AS seq_last FROM "HolidayCalendar"`,
    );
    console.log("before:", before[0]);

    // Reset the sequence to max(id). The third arg `true` means the next
    // call to nextval() will return max(id) + 1, which is what we want.
    await prisma.$executeRawUnsafe(
      `SELECT setval('"HolidayCalendar_id_seq"', COALESCE((SELECT MAX(id) FROM "HolidayCalendar"), 1), true)`,
    );

    const after = await prisma.$queryRawUnsafe<any[]>(
      `SELECT MAX(id) AS max_id, (SELECT last_value FROM "HolidayCalendar_id_seq") AS seq_last FROM "HolidayCalendar"`,
    );
    console.log("after:", after[0]);
  } catch (e: any) {
    console.error("failed:", e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
