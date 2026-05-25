export {};
import prisma from "../src/lib/prisma";

(async () => {
  try {
    const d = new Date("2026-05-27");
    console.log("Date:", d.toISOString(), "year:", d.getUTCFullYear());

    const existing = await prisma.holidayCalendar.findUnique({
      where: { year_date: { year: 2026, date: d } },
    });
    console.log("existing for 2026-05-27:", existing);

    const all2026 = await prisma.holidayCalendar.findMany({
      where: { year: 2026 },
      orderBy: { date: "asc" },
    });
    console.log("total 2026 rows:", all2026.length);
    const may = all2026.filter((h) => h.date.toISOString().startsWith("2026-05"));
    console.log("May 2026 rows:", may);

    // Try the same upsert the API does:
    const upserted = await prisma.holidayCalendar.upsert({
      where:  { year_date: { year: d.getUTCFullYear(), date: d } },
      create: { name: "Bakrid/Eid ul-Adha", date: d, year: d.getUTCFullYear(), type: "public" },
      update: { name: "Bakrid/Eid ul-Adha", type: "public" },
    });
    console.log("upsert succeeded:", upserted);

    // Roll it back so the real DB isn't polluted with a test row.
    if (existing == null) {
      await prisma.holidayCalendar.delete({ where: { id: upserted.id } });
      console.log("test row deleted");
    }
  } catch (e: any) {
    console.error("ERROR:", e.code, e.message);
    if (e.meta) console.error("meta:", e.meta);
  } finally {
    await prisma.$disconnect();
  }
})();
