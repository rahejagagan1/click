import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  console.log("\n══ SyncConfig ══");
  const cfg = await p.syncConfig.findMany({
    where: { key: { in: ["selected_spaces", "selected_lists"] } },
  });
  for (const c of cfg) {
    const v = Array.isArray(c.value) ? (c.value as any[]) : [];
    console.log(`  ${c.key}: ${v.length} item(s)`);
    for (const id of v.slice(0, 20)) console.log(`    • ${id}`);
    if (v.length > 20) console.log(`    ... and ${v.length - 20} more`);
  }

  console.log("\n══ Synced Spaces ══");
  const spaces = await p.space.findMany({ select: { id: true, clickupSpaceId: true, name: true, isSynced: true } });
  for (const s of spaces) console.log(`  id=${s.id}  "${s.name}"  clickupSpaceId=${s.clickupSpaceId}  synced=${s.isSynced}`);

  console.log("\n══ All capsules grouped by space ══");
  const caps = await p.capsule.findMany({
    select: { id: true, name: true, space: { select: { name: true } } },
    orderBy: [{ space: { name: "asc" } }, { name: "asc" }],
  });
  console.log(`  Total: ${caps.length}`);
  const bySpace = new Map<string, string[]>();
  for (const c of caps) {
    const k = c.space?.name ?? "(no space)";
    if (!bySpace.has(k)) bySpace.set(k, []);
    bySpace.get(k)!.push(c.name);
  }
  for (const [space, names] of bySpace) {
    console.log(`  ▸ ${space}  (${names.length} folders)`);
    for (const n of names.slice(0, 30)) console.log(`      - ${n}`);
    if (names.length > 30) console.log(`      ... +${names.length - 30}`);
  }

  console.log("\n══ Lists matching RTC / FOIA / Ready / Worksheet (in any capsule) ══");
  const lists = await p.productionList.findMany({
    where: {
      OR: [
        { name: { contains: "rtc",  mode: "insensitive" } },
        { name: { contains: "foia", mode: "insensitive" } },
        { name: { contains: "ready", mode: "insensitive" } },
      ],
    },
    select: {
      id: true, name: true,
      capsule: { select: { name: true, space: { select: { name: true } } } },
    },
    orderBy: { name: "asc" },
  });
  for (const l of lists) {
    console.log(`  "${l.name}"  ← capsule "${l.capsule?.name ?? "—"}"  / space "${l.capsule?.space?.name ?? "—"}"`);
  }
}

main().catch(console.error).finally(() => p.$disconnect());
