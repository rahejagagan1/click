export {};
import prisma from "../src/lib/prisma";

(async () => {
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "WeeklyReport" ADD COLUMN IF NOT EXISTS "shortsRows" JSONB`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "MonthlyReport" ADD COLUMN IF NOT EXISTS "andrewERows" JSONB`);
    const r1 = await prisma.$queryRawUnsafe<any[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name='WeeklyReport' AND column_name='shortsRows'`,
    );
    const r2 = await prisma.$queryRawUnsafe<any[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name='MonthlyReport' AND column_name='andrewERows'`,
    );
    console.log("shortsRows present:", r1.length > 0);
    console.log("andrewERows present:", r2.length > 0);
  } catch (e: any) {
    console.error("failed:", e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
