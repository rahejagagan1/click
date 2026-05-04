import { PrismaClient } from "@prisma/client";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const target = process.argv.slice(2).join(" ").trim() || "Khushboo";
    const rows = await prisma.user.findMany({
      where: { name: { contains: target, mode: "insensitive" } },
      include: {
        employeeProfile: true,
        manager: { select: { id: true, name: true, email: true } },
      },
    });
    if (rows.length === 0) {
      console.log(`No user found matching "${target}".`);
      return;
    }
    for (const u of rows) {
      console.log("=".repeat(60));
      console.log(`id=${u.id}  ${u.name}  <${u.email}>`);
      console.log(`  isActive:        ${u.isActive}`);
      console.log(`  role:            ${u.role}`);
      console.log(`  orgLevel:        ${u.orgLevel}`);
      console.log(`  managerId:       ${u.managerId} ${u.manager ? `(${u.manager.name})` : ""}`);
      console.log(`  teamCapsule:     ${u.teamCapsule ?? "—"}`);
      console.log(`  clickupUserId:   ${u.clickupUserId ?? "—"}`);
      console.log(`  createdAt:       ${u.createdAt.toISOString().slice(0,10)}`);
      console.log(`  onboardingDone:  ${(u as any).onboardingPending ? "no (pending)" : "yes"}`);
      if (u.employeeProfile) {
        console.log(`  designation:     ${u.employeeProfile.designation ?? "—"}`);
        console.log(`  department:      ${u.employeeProfile.department ?? "—"}`);
        console.log(`  joiningDate:     ${u.employeeProfile.joiningDate ? u.employeeProfile.joiningDate.toISOString().slice(0,10) : "—"}`);
        console.log(`  workerType:      ${(u.employeeProfile as any).workerType ?? "—"}`);
        console.log(`  employmentType:  ${u.employeeProfile.employmentType ?? "—"}`);
      } else {
        console.log("  employeeProfile: (none)");
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}
main().catch(console.error);
