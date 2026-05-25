export {};
import prisma from "../src/lib/prisma";

(async () => {
  const r = await prisma.$queryRawUnsafe<any[]>(
    `SELECT indexname, indexdef FROM pg_indexes WHERE tablename='HolidayCalendar'`,
  );
  console.log("HolidayCalendar indexes:");
  for (const row of r) console.log(" ", row.indexname, "|", row.indexdef);
  await prisma.$disconnect();
})();
