import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const tanyas = await p.user.findMany({
    where: { name: { contains: "Tanya", mode: "insensitive" } },
    select: { id: true, name: true, email: true, isActive: true, orgLevel: true, role: true },
  });
  console.log(`Found ${tanyas.length} user(s) matching "Tanya":`);
  for (const t of tanyas) {
    console.log(`  id=${t.id} ${t.name}  <${t.email}>  active=${t.isActive}  orgLevel=${t.orgLevel ?? "-"}  role=${t.role ?? "-"}`);
  }

  if (tanyas.length === 0) return;

  for (const t of tanyas) {
    console.log(`\n=== Leaves for ${t.name} (id=${t.id}) ===`);
    const leaves = await p.leaveApplication.findMany({
      where: { userId: t.id },
      select: {
        id: true, fromDate: true, toDate: true, totalDays: true, reason: true,
        status: true, appliedAt: true,
        approvedAt: true, finalApprovedAt: true,
        leaveType: { select: { name: true, code: true } },
        approver:      { select: { name: true } },
        finalApprover: { select: { name: true } },
      },
      orderBy: { fromDate: "desc" },
    });
    if (leaves.length === 0) { console.log("  (no leave applications)"); continue; }
    for (const l of leaves) {
      const range = `${l.fromDate.toISOString().slice(0,10)} → ${l.toDate.toISOString().slice(0,10)}`;
      const days  = `${l.totalDays}d`;
      const lt    = l.leaveType?.code ?? l.leaveType?.name ?? "?";
      const applied = l.appliedAt.toISOString().slice(0,10);
      const l1 = l.approver?.name ? `L1:${l.approver.name}` : "L1:—";
      const l2 = l.finalApprover?.name ? `L2:${l.finalApprover.name}` : "L2:—";
      console.log(`  id=${l.id}  ${range}  ${days.padStart(5)}  ${lt.padEnd(6)}  applied=${applied}  status=${l.status.padEnd(20)}  ${l1}  ${l2}`);
      if (l.reason) console.log(`     reason: ${l.reason.slice(0,120)}`);
    }

    // Summary: counts by status.
    const byStatus: Record<string, number> = {};
    for (const l of leaves) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
    console.log(`  -- summary: ${Object.entries(byStatus).map(([s,c]) => `${s}=${c}`).join(", ")}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
