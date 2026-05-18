/**
 * Help the user reconstruct Manager Gagan's April team so they can run
 * the manual "Refresh team snapshot" workflow.
 *
 * Strategy — three independent signals, scored together:
 *   1. teamCapsule match  → user's User.teamCapsule equals Gagan's
 *      (this often outlasts managerId changes because HR sometimes
 *      moves managers but leaves the capsule tag)
 *   2. Cases worked in April under Gagan's capsule
 *   3. User was currently under Gagan (managerId === 486)  → already
 *      checked, returns 0
 *
 * Outputs editors/writers/researchers, NOT currently under Gagan but
 * showing one of the historical signals.
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const MGR_ID = 486;
const APRIL_START = new Date("2026-04-01T00:00:00Z");
const APRIL_END   = new Date("2026-05-04T23:59:59.999Z"); // Monthly report window: day 4 of next month

async function main() {
  const mgr = await p.user.findUnique({
    where: { id: MGR_ID },
    select: { id: true, name: true, teamCapsule: true },
  });
  if (!mgr) { console.log("Manager not found"); return; }
  console.log(`Manager: ${mgr.name} (id=${mgr.id})  teamCapsule="${mgr.teamCapsule ?? "—"}"`);
  console.log();

  // ─── Signal 1: teamCapsule match ──────────────────────────────────
  let capMatch: Array<{ id: number; name: string | null; role: string; managerId: number | null; teamCapsule: string | null }> = [];
  if (mgr.teamCapsule) {
    capMatch = await p.user.findMany({
      where: {
        isActive: true,
        teamCapsule: mgr.teamCapsule,
        id: { not: MGR_ID },
        role: { in: ["editor", "writer", "researcher"] as any },
      },
      select: { id: true, name: true, role: true, managerId: true, teamCapsule: true },
      orderBy: { name: "asc" },
    });
  }
  console.log(`Signal 1 — users with teamCapsule="${mgr.teamCapsule}": ${capMatch.length}`);
  for (const u of capMatch) {
    const note = u.managerId === MGR_ID ? "✓ already under Gagan"
               : u.managerId === null  ? "no manager set"
               : `currently under managerId=${u.managerId}`;
    console.log(`  id=${u.id}  ${u.name?.padEnd(22)} role=${u.role.padEnd(10)} ${note}`);
  }
  console.log();

  // ─── Signal 2: who did work in April that ended up in cases under
  //     Gagan's capsule? We approximate the "Gagan capsule" set as any
  //     ProductionList whose Capsule.name matches the manager's
  //     teamCapsule (case-insensitive contains).
  if (mgr.teamCapsule) {
    const lists = await p.productionList.findMany({
      where: {
        capsule: {
          name: { contains: mgr.teamCapsule.trim(), mode: "insensitive" },
        },
      },
      select: { id: true, name: true, capsule: { select: { name: true } } },
    });
    console.log(`Signal 2 — ProductionLists under capsule="${mgr.teamCapsule}": ${lists.length}`);
    if (lists.length > 0) {
      const listIds = lists.map((l) => l.id);
      const cases = await p.case.findMany({
        where: {
          productionListId: { in: listIds },
          dateDone: { gte: APRIL_START, lte: APRIL_END },
        },
        select: {
          id: true,
          writerUserId: true,
          editorUserId: true,
          researcherUserId: true,
        },
      });
      const userIds = new Set<number>();
      for (const c of cases) {
        if (c.writerUserId)     userIds.add(c.writerUserId);
        if (c.editorUserId)     userIds.add(c.editorUserId);
        if (c.researcherUserId) userIds.add(c.researcherUserId);
      }
      console.log(`  → April cases done in those lists: ${cases.length}   distinct contributors: ${userIds.size}`);

      if (userIds.size > 0) {
        const contributors = await p.user.findMany({
          where: { id: { in: Array.from(userIds) } },
          select: { id: true, name: true, role: true, managerId: true, teamCapsule: true },
          orderBy: { name: "asc" },
        });
        for (const u of contributors) {
          const note = u.managerId === MGR_ID ? "✓ already under Gagan"
                     : u.managerId === null  ? "no manager set"
                     : `currently under managerId=${u.managerId}`;
          console.log(`  id=${u.id}  ${u.name?.padEnd(22)} role=${u.role.padEnd(10)} ${note}`);
        }
      }
    }
  }
  console.log();

  // ─── Suggested fix list ───────────────────────────────────────────
  // Users who showed up via signal 1 OR 2 AND are not currently under Gagan
  // → these are your "needs to be temporarily reassigned" candidates.
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Candidates to temporarily re-assign to Gagan for snapshot:`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  const candidates = capMatch.filter((u) => u.managerId !== MGR_ID);
  for (const u of candidates) {
    console.log(`  id=${u.id}  ${u.name?.padEnd(22)} role=${u.role.padEnd(10)} current managerId=${u.managerId}`);
  }
  if (candidates.length === 0) {
    console.log(`  (none — Signal 1 + 2 both came back empty or all matches are already under Gagan)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
