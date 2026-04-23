/**
 * Re-sync ONLY case 86d1rn248 ("022607 Julio Ramirez (Suchi/Anjali)") directly
 * from ClickUp. Prints the ClickUp payload dates next to the DB values before
 * upsert, upserts, then reprints the DB state so you can confirm the data is
 * correct.
 *
 * Mirrors the upsert logic in src/lib/clickup/sync-engine.ts so the result is
 * identical to the nightly sync.
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// Load .env (tsx does not auto-load) — must run BEFORE other imports that read env.
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
import { parseCustomFields } from "../src/lib/clickup/field-parser";
import { USER_FIELDS } from "../src/lib/clickup/field-mapping";
import { calcBusinessDaysTat } from "../src/lib/utils";

const CLICKUP_TASK_ID = "86d1rn248";

function fmt(d: Date | null | undefined): string {
    if (!d) return "—";
    return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}
function fmtMs(ms: string | number | null | undefined): string {
    if (ms === null || ms === undefined || ms === "") return "—";
    return fmt(new Date(typeof ms === "string" ? parseInt(ms) : ms));
}

async function resolveUserId(clickupId: number | string | null | undefined): Promise<number | null> {
    if (!clickupId) return null;
    try {
        const user = await prisma.user.findUnique({
            where: { clickupUserId: BigInt(clickupId) },
            select: { id: true },
        });
        return user?.id || null;
    } catch {
        return null;
    }
}

async function upsertSubtaskFromClickup(subtask: any, caseId: number): Promise<void> {
    const subtaskAssigneeId = await resolveUserId(subtask.assignees?.[0]?.id);

    const stStartDate = subtask.start_date ? new Date(parseInt(subtask.start_date)) : null;
    const stDateDone = subtask.date_done
        ? new Date(parseInt(subtask.date_done))
        : subtask.status?.type === "closed" && subtask.date_updated
            ? new Date(parseInt(subtask.date_updated))
            : null;
    const stTat = stStartDate && stDateDone ? calcBusinessDaysTat(stStartDate, stDateDone) : null;

    await prisma.subtask.upsert({
        where: { clickupTaskId: subtask.id },
        create: {
            clickupTaskId: subtask.id,
            caseId,
            name: subtask.name,
            status: subtask.status?.status || "unknown",
            statusType: subtask.status?.type || null,
            assigneeUserId: subtaskAssigneeId,
            startDate: stStartDate,
            dueDate: subtask.due_date ? new Date(parseInt(subtask.due_date)) : null,
            dateDone: stDateDone,
            tat: stTat,
            orderIndex: subtask.orderindex ? parseInt(subtask.orderindex) : null,
            dateCreated: subtask.date_created ? new Date(parseInt(subtask.date_created)) : null,
            lastSyncedAt: new Date(),
        },
        update: {
            name: subtask.name,
            status: subtask.status?.status || "unknown",
            statusType: subtask.status?.type || null,
            assigneeUserId: subtaskAssigneeId,
            startDate: stStartDate,
            dueDate: subtask.due_date ? new Date(parseInt(subtask.due_date)) : null,
            dateDone: stDateDone,
            tat: stTat,
            lastSyncedAt: new Date(),
        },
    });
}

async function main() {
    console.log(`\nFetching ClickUp task ${CLICKUP_TASK_ID} ...\n`);

    // 1) Fetch the parent task (with subtasks flag so ClickUp also returns the subtask ids)
    const task: any = await clickupApi<any>(`/task/${CLICKUP_TASK_ID}?include_subtasks=true`);
    if (!task?.id) {
        console.log("Task not found in ClickUp.");
        return;
    }

    console.log("═══ ClickUp payload (parent) ═══");
    console.log(`  id             : ${task.id}`);
    console.log(`  name           : ${task.name}`);
    console.log(`  status         : ${task.status?.status}  (type ${task.status?.type})`);
    console.log(`  list           : ${task.list?.id} "${task.list?.name}"`);
    console.log(`  date_created   : ${fmtMs(task.date_created)}`);
    console.log(`  date_done      : ${fmtMs(task.date_done)}`);
    console.log(`  date_updated   : ${fmtMs(task.date_updated)}`);

    // Look up case BEFORE upsert for diff
    const before = await prisma.case.findUnique({
        where: { clickupTaskId: task.id },
        select: {
            id: true, name: true, status: true,
            dateCreated: true, dateDone: true, caseCompletionDate: true, lastSyncedAt: true,
        },
    });
    console.log("\n═══ DB BEFORE upsert ═══");
    if (!before) {
        console.log("  (case not in DB)");
    } else {
        console.log(`  #${before.id}  "${before.name}"  status=${before.status}`);
        console.log(`  dateCreated   : ${fmt(before.dateCreated)}`);
        console.log(`  dateDone      : ${fmt(before.dateDone)}`);
        console.log(`  lastSyncedAt  : ${fmt(before.lastSyncedAt)}`);
    }

    // 2) Resolve list -> productionListId
    const list = task.list?.id
        ? await prisma.productionList.findUnique({
            where: { clickupListId: String(task.list.id) },
            select: { id: true, name: true },
        })
        : null;
    if (!list) {
        console.log(`\nProduction list ${task.list?.id} not in DB — aborting.`);
        return;
    }

    // 3) Resolve custom fields + assignees
    const customData = parseCustomFields(task.custom_fields || []);
    const ytField = (task.custom_fields || []).find((f: any) =>
        f.name && f.name.toLowerCase().includes("youtube video link")
    );
    const youtubeVideoUrl = ytField?.value ? String(ytField.value) : null;

    const assigneeId = await resolveUserId(task.assignees?.[0]?.id);
    const researcherId = await resolveUserId(customData.researcherUserId);
    const writerId = await resolveUserId(customData.writerUserId);
    const editorId = await resolveUserId(customData.editorUserId);

    const cleanCustomData: any = { ...customData };
    for (const field of USER_FIELDS) delete cleanCustomData[field];

    // 4) Upsert case
    const savedCase = await prisma.case.upsert({
        where: { clickupTaskId: task.id },
        create: {
            clickupTaskId: task.id,
            productionListId: list.id,
            name: task.name,
            status: task.status?.status || "unknown",
            statusType: task.status?.type || null,
            clickupUrl: task.url || null,
            assigneeUserId: assigneeId,
            researcherUserId: researcherId,
            writerUserId: writerId,
            editorUserId: editorId,
            dateCreated: task.date_created ? new Date(parseInt(task.date_created)) : null,
            dateDone: task.date_done ? new Date(parseInt(task.date_done)) : null,
            lastSyncedAt: new Date(),
            youtubeVideoUrl,
            ...cleanCustomData,
        },
        update: {
            name: task.name,
            status: task.status?.status || "unknown",
            statusType: task.status?.type || null,
            clickupUrl: task.url || null,
            assigneeUserId: assigneeId,
            researcherUserId: researcherId,
            writerUserId: writerId,
            editorUserId: editorId,
            dateDone: task.date_done ? new Date(parseInt(task.date_done)) : null,
            lastSyncedAt: new Date(),
            youtubeVideoUrl,
            ...cleanCustomData,
        },
    });

    // 5) Refresh CaseAssignee join
    if (Array.isArray(task.assignees) && task.assignees.length > 0) {
        await prisma.caseAssignee.deleteMany({ where: { caseId: savedCase.id } });
        for (const assignee of task.assignees) {
            const resolvedId = await resolveUserId(assignee.id);
            if (resolvedId) {
                await prisma.caseAssignee.create({
                    data: {
                        caseId: savedCase.id,
                        userId: resolvedId,
                        clickupUserId: BigInt(assignee.id),
                    },
                });
            }
        }
    }

    // 6) Fetch subtasks via include_subtasks (all subtasks, incl. ones in other lists)
    const childSubtasks: any[] = task?.subtasks || [];
    console.log(`\n═══ ClickUp subtasks (${childSubtasks.length}) — raw payload ═══`);
    for (const s of childSubtasks) {
        console.log(
            `  ${s.id}  ${s.name.padEnd(30)}  ` +
            `status=${s.status?.status}/${s.status?.type}  ` +
            `start=${fmtMs(s.start_date)}  due=${fmtMs(s.due_date)}  done=${fmtMs(s.date_done)}  ` +
            `updated=${fmtMs(s.date_updated)}`
        );
    }

    // The list-level /task endpoint only gives subtask IDs; for full objects
    // we fetch each one. ClickUp returns full subtask detail via /task/{id}.
    console.log(`\nFetching full subtask objects (${childSubtasks.length})...`);
    const fullSubtasks: any[] = [];
    for (const s of childSubtasks) {
        try {
            const detail = await clickupApi<any>(`/task/${s.id}`);
            fullSubtasks.push(detail);
        } catch (e) {
            console.warn(`  ! could not fetch subtask ${s.id}: ${(e as Error).message}`);
        }
    }

    // 7) Upsert each subtask
    for (const subtask of fullSubtasks) {
        try {
            await upsertSubtaskFromClickup(subtask, savedCase.id);
        } catch (e) {
            console.error(`Error upserting subtask ${subtask.id}:`, e);
        }
    }

    // 8) Read back final DB state
    console.log("\n═══ DB AFTER upsert ═══");
    const after = await prisma.case.findUnique({
        where: { id: savedCase.id },
        include: {
            editor: { select: { id: true, name: true } },
            writer: { select: { id: true, name: true } },
            researcher: { select: { id: true, name: true } },
            assignee: { select: { id: true, name: true } },
            productionList: { select: { id: true, name: true } },
            subtasks: {
                orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
                include: { assignee: { select: { id: true, name: true } } },
            },
        },
    });
    if (!after) return;

    console.log(`  #${after.id}  "${after.name}"`);
    console.log(`  status        : ${after.status}  (type ${after.statusType ?? "—"})`);
    console.log(`  list          : ${after.productionList?.name}`);
    console.log(`  researcher    : ${after.researcher ? `${after.researcher.name}` : "—"}`);
    console.log(`  writer        : ${after.writer ? `${after.writer.name}` : "—"}`);
    console.log(`  editor        : ${after.editor ? `${after.editor.name}` : "—"}`);
    console.log(`  dateCreated   : ${fmt(after.dateCreated)}`);
    console.log(`  caseStartDate : ${fmt(after.caseStartDate)}`);
    console.log(`  dateDone      : ${fmt(after.dateDone)}`);
    console.log(`  uploadDate    : ${fmt(after.uploadDate)}`);
    console.log(`  lastSyncedAt  : ${fmt(after.lastSyncedAt)}`);

    console.log(`\n  Subtasks (${after.subtasks.length}):`);
    for (const s of after.subtasks) {
        console.log(
            `    ${s.name.padEnd(30)}  ` +
            `status=${s.status}  ` +
            `start=${fmt(s.startDate)}  due=${fmt(s.dueDate)}  done=${fmt(s.dateDone)}  ` +
            `assignee=${s.assignee?.name ?? "—"}`
        );
    }

    console.log("\n✓ Resync complete.\n");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
