import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const [userCount, caseCount, mrCount, casesFeb, mgrRatingsFeb] = await Promise.all([
    p.user.count(),
    p.case.count(),
    p.managerRating.count(),
    p.case.count({
      where: {
        dateCreated: {
          gte: new Date(Date.UTC(2026, 1, 1)),
          lt:  new Date(Date.UTC(2026, 2, 1)),
        },
      },
    }),
    p.managerRating.count({ where: { period: "2026-02" } }),
  ]);
  console.log({ userCount, caseCount, mrCount, casesFeb, mgrRatingsFeb });
}
main().catch(console.error).finally(() => p.$disconnect());
