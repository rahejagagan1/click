import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  // Find the two folders the user mentioned.
  for (const name of ["Ready To Cover 2026", "FOIA Worksheet 2026"]) {
    const cap = await p.capsule.findFirst({
      where: { name: { contains: name.split(" ")[0], mode: "insensitive" } },
      select: {
        id: true, clickupFolderId: true, name: true, spaceId: true,
        space: { select: { name: true } },
        productionLists: { select: { id: true, name: true, clickupListId: true } },
      },
    });
    console.log(`\n── Looking for "${name}" ──`);
    if (!cap) { console.log("  ✗ not found"); continue; }
    console.log(`  ✓ Capsule id=${cap.id}  name="${cap.name}"  space="${cap.space?.name}"`);
    console.log(`  Lists: ${cap.productionLists.length}`);
    for (const l of cap.productionLists.slice(0, 10)) {
      const caseCount = await p.case.count({ where: { productionListId: l.id } });
      console.log(`    - "${l.name}" (${caseCount} cases)`);
    }
    if (cap.productionLists.length > 10) console.log(`    ... and ${cap.productionLists.length - 10} more`);
  }

  // Also list ALL capsules to find names that might match
  console.log(`\n── All capsules with "ready" or "foia" in name ──`);
  const all = await p.capsule.findMany({
    where: {
      OR: [
        { name: { contains: "ready", mode: "insensitive" } },
        { name: { contains: "foia",  mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, space: { select: { name: true } } },
  });
  for (const c of all) console.log(`  id=${c.id}  "${c.name}"  (space: ${c.space?.name})`);
}

main().catch(console.error).finally(() => p.$disconnect());
