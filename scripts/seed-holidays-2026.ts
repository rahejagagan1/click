// Seeds standard Indian public holidays for 2026 into HolidayCalendar.
// Idempotent — uses (year, date) unique upsert. HR admins can add / edit /
// remove afterwards via the admin UI.
//
// Usage: npx tsx scripts/seed-holidays-2026.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Row = { name: string; date: string; type?: string };

const HOLIDAYS: Row[] = [
  { name: "New Year's Day",             date: "2026-01-01", type: "public" },
  { name: "Makar Sankranti / Pongal",   date: "2026-01-14", type: "public" },
  { name: "Republic Day",               date: "2026-01-26", type: "public" },
  { name: "Maha Shivratri",             date: "2026-02-15", type: "public" },
  { name: "Holi",                       date: "2026-03-04", type: "public" },
  { name: "Ram Navami",                 date: "2026-03-26", type: "optional" },
  { name: "Mahavir Jayanti",            date: "2026-03-31", type: "optional" },
  { name: "Good Friday",                date: "2026-04-03", type: "public" },
  { name: "Dr. Ambedkar Jayanti",       date: "2026-04-14", type: "public" },
  { name: "Eid ul-Fitr",                date: "2026-03-21", type: "public" },
  { name: "Labour Day",                 date: "2026-05-01", type: "public" },
  { name: "Buddha Purnima",             date: "2026-05-01", type: "optional" },
  { name: "Eid ul-Adha (Bakrid)",       date: "2026-05-27", type: "optional" },
  { name: "Muharram",                   date: "2026-06-26", type: "optional" },
  { name: "Independence Day",           date: "2026-08-15", type: "public" },
  { name: "Raksha Bandhan",             date: "2026-08-28", type: "optional" },
  { name: "Janmashtami",                date: "2026-09-04", type: "optional" },
  { name: "Ganesh Chaturthi",           date: "2026-09-14", type: "optional" },
  { name: "Onam",                       date: "2026-08-26", type: "optional" },
  { name: "Gandhi Jayanti",             date: "2026-10-02", type: "public" },
  { name: "Dussehra (Vijayadashami)",   date: "2026-10-20", type: "public" },
  { name: "Diwali (Deepavali)",         date: "2026-11-08", type: "public" },
  { name: "Govardhan Puja",             date: "2026-11-09", type: "optional" },
  { name: "Bhai Dooj",                  date: "2026-11-10", type: "optional" },
  { name: "Guru Nanak Jayanti",         date: "2026-11-24", type: "optional" },
  { name: "Christmas",                  date: "2026-12-25", type: "public" },
];

async function main() {
  let created = 0, updated = 0;
  for (const h of HOLIDAYS) {
    const d = new Date(`${h.date}T00:00:00.000Z`);
    const year = d.getUTCFullYear();
    const existing = await prisma.holidayCalendar.findUnique({
      where: { year_date: { year, date: d } },
    });
    if (existing) {
      await prisma.holidayCalendar.update({
        where: { id: existing.id },
        data:  { name: h.name, type: h.type || "public" },
      });
      updated++;
    } else {
      await prisma.holidayCalendar.create({
        data: { name: h.name, date: d, year, type: h.type || "public" },
      });
      created++;
    }
  }
  console.log(`Seeded ${HOLIDAYS.length} holidays: ${created} created, ${updated} updated.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
