import prisma from "@/lib/prisma";
import { clickupApi, WORKSPACE_ID, TARGET_SPACE_IDS } from "./api-client";
import { parseCustomFields } from "./field-parser";
import { USER_FIELDS } from "./field-mapping";
import { delay, deriveShortName, calcBusinessDaysTat } from "@/lib/utils";

// ═══ STEP 1: Sync Workspace Members ═══
export async function syncUsers(): Promise<number> {
    const response = await clickupApi<any>(`/team/${WORKSPACE_ID}`);
    const members = response.team?.members || [];
    let count = 0;

    // Collect all active ClickUp user IDs
    const activeClickupIds: bigint[] = [];

    for (const member of members) {
        const user = member.user;
        if (!user?.id || !user?.email) continue;

        const clickupId = BigInt(user.id);
        activeClickupIds.push(clickupId);

        await prisma.user.upsert({
            where: { clickupUserId: clickupId },
            create: {
                clickupUserId: clickupId,
                name: user.username || user.email.split("@")[0],
                email: user.email,
                profilePictureUrl: user.profilePicture || null,
                isActive: true,
            },
            update: {
                name: user.username || user.email.split("@")[0],
                profilePictureUrl: user.profilePicture || null,
                isActive: true,
            },
        });
        count++;
    }

    // Deactivate users no longer in ClickUp (skip Google-only users with clickupUserId=0)
    if (activeClickupIds.length > 0) {
        const deactivated = await prisma.user.updateMany({
            where: {
                clickupUserId: { notIn: activeClickupIds, not: BigInt(0) },
                isActive: true,
            },
            data: { isActive: false },
        });
        if (deactivated.count > 0) {
            console.log(`[Sync] Deactivated ${deactivated.count} users no longer in ClickUp`);
        }
    }

    return count;
}

// ═══ STEP 2: Sync Spaces ═══
export async function syncSpaces(): Promise<number> {
    const response = await clickupApi<any>(
        `/team/${WORKSPACE_ID}/space?archived=false`
    );
    let count = 0;

    // Read admin-selected spaces from DB (fallback to TARGET_SPACE_IDS if none configured)
    const config = await prisma.syncConfig.findUnique({ where: { key: "selected_spaces" } });
    const selectedIds: string[] = (config?.value as string[]) || TARGET_SPACE_IDS;
    const filterIds = selectedIds.length > 0 ? selectedIds : TARGET_SPACE_IDS;

    for (const space of response.spaces || []) {
        if (filterIds.includes(space.id)) {
            await prisma.space.upsert({
                where: { clickupSpaceId: space.id },
                create: { clickupSpaceId: space.id, name: space.name, isSynced: true },
                update: { name: space.name, isSynced: true },
            });
            count++;
        }
    }

    return count;
}

// ═══ STEP 3: Sync Folders → Capsules ═══
export async function syncCapsules(): Promise<number> {
    const spaces = await prisma.space.findMany({ where: { isSynced: true } });
    let count = 0;

    for (const space of spaces) {
        await delay(650);
        try {
            const response = await clickupApi<any>(
                `/space/${space.clickupSpaceId}/folder?archived=false`
            );

            for (const folder of response.folders || []) {
                await prisma.capsule.upsert({
                    where: { clickupFolderId: folder.id },
                    create: {
                        clickupFolderId: folder.id,
                        spaceId: space.id,
                        name: folder.name,
                        shortName: deriveShortName(folder.name),
                    },
                    update: { name: folder.name },
                });
                count++;
            }
        } catch (error) {
            console.error(
                `Error syncing capsules for space ${space.clickupSpaceId}:`,
                error
            );
        }
    }

    return count;
}

// ═══ STEP 4: Sync Lists ═══
export async function syncLists(): Promise<number> {
    let count = 0;

    // Lists inside folders (capsules)
    const capsules = await prisma.capsule.findMany();
    for (const capsule of capsules) {
        await delay(650);
        try {
            const response = await clickupApi<any>(
                `/folder/${capsule.clickupFolderId}/list?archived=false`
            );

            for (const list of response.lists || []) {
                await prisma.productionList.upsert({
                    where: { clickupListId: list.id },
                    create: {
                        clickupListId: list.id,
                        capsuleId: capsule.id,
                        name: list.name,
                    },
                    update: { name: list.name },
                });
                count++;
            }
        } catch (error) {
            console.error(
                `Error syncing lists for capsule ${capsule.clickupFolderId}:`,
                error
            );
        }
    }

    // Folderless lists (directly under space)
    const spaces = await prisma.space.findMany({ where: { isSynced: true } });
    for (const space of spaces) {
        await delay(650);
        try {
            const response = await clickupApi<any>(
                `/space/${space.clickupSpaceId}/list?archived=false`
            );

            for (const list of response.lists || []) {
                // Skip if already added as a folder list
                const existing = await prisma.productionList.findUnique({
                    where: { clickupListId: list.id },
                });
                if (!existing) {
                    await prisma.productionList.create({
                        data: {
                            clickupListId: list.id,
                            spaceId: space.id,
                            name: list.name,
                        },
                    });
                    count++;
                }
            }
        } catch (error) {
            console.error(
                `Error syncing folderless lists for space ${space.clickupSpaceId}:`,
                error
            );
        }
    }

    return count;
}

// ═══ Helper: resolve ClickUp user ID to our DB user ID ═══
async function resolveUserId(
    clickupId: number | null | undefined
): Promise<number | null> {
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

// ═══ STEP 5: Sync Tasks + Subtasks ═══
export async function syncTasks(): Promise<number> {
    // Read admin-selected lists from DB (fallback to all lists if none configured)
    const config = await prisma.syncConfig.findUnique({ where: { key: "selected_lists" } });
    const selectedListIds: string[] = (config?.value as string[]) || [];

    const allLists = await prisma.productionList.findMany();
    const lists = selectedListIds.length > 0
        ? allLists.filter(l => selectedListIds.includes(l.clickupListId))
        : allLists;

    let count = 0;

    for (const list of lists) {
        let page = 0;
        let hasMore = true;

        while (hasMore) {
            await delay(650);
            try {
                const response = await clickupApi<any>(
                    `/list/${list.clickupListId}/task?subtasks=true&include_closed=true&page=${page}`
                );

                const tasks = response.tasks || [];
                if (tasks.length === 0) {
                    hasMore = false;
                    break;
                }

                // Separate parent tasks and subtasks from the flat response
                const parentTasks = tasks.filter((t: any) => !t.parent);
                const subtaskEntries = tasks.filter((t: any) => t.parent);

                // First pass: process parent tasks as cases
                for (const task of parentTasks) {
                    try {
                        // Parse custom fields
                        const customData = parseCustomFields(task.custom_fields || []);

                        // Extract YouTube video URL by field name (custom field: "X.❤️ Youtube video link :-")
                        const ytField = (task.custom_fields || []).find((f: any) =>
                            f.name && f.name.toLowerCase().includes("youtube video link")
                        );
                        const youtubeVideoUrl = ytField?.value ? String(ytField.value) : null;

                        // Resolve ClickUp user IDs to our User IDs
                        const assigneeId = await resolveUserId(task.assignees?.[0]?.id);
                        const researcherId = await resolveUserId(customData.researcherUserId);
                        const writerId = await resolveUserId(customData.writerUserId);
                        const editorId = await resolveUserId(customData.editorUserId);

                        // Remove user fields from customData (they need FK resolution)
                        const cleanCustomData = { ...customData };
                        for (const field of USER_FIELDS) {
                            delete cleanCustomData[field];
                        }

                        // Upsert main case
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
                                dateCreated: task.date_created
                                    ? new Date(parseInt(task.date_created))
                                    : null,
                                dateDone: task.date_done
                                    ? new Date(parseInt(task.date_done))
                                    : null,
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
                                dateDone: task.date_done
                                    ? new Date(parseInt(task.date_done))
                                    : null,
                                lastSyncedAt: new Date(),
                                youtubeVideoUrl,
                                ...cleanCustomData,
                            },
                        });

                        count++;

                        // Sync all assignees into CaseAssignee join table
                        if (task.assignees && Array.isArray(task.assignees) && task.assignees.length > 0) {
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
                    } catch (taskError) {
                        console.error(`Error syncing task ${task.id}:`, taskError);
                    }
                }

                // Second pass: process subtasks (they have a parent field)
                for (const subtask of subtaskEntries) {
                    try {
                        // Find the parent case by the parent's clickup task ID
                        const parentCase = await prisma.case.findUnique({
                            where: { clickupTaskId: subtask.parent },
                            select: { id: true },
                        });

                        if (!parentCase) {
                            console.warn(`Subtask ${subtask.id} has parent ${subtask.parent} which is not a synced case, skipping`);
                            continue;
                        }

                        const subtaskAssigneeId = await resolveUserId(
                            subtask.assignees?.[0]?.id
                        );

                        // Build dates first so we can compute TAT
                        const stStartDate = subtask.start_date
                            ? new Date(parseInt(subtask.start_date))
                            : null;
                        const stDateDone = subtask.date_done
                            ? new Date(parseInt(subtask.date_done))
                            : subtask.status?.type === "closed" && subtask.date_updated
                                ? new Date(parseInt(subtask.date_updated))
                                : null;
                        const stTat = stStartDate && stDateDone
                            ? calcBusinessDaysTat(stStartDate, stDateDone)
                            : null;

                        await prisma.subtask.upsert({
                            where: { clickupTaskId: subtask.id },
                            create: {
                                clickupTaskId: subtask.id,
                                caseId: parentCase.id,
                                name: subtask.name,
                                status: subtask.status?.status || "unknown",
                                statusType: subtask.status?.type || null,
                                assigneeUserId: subtaskAssigneeId,
                                startDate: stStartDate,
                                dueDate: subtask.due_date
                                    ? new Date(parseInt(subtask.due_date))
                                    : null,
                                dateDone:  stDateDone,
                                tat:       stTat,
                                orderIndex: subtask.orderindex
                                    ? parseInt(subtask.orderindex)
                                    : null,
                                dateCreated: subtask.date_created
                                    ? new Date(parseInt(subtask.date_created))
                                    : null,
                                lastSyncedAt: new Date(),
                            },
                            update: {
                                name: subtask.name,
                                status: subtask.status?.status || "unknown",
                                statusType: subtask.status?.type || null,
                                assigneeUserId: subtaskAssigneeId,
                                startDate: stStartDate,
                                dueDate: subtask.due_date
                                    ? new Date(parseInt(subtask.due_date))
                                    : null,
                                dateDone:  stDateDone,
                                tat:       stTat,
                                lastSyncedAt: new Date(),
                            },
                        });
                    } catch (subtaskError) {
                        console.error(`Error syncing subtask ${subtask.id}:`, subtaskError);
                    }
                }

                page++;
                if (tasks.length < 100) hasMore = false;
            } catch (error) {
                console.error(
                    `Error fetching tasks for list ${list.clickupListId} page ${page}:`,
                    error
                );
                hasMore = false;
            }
        }
    }

    return count;
}

// ═══ Full Sync Orchestrator ═══
export async function runFullSync(): Promise<{
    spaces: number;
    capsules: number;
    lists: number;
    tasks: number;
}> {
    console.log("[Sync] Starting full ClickUp sync...");

    const spaces = await syncSpaces();
    console.log(`[Sync] Spaces synced: ${spaces}`);

    const capsules = await syncCapsules();
    console.log(`[Sync] Capsules synced: ${capsules}`);

    const lists = await syncLists();
    console.log(`[Sync] Lists synced: ${lists}`);

    const tasks = await syncTasks();
    console.log(`[Sync] Tasks synced: ${tasks}`);

    console.log("[Sync] Full sync complete!");

    return { spaces, capsules, lists, tasks };
}
