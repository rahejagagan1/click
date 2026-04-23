import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

(function loadEnv() {
    const envPath = resolve(process.cwd(), ".env");
    if (!existsSync(envPath)) return;
    const txt = readFileSync(envPath, "utf8");
    for (const line of txt.split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq === -1) continue;
        const k = t.slice(0, eq).trim();
        let v = t.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!process.env[k]) process.env[k] = v;
    }
})();

import prisma from "../src/lib/prisma";
import { clickupApi } from "../src/lib/clickup/api-client";

async function main() {
    const parentId = "86d2jj39t";

    // Check DB
    const inDb = await prisma.case.findUnique({
        where: { clickupTaskId: parentId },
        select: { id: true, name: true, productionListId: true, isArchived: true },
    });
    console.log(`DB has case ${parentId}: ${inDb ? JSON.stringify(inDb) : "NO"}`);

    // Fetch from ClickUp
    console.log("\nFetching from ClickUp...");
    try {
        const task: any = await clickupApi<any>(`/task/${parentId}`);
        console.log(`  id       : ${task.id}`);
        console.log(`  name     : ${task.name}`);
        console.log(`  list     : ${task.list?.id} "${task.list?.name}"`);
        console.log(`  folder   : ${task.folder?.id} "${task.folder?.name}"`);
        console.log(`  space    : ${task.space?.id}`);
        console.log(`  status   : ${task.status?.status} (${task.status?.type})`);
        console.log(`  archived : ${task.archived}`);
        console.log(`  parent   : ${task.parent ?? "—"}  top_level_parent=${task.top_level_parent ?? "—"}`);
    } catch (e) {
        console.log(`  ClickUp fetch failed: ${(e as Error).message}`);
    }

    // The "parent" we saw is really a subtask-of-subtask. Walk up one more level.
    const grandparentId = "86d2jj1qx";
    console.log(`\nFetching grandparent ${grandparentId}...`);
    try {
        const gp: any = await clickupApi<any>(`/task/${grandparentId}`);
        console.log(`  id     : ${gp.id}`);
        console.log(`  name   : ${gp.name}`);
        console.log(`  parent : ${gp.parent ?? "—"}`);
        console.log(`  top    : ${gp.top_level_parent ?? "—"}`);
        console.log(`  list   : ${gp.list?.id} "${gp.list?.name}"`);

        const inDb = await prisma.case.findUnique({
            where: { clickupTaskId: grandparentId },
            select: { id: true, name: true },
        });
        console.log(`  in DB  : ${inDb ? JSON.stringify(inDb) : "NO"}`);
    } catch (e) {
        console.log(`  ClickUp fetch failed: ${(e as Error).message}`);
    }

    // Also check the skipped sub-subtasks
    console.log("\nChecking the 3 skipped sub-subtasks:");
    for (const id of ["86d2n0rt7", "86d2n0rr4", "86d2n0qab"]) {
        try {
            const t: any = await clickupApi<any>(`/task/${id}`);
            console.log(`  ${id}  name="${t.name}"  parent=${t.parent}  top=${t.top_level_parent}`);
        } catch (e) {
            console.log(`  ${id} fetch failed: ${(e as Error).message}`);
        }
    }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
