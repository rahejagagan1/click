export {};
import prisma from "../src/lib/prisma";

(async () => {
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "HolidayCalendar" DROP CONSTRAINT IF EXISTS "HolidayCalendar_date_key"`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "HolidayCalendar_year_date_key" ON "HolidayCalendar" ("year", "date")`,
    );
    const r = await prisma.$queryRawUnsafe<any[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename='HolidayCalendar'`,
    );
    console.log("indexes after migration:");
    for (const row of r) console.log(" ", row.indexname);
  } catch (e: any) {
    console.error("failed:", e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
