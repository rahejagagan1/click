export {};
import prisma from "../src/lib/prisma";

(async () => {
  try {
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "HolidayCalendar_date_key"`);
    const r = await prisma.$queryRawUnsafe<any[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename='HolidayCalendar'`,
    );
    console.log("indexes after drop:");
    for (const row of r) console.log(" ", row.indexname);
  } catch (e: any) {
    console.error("failed:", e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
