/**
 * Runs the ClickUp -> DB sync using the patched sync engine.
 *   npx tsx scripts/run-sync.ts             -> full sync (users + spaces + capsules + lists + tasks)
 *   npx tsx scripts/run-sync.ts --tasks     -> only tasks + subtasks (fastest, usually what you want)
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

(function loadEnv() {
    const envPath = resolve(process.cwd(), ".env");
    if (!existsSync(envPath)) return;
    const txt = readFileSync(envPath, "utf8");
    for (const line of txt.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
    }
})();

import prisma from "../src/lib/prisma";
import { runFullSync, syncTasks } from "../src/lib/clickup/sync-engine";

async function main() {
    const tasksOnly = process.argv.includes("--tasks");
    const started = Date.now();

    if (tasksOnly) {
        console.log("Running tasks-only sync...\n");
        const n = await syncTasks();
        console.log(`\nDone — ${n} task upserts, elapsed ${(((Date.now() - started) / 1000)).toFixed(1)}s`);
    } else {
        console.log("Running full sync...\n");
        const result = await runFullSync();
        console.log(`\nDone — ${JSON.stringify(result)}, elapsed ${(((Date.now() - started) / 1000)).toFixed(1)}s`);
    }
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
