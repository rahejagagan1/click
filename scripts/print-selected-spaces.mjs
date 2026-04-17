import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const row = await prisma.syncConfig.findUnique({ where: { key: "selected_spaces" } });
const raw = row?.value ?? null;
console.log("SyncConfig key=selected_spaces (raw JSON):");
console.log(JSON.stringify(raw, null, 2));

const ids = Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : [];
const spaces =
  ids.length > 0
    ? await prisma.space.findMany({
        where: { clickupSpaceId: { in: ids } },
        orderBy: { name: "asc" },
      })
    : [];

console.log("\n---");
if (spaces.length) {
  console.log("Spaces linked in your DB (name + ClickUp space ID):");
  for (const s of spaces) {
    console.log(`  • ${s.name}  (clickupSpaceId: ${s.clickupSpaceId})`);
  }
} else if (ids.length) {
  console.log("Selected IDs (no matching Space rows yet — run space sync):");
  for (const id of ids) console.log(`  • ${id}`);
} else {
  console.log(
    "No selection in SyncConfig — sync engine falls back to TARGET_SPACE_IDS in src/lib/clickup/api-client.ts"
  );
}

// Default fallback when SyncConfig is empty (see src/lib/clickup/api-client.ts)
const FALLBACK_IDS = ["90165582699", "90162701586", "90165681655"];
const fallbackSpaces = await prisma.space.findMany({
  where: { clickupSpaceId: { in: FALLBACK_IDS } },
  orderBy: { name: "asc" },
});
if (fallbackSpaces.length) {
  console.log("\nFallback TARGET_SPACE_IDS (used when selection is empty):");
  for (const s of fallbackSpaces) {
    console.log(`  • ${s.name}  (clickupSpaceId: ${s.clickupSpaceId})`);
  }
}

await prisma.$disconnect();
