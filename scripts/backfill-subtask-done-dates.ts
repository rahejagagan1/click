/**
 * Backfill script — re-fetches every subtask from ClickUp and corrects
 * dateDone / tat where the current DB value is wrong.
 *
 *   npx tsx scripts/backfill-subtask-done-dates.ts                   (dry run, reports diffs only)
 *   npx tsx scripts/backfill-subtask-done-dates.ts --apply           (writes the corrections)
 *   npx tsx scripts/backfill-subtask-done-dates.ts --apply --closed  (only refetch closed subtasks; faster)
 *   npx tsx scripts/backfill-subtask-done-dates.ts --apply --limit 100  (cap calls for a smoke test)
 *
 * Safety:
 *  - Dry run is the default. No DB writes unless --apply is passed.
 *  - Every subtask that changes is logged: id, name, case, old date, new date,
 *    delta days. A full CSV is written to scripts/backfill-diff.csv.
 *  - If ClickUp returns null date_done we WRITE null to DB — that drops the
 *    bogus date_updated fallback left over from the old sync.
 *  - Resilient: uses the hardened clickupApi (429 + network retries).
 */
import { readFileSync, existsSync, writeFileSync } from "fs";
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
import { clickupApi } from "../src/lib/clickup/api-client";
import { calcBusinessDaysTat } from "../src/lib/utils";

const APPLY   = process.argv.includes("--apply");
const CLOSED  = process.argv.includes("--closed");
const limitArg = process.argv.indexOf("--limit");
const LIMIT   = limitArg > -1 ? parseInt(process.argv[limitArg + 1] ?? "0", 10) : 0;

const CSV_PATH = resolve("scripts", "backfill-diff.csv");

function fmt(d: Date | null | undefined): string {
    if (!d) return "";
    return d.toISOString();
}
function deltaDays(a: Date | null, b: Date | null): string {
    if (!a || !b) return "";
    return ((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)).toFixed(2);
}
function almostEqual(a: Date | null, b: Date | null): boolean {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return Math.abs(a.getTime() - b.getTime()) < 1000; // within 1 s
}

async function main() {
    console.log(`\nBackfill subtask dateDone — ${APPLY ? "APPLY" : "DRY RUN"}${CLOSED ? " (closed only)" : ""}${LIMIT ? ` (limit ${LIMIT})` : ""}\n`);

    const where: any = {};
    if (CLOSED) where.statusType = "closed";

    const subtasks = await prisma.subtask.findMany({
        where,
        select: {
            id: true,
            clickupTaskId: true,
            name: true,
            statusType: true,
            startDate: true,
            dateDone: true,
            tat: true,
            case: { select: { id: true, name: true } },
        },
        orderBy: { id: "asc" },
        ...(LIMIT ? { take: LIMIT } : {}),
    });

    console.log(`Total subtasks to check: ${subtasks.length}`);
    console.log(`Estimated time @ 650 ms/call: ~${Math.ceil((subtasks.length * 0.65) / 60)} min\n`);

    const rows: string[] = [
        [
            "subtask_id",
            "clickup_id",
            "case_name",
            "subtask_name",
            "status_type",
            "db_start",
            "db_done",
            "clickup_done",
            "delta_days_done",
            "db_tat",
            "new_tat",
            "action",
        ].join(","),
    ];

    let checked = 0;
    let changed = 0;
    let cleared = 0; // wrote null where DB had a (bad) date
    let nullInBoth = 0;
    let unchanged = 0;
    let failed = 0;

    const startTime = Date.now();

    for (const s of subtasks) {
        checked++;

        let detail: any;
        try {
            detail = await clickupApi<any>(`/task/${s.clickupTaskId}`);
        } catch (err) {
            failed++;
            console.warn(`  ! fetch failed for ${s.clickupTaskId}: ${(err as Error).message}`);
            continue;
        }

        const clickupDone = detail?.date_done
            ? new Date(parseInt(detail.date_done))
            : null;
        const clickupStart = detail?.start_date
            ? new Date(parseInt(detail.start_date))
            : (s.startDate ?? null);

        const newTat = clickupStart && clickupDone
            ? calcBusinessDaysTat(clickupStart, clickupDone)
            : null;

        if (almostEqual(s.dateDone, clickupDone)) {
            unchanged++;
            if (checked % 100 === 0) {
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
                console.log(`  ...checked ${checked}/${subtasks.length} (elapsed ${elapsed}s, changes so far ${changed})`);
            }
            continue;
        }

        let action: string;
        if (clickupDone === null && s.dateDone !== null) {
            action = "clear";
            cleared++;
        } else if (clickupDone !== null && s.dateDone === null) {
            action = "set";
            changed++;
        } else if (clickupDone === null && s.dateDone === null) {
            action = "null-null";
            nullInBoth++;
            continue; // nothing to do
        } else {
            action = "correct";
            changed++;
        }

        rows.push([
            s.id,
            s.clickupTaskId,
            `"${(s.case?.name || "").replace(/"/g, '""')}"`,
            `"${s.name.replace(/"/g, '""')}"`,
            s.statusType ?? "",
            fmt(s.startDate),
            fmt(s.dateDone),
            fmt(clickupDone),
            deltaDays(s.dateDone, clickupDone),
            s.tat?.toString() ?? "",
            newTat?.toString() ?? "",
            action,
        ].join(","));

        console.log(
            `  ${action.padEnd(7)} #${s.id}  ${s.name.padEnd(28)}  ` +
            `${fmt(s.dateDone) || "(null)"} → ${fmt(clickupDone) || "(null)"}  ` +
            `Δ=${deltaDays(s.dateDone, clickupDone) || "—"}d  [${s.case?.name}]`
        );

        if (APPLY) {
            await prisma.subtask.update({
                where: { id: s.id },
                data: { dateDone: clickupDone, tat: newTat, lastSyncedAt: new Date() },
            });
        }
    }

    writeFileSync(CSV_PATH, rows.join("\n"), "utf8");

    const totalSec = ((Date.now() - startTime) / 1000).toFixed(0);

    console.log("\n═══ Summary ═══");
    console.log(`  checked      : ${checked}`);
    console.log(`  corrected    : ${changed}`);
    console.log(`  cleared (→null) : ${cleared}`);
    console.log(`  unchanged    : ${unchanged}`);
    console.log(`  null-null    : ${nullInBoth}`);
    console.log(`  failed       : ${failed}`);
    console.log(`  elapsed      : ${totalSec}s`);
    console.log(`  diff CSV     : ${CSV_PATH}`);
    if (!APPLY) console.log(`\n  (dry run — no DB writes. Re-run with --apply to commit.)`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
